import * as core from '@actions/core'
import * as github from '@actions/github'
import {
  clearUserRoles,
  getSwaDefaultHostname,
  inviteUser,
  listSwaUsers,
  updateUserRoles
} from './azure.js'
import {
  createDiscussion,
  getDiscussionCategoryId,
  listEligibleCollaborators,
  parseTargetRepo
} from './github.js'
import { computeSyncPlan } from './plan.js'
import { buildSummaryMarkdown, fillTemplate } from './templates.js'
import type {
  DesiredUser,
  InvitationResult,
  RemovalResult,
  UpdateResult
} from './types.js'

/** Azure Static Web Appsのカスタムロールに割り当てられるGitHubユーザー数の上限 */
const SWA_CUSTOM_ROLE_ASSIGNMENT_LIMIT = 25

/**
 * カスタムロール割り当て数がSWAの上限を超えないことを事前にチェックする。
 * @param users GitHub権限から抽出した同期対象ユーザー。
 * @throws 上限超過時。
 */
function assertWithinSwaRoleLimit(users: DesiredUser[]): void {
  const uniqueLogins = new Set(
    users
      .map((user) => user.login.trim().toLowerCase())
      .filter((login) => login.length > 0)
  )
  if (uniqueLogins.size > SWA_CUSTOM_ROLE_ASSIGNMENT_LIMIT) {
    throw new Error(
      `SWA custom role assignment limit (${SWA_CUSTOM_ROLE_ASSIGNMENT_LIMIT}) exceeded: ${uniqueLogins.size} users require custom roles`
    )
  }
}

type Inputs = {
  githubToken: string
  targetRepo?: string
  swaName: string
  swaResourceGroup: string
  swaDomain?: string
  invitationExpirationHours: number
  roleForAdmin: string
  roleForWrite: string
  rolePrefix: string
  discussionCategoryName: string
  discussionTitleTemplate: string
  discussionBodyTemplate: string
}

type SyncContext = Inputs & {
  owner: string
  repo: string
  repoFullName: string
  categoryIds: { repositoryId: string; categoryId: string }
  swaDomain: string
  octokit: ReturnType<typeof github.getOctokit>
}

type SyncResults = {
  repoFullName: string
  swaName: string
  discussionUrl: string
  summaryMarkdown: string
  added: InvitationResult[]
  updated: UpdateResult[]
  removed: RemovalResult[]
}

/**
 * 招待リンクの有効期限入力を検証し、デフォルト値を補完する。
 * @param input GitHub Action入力`invitation-expiration-hours`の文字列。
 * @returns 1〜168時間の整数（指定なしは24）。
 * @throws 範囲外や数値でない場合。
 */
function parseInvitationExpirationHours(input: string): number {
  const trimmed = input.trim()
  if (!trimmed) {
    return 24
  }
  const hours = Number(trimmed)
  if (
    !Number.isFinite(hours) ||
    !Number.isInteger(hours) ||
    hours < 1 ||
    hours > 168
  ) {
    throw new Error(
      'invitation-expiration-hours must be between 1 and 168 hours'
    )
  }
  return hours
}

/**
 * GitHub Action入力を集約し、デフォルト値や検証済みの型を付与する。
 * @returns SWA同期で利用する各種入力。
 */
function getInputs(): Inputs {
  const invitationExpirationHours = parseInvitationExpirationHours(
    core.getInput('invitation-expiration-hours')
  )
  return {
    githubToken: core.getInput('github-token', { required: true }),
    targetRepo: core.getInput('target-repo'),
    swaName: core.getInput('swa-name', { required: true }),
    swaResourceGroup: core.getInput('swa-resource-group', { required: true }),
    swaDomain: core.getInput('swa-domain'),
    invitationExpirationHours,
    roleForAdmin: core.getInput('role-for-admin') || 'github-admin',
    roleForWrite: core.getInput('role-for-write') || 'github-writer',
    rolePrefix: core.getInput('role-prefix') || 'github-',
    discussionCategoryName: core.getInput('discussion-category-name', {
      required: true
    }),
    discussionTitleTemplate:
      core.getInput('discussion-title-template') ||
      'SWA access invites for {swaName} ({repo}) - {date}',
    discussionBodyTemplate:
      core.getInput('discussion-body-template') ||
      `This discussion contains SWA access invite links for **{swaName}** from **{repo}**.

{summaryMarkdown}`
  }
}

/**
 * Discussionタイトル向けの簡易日付（YYYY-MM-DD）を返す。
 */
function today(): string {
  return new Date().toISOString().split('T')[0]
}

/**
 * 例外オブジェクトを文字列に正規化し、非Errorでも原因を見失わないようにする。
 * @param error catch節で受け取った原因オブジェクト。
 */
function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || 'Unknown error'
  }
  const text = String(error)
  return text || 'Unknown error'
}

/**
 * 既存のサマリーを維持しつつ、失敗時のMarkdownを構築する。
 * @param state 現在までに構築済みの結果。
 * @param failureMessage エラーメッセージ。
 */
function buildFailureSummary(
  state: SyncResults,
  failureMessage: string
): string {
  return (
    state.summaryMarkdown ||
    buildSummaryMarkdown({
      repo: state.repoFullName || 'unknown',
      swaName: state.swaName || 'unknown',
      added: state.added,
      updated: state.updated,
      removed: state.removed,
      discussionUrl: state.discussionUrl,
      status: 'failure',
      failureMessage
    })
  )
}

/**
 * 入力値の検証・リポジトリ情報の解析・DiscussionカテゴリIDやSWAドメインの解決をまとめて行う。
 * @returns 同期に必要なコンテキスト。
 */
async function gatherInputsAndPrepare(): Promise<SyncContext> {
  const inputs = getInputs()
  const { owner, repo } = parseTargetRepo(inputs.targetRepo)
  const repoFullName = `${owner}/${repo}`
  const categoryIds = await getDiscussionCategoryId(
    inputs.githubToken,
    owner,
    repo,
    inputs.discussionCategoryName
  )
  const swaDomain =
    inputs.swaDomain ||
    (await getSwaDefaultHostname(inputs.swaName, inputs.swaResourceGroup))
  core.info(`Using SWA domain: ${swaDomain}`)

  const octokit = github.getOctokit(inputs.githubToken)

  return {
    ...inputs,
    owner,
    repo,
    repoFullName,
    categoryIds,
    swaDomain,
    octokit
  }
}

/**
 * GitHub→SWAの差分同期を実行し、Discussion作成とサマリー生成までを完了させる。
 * @param context 事前に解決済みの入力・APIクライアント・カテゴリIDなど。
 * @returns Discussion URLとサマリーMarkdownを含む結果。
 */
async function executeSyncPlan(context: SyncContext): Promise<SyncResults> {
  const added: InvitationResult[] = []
  const updated: UpdateResult[] = []
  const removed: RemovalResult[] = []

  const githubUsers = await listEligibleCollaborators(
    context.octokit,
    context.owner,
    context.repo
  )

  core.info(
    `Found ${githubUsers.length} GitHub users with write/admin (owner/repo: ${context.repoFullName})`
  )

  assertWithinSwaRoleLimit(githubUsers)

  const swaUsers = await listSwaUsers(context.swaName, context.swaResourceGroup)
  const plan = computeSyncPlan(
    githubUsers,
    swaUsers,
    context.roleForAdmin,
    context.roleForWrite,
    { rolePrefix: context.rolePrefix }
  )

  core.info(
    `Plan -> add:${plan.toAdd.length} update:${plan.toUpdate.length} remove:${plan.toRemove.length}`
  )

  for (const add of plan.toAdd) {
    const inviteUrl = await inviteUser(
      context.swaName,
      context.swaResourceGroup,
      context.swaDomain,
      add.login,
      add.role,
      context.invitationExpirationHours
    )
    added.push({ login: add.login, role: add.role, inviteUrl })
    core.info(`Invited ${add.login} with role ${add.role}`)
  }

  for (const update of plan.toUpdate) {
    await updateUserRoles(
      context.swaName,
      context.swaResourceGroup,
      update.login,
      update.role
    )
    updated.push({ login: update.login, role: update.role })
    core.info(`Updated ${update.login} to role ${update.role}`)
  }

  for (const removal of plan.toRemove) {
    await clearUserRoles(
      context.swaName,
      context.swaResourceGroup,
      removal.login
    )
    removed.push({ login: removal.login })
    core.info(`Removed roles from ${removal.login}`)
  }

  const syncSummaryMarkdown = buildSummaryMarkdown({
    repo: context.repoFullName,
    swaName: context.swaName,
    added,
    updated,
    removed,
    status: 'success'
  })

  const hasRoleChanges =
    added.length > 0 || updated.length > 0 || removed.length > 0

  if (!hasRoleChanges) {
    core.info('No SWA role changes detected; skipping discussion creation.')
    return {
      repoFullName: context.repoFullName,
      swaName: context.swaName,
      discussionUrl: '',
      summaryMarkdown: syncSummaryMarkdown,
      added,
      updated,
      removed
    }
  }

  const templateValues = {
    swaName: context.swaName,
    repo: context.repoFullName,
    date: today(),
    summaryMarkdown: syncSummaryMarkdown
  }

  const missingTemplateKeys = new Set<string>()
  const onMissingKey = (key: string): void => {
    missingTemplateKeys.add(key)
  }

  const discussionTitle = fillTemplate(
    context.discussionTitleTemplate,
    templateValues,
    { onMissingKey }
  )
  const discussionBodyTemplate = context.discussionBodyTemplate
  const discussionBody = fillTemplate(discussionBodyTemplate, templateValues, {
    onMissingKey
  })

  if (!discussionBodyTemplate.includes('{summaryMarkdown}')) {
    core.warning(
      'discussion-body-template does not include {summaryMarkdown}; sync summary will not be added to the discussion body.'
    )
  }

  if (missingTemplateKeys.size) {
    core.warning(
      `Unknown template placeholders with no value: ${[
        ...missingTemplateKeys
      ].join(', ')}`
    )
  }

  try {
    const discussionUrl = await createDiscussion(
      context.githubToken,
      context.owner,
      context.repo,
      context.discussionCategoryName,
      discussionTitle,
      discussionBody,
      context.categoryIds
    )
    core.info(`Created Discussion: ${discussionUrl}`)

    const summaryMarkdown = buildSummaryMarkdown({
      repo: context.repoFullName,
      swaName: context.swaName,
      added,
      updated,
      removed,
      discussionUrl,
      status: 'success'
    })

    return {
      repoFullName: context.repoFullName,
      swaName: context.swaName,
      discussionUrl,
      summaryMarkdown,
      added,
      updated,
      removed
    }
  } catch (error) {
    const message = toErrorMessage(error)
    throw new Error(`Failed to create Discussion: ${message}`)
  }
}

/**
 * Outputsへ同期結果をセットする。
 * @param results 招待/更新/削除件数とDiscussion URL。
 */
async function reportResults(results: SyncResults): Promise<void> {
  core.setOutput('added-count', results.added.length)
  core.setOutput('updated-count', results.updated.length)
  core.setOutput('removed-count', results.removed.length)
  core.setOutput('discussion-url', results.discussionUrl)
}

/**
 * GitHub ActionsのJobサマリーへMarkdownを追記する。
 * @param summaryMarkdown 成功・失敗を含むMarkdown本文。
 */
async function writeJobSummary(summaryMarkdown: string): Promise<void> {
  await core.summary
    .addHeading('SWA role sync')
    .addRaw(summaryMarkdown, true)
    .write()
}

/**
 * GitHubリポジトリの権限をソース・オブ・トゥルースとしてSWAロールを同期するエントリーポイント。
 * 成否にかかわらずJobサマリーへ結果を出力する。
 */
export async function run(): Promise<void> {
  const state: SyncResults = {
    repoFullName: '',
    swaName: 'unknown',
    discussionUrl: '',
    summaryMarkdown: '',
    added: [],
    updated: [],
    removed: []
  }

  try {
    const context = await gatherInputsAndPrepare()
    state.repoFullName = context.repoFullName
    state.swaName = context.swaName
    const results = await executeSyncPlan(context)
    Object.assign(state, results)
    await reportResults(results)
  } catch (error) {
    const message = toErrorMessage(error)
    state.summaryMarkdown = buildFailureSummary(state, message)
    core.error(message)
    core.setFailed(message)
  } finally {
    if (state.summaryMarkdown) {
      await writeJobSummary(state.summaryMarkdown)
    }
  }
}
