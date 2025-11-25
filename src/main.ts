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
import { computeSyncPlan, type RoleMapping } from './plan.js'
import { buildSummaryMarkdown, fillTemplate } from './templates.js'
import type {
  DesiredUser,
  GitHubRole,
  InvitationResult,
  RemovalResult,
  UpdateResult
} from './types.js'
import { PERMISSION_LEVELS } from './types.js'

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
  minimumPermission: GitHubRole
  roleMapping: RoleMapping
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
  discussionUrls: string[]
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
    return 168
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
 * minimum-permission入力をパースし、有効な権限レベルを返す。
 * @param input minimum-permission入力文字列。
 * @returns 有効なGitHubRole、無効な場合はデフォルト'write'。
 */
function parseMinimumPermission(input: string): GitHubRole {
  const trimmed = input.trim().toLowerCase() as GitHubRole
  if (PERMISSION_LEVELS.includes(trimmed)) {
    return trimmed
  }
  return 'write'
}

/**
 * GitHub Action入力を集約し、デフォルト値や検証済みの型を付与する。
 * @returns SWA同期で利用する各種入力。
 */
function getInputs(): Inputs {
  const invitationExpirationHours = parseInvitationExpirationHours(
    core.getInput('invitation-expiration-hours')
  )
  const minimumPermission = parseMinimumPermission(
    core.getInput('minimum-permission')
  )
  const roleMapping: RoleMapping = {
    admin: core.getInput('role-for-admin') || 'github-admin',
    maintain: core.getInput('role-for-maintain') || 'github-maintain',
    write: core.getInput('role-for-write') || 'github-write',
    triage: core.getInput('role-for-triage') || 'github-triage',
    read: core.getInput('role-for-read') || 'github-read'
  }
  return {
    githubToken: core.getInput('github-token', { required: true }),
    targetRepo: core.getInput('target-repo'),
    swaName: core.getInput('swa-name', { required: true }),
    swaResourceGroup: core.getInput('swa-resource-group', { required: true }),
    swaDomain: core.getInput('swa-domain'),
    invitationExpirationHours,
    minimumPermission,
    roleMapping,
    rolePrefix: core.getInput('role-prefix') || 'github-',
    discussionCategoryName: core.getInput('discussion-category-name', {
      required: true
    }),
    discussionTitleTemplate:
      core.getInput('discussion-title-template') ||
      'SWA access invite for @{login} ({swaName}) - {date}',
    discussionBodyTemplate:
      core.getInput('discussion-body-template') ||
      `Hi @{login},

You now have **{role}** access to **{swaName}** from **{repo}**.

- Invite link: {inviteUrl}
- Role: {role}
- Expires in: {invitationExpirationHours} hours

Use the invite link above to authenticate. After you confirm access, close this discussion so the admins know you're done. If the invite expired, comment here and we'll re-run the sync.`
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
      discussionUrl: state.discussionUrls[0],
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
    context.repo,
    context.minimumPermission
  )

  core.info(
    `Found ${githubUsers.length} GitHub users with ${context.minimumPermission}+ permission (owner/repo: ${context.repoFullName})`
  )

  assertWithinSwaRoleLimit(githubUsers)

  const swaUsers = await listSwaUsers(context.swaName, context.swaResourceGroup)
  const plan = computeSyncPlan(
    githubUsers,
    swaUsers,
    context.roleMapping,
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
      discussionUrls: [],
      summaryMarkdown: syncSummaryMarkdown,
      added,
      updated,
      removed
    }
  }

  if (!added.length) {
    core.info('No new SWA invites detected; skipping discussion creation.')
    return {
      repoFullName: context.repoFullName,
      swaName: context.swaName,
      discussionUrls: [],
      summaryMarkdown: syncSummaryMarkdown,
      added,
      updated,
      removed
    }
  }

  const baseTemplateValues = {
    swaName: context.swaName,
    repo: context.repoFullName,
    date: today(),
    summaryMarkdown: syncSummaryMarkdown,
    invitationExpirationHours: String(context.invitationExpirationHours)
  }

  const missingTemplateKeys = new Set<string>()
  const onMissingKey = (key: string): void => {
    missingTemplateKeys.add(key)
  }

  const discussionUrls: string[] = []

  for (const invite of added) {
    const templateValues = {
      ...baseTemplateValues,
      login: invite.login,
      role: invite.role,
      inviteUrl: invite.inviteUrl
    }
    const discussionTitle = fillTemplate(
      context.discussionTitleTemplate,
      templateValues,
      { onMissingKey }
    )
    const discussionBody = fillTemplate(
      context.discussionBodyTemplate,
      templateValues,
      { onMissingKey }
    )

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
      discussionUrls.push(discussionUrl)
      invite.discussionUrl = discussionUrl
      core.info(`Created Discussion for @${invite.login}: ${discussionUrl}`)
    } catch (error) {
      const message = toErrorMessage(error)
      throw new Error(`Failed to create Discussion: ${message}`)
    }
  }

  if (missingTemplateKeys.size) {
    core.warning(
      `Unknown template placeholders with no value: ${[
        ...missingTemplateKeys
      ].join(', ')}`
    )
  }

  const summaryMarkdown = buildSummaryMarkdown({
    repo: context.repoFullName,
    swaName: context.swaName,
    added,
    updated,
    removed,
    discussionUrl: discussionUrls[0],
    status: 'success'
  })

  return {
    repoFullName: context.repoFullName,
    swaName: context.swaName,
    discussionUrls,
    summaryMarkdown,
    added,
    updated,
    removed
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
  const discussionUrls = results.discussionUrls
  core.setOutput('discussion-url', discussionUrls[0] ?? '')
  core.setOutput('discussion-urls', discussionUrls.join('\n'))
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
    discussionUrls: [],
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
