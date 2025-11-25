import * as core from '@actions/core'
import * as github from '@actions/github'
import { graphql } from '@octokit/graphql'
import type { DesiredUser, GitHubRole } from './types.js'
import { PERMISSION_LEVELS } from './types.js'

/** コラボレーター情報 */
type Collaborator = {
  /** GitHubログイン名 */
  login: string
  /** 権限情報 */
  permissions?: {
    /** 管理者権限 */
    admin?: boolean
    /** メンテナンス権限 */
    maintain?: boolean
    /** プッシュ権限 */
    push?: boolean
    /** トリアージ権限 */
    triage?: boolean
    /** 読み取り権限 */
    pull?: boolean
  }
}

/**
 * target-repo入力を解析し、省略時は現在のworkflowコンテキストを採用する。
 * @param input Action入力`target-repo`の文字列（owner/repo形式）。
 * @param contextRepo デフォルトのリポジトリ情報。
 * @returns ownerとrepoの組。
 */
export function parseTargetRepo(
  input: string | undefined,
  contextRepo = github.context.repo
): { owner: string; repo: string } {
  if (!input) {
    return { owner: contextRepo.owner, repo: contextRepo.repo }
  }
  const [owner, repo] = input.split('/')
  if (!owner || !repo) {
    throw new Error(`Invalid target-repo format: ${input}`)
  }
  return { owner, repo }
}

/**
 * GitHubコラボレーターの権限から最も高い権限レベルを決定する。
 * @param collaborator コラボレーター情報。
 * @returns 同期対象ユーザー（権限レベルを含む）。
 */
function toRole(collaborator: Collaborator): DesiredUser | null {
  const { login, permissions } = collaborator
  if (permissions?.admin) {
    return { login, role: 'admin' }
  }
  if (permissions?.maintain) {
    return { login, role: 'maintain' }
  }
  if (permissions?.push) {
    return { login, role: 'write' }
  }
  if (permissions?.triage) {
    return { login, role: 'triage' }
  }
  if (permissions?.pull) {
    return { login, role: 'read' }
  }
  return null
}

/**
 * 指定された最小権限レベル以上かどうかを判定する。
 * @param role ユーザーの権限レベル。
 * @param minimumPermission 最小権限レベル。
 * @returns 最小権限以上ならtrue。
 */
function meetsMinimumPermission(
  role: GitHubRole,
  minimumPermission: GitHubRole
): boolean {
  const roleIndex = PERMISSION_LEVELS.indexOf(role)
  const minIndex = PERMISSION_LEVELS.indexOf(minimumPermission)
  return roleIndex <= minIndex
}

/**
 * GitHub APIから指定された最小権限以上のユーザーを列挙し、同期用の形へ整形する。
 * @param octokit Octokitインスタンス。
 * @param owner リポジトリ所有者。
 * @param repo リポジトリ名。
 * @param minimumPermission 同期対象とする最小権限レベル（デフォルト: write）。
 * @returns 同期対象ユーザー配列。
 */
export async function listEligibleCollaborators(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  minimumPermission: GitHubRole = 'write'
): Promise<DesiredUser[]> {
  const collaborators = await octokit.paginate(
    octokit.rest.repos.listCollaborators,
    {
      owner,
      repo,
      per_page: 100,
      affiliation: 'all'
    }
  )
  const desired = collaborators
    .map(toRole)
    .filter((user): user is DesiredUser => Boolean(user))
    .filter((user) => meetsMinimumPermission(user.role, minimumPermission))

  core.debug(`Eligible collaborators: ${desired.length}`)
  return desired
}

/**
 * Discussion作成に必要なリポジトリIDとカテゴリIDをGraphQLで取得する。
 * @param token GitHubトークン。
 * @param owner リポジトリ所有者。
 * @param repo リポジトリ名。
 * @param categoryName Discussionカテゴリ名。
 * @returns repositoryIdとcategoryId。
 */
export async function getDiscussionCategoryId(
  token: string,
  owner: string,
  repo: string,
  categoryName: string
): Promise<{ repositoryId: string; categoryId: string }> {
  const graphqlClient = graphql.defaults({
    headers: { authorization: `token ${token}` }
  })

  const query = await graphqlClient<{
    repository: {
      id: string
      discussionCategories: { nodes: { id: string; name: string }[] }
    }
  }>(
    `
      query ($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          id
          discussionCategories(first: 100) {
            nodes {
              id
              name
            }
          }
        }
      }
    `,
    { owner, repo }
  )

  const category = query.repository.discussionCategories.nodes.find(
    (node) => node.name === categoryName
  )
  if (!category) {
    throw new Error(`Discussion category "${categoryName}" not found`)
  }
  return { repositoryId: query.repository.id, categoryId: category.id }
}

/**
 * 取得済みカテゴリIDを使ってDiscussionを作成する。
 * @param token GitHubトークン。
 * @param owner リポジトリ所有者（ログ出力時の整合用）。
 * @param repo リポジトリ名（ログ出力時の整合用）。
 * @param categoryName Discussionカテゴリ名（ログ出力時の整合用）。
 * @param title Discussionタイトル。
 * @param body Discussion本文。
 * @param categoryIds 事前取得済みのリポジトリIDとカテゴリID。
 * @returns 作成されたDiscussionのURL。
 */
export async function createDiscussion(
  token: string,
  owner: string,
  repo: string,
  categoryName: string,
  title: string,
  body: string,
  categoryIds: { repositoryId: string; categoryId: string }
): Promise<string> {
  if (!categoryIds) {
    throw new Error('categoryIds is required to create a discussion')
  }
  const graphqlClient = graphql.defaults({
    headers: { authorization: `token ${token}` }
  })
  const { repositoryId, categoryId } = categoryIds

  const mutation = await graphqlClient<{
    createDiscussion: { discussion: { url: string } }
  }>(
    `
      mutation (
        $repositoryId: ID!
        $categoryId: ID!
        $title: String!
        $body: String!
      ) {
        createDiscussion(
          input: {
            repositoryId: $repositoryId
            categoryId: $categoryId
            title: $title
            body: $body
          }
        ) {
          discussion {
            url
          }
        }
      }
    `,
    { repositoryId, categoryId, title, body }
  )
  return mutation.createDiscussion.discussion.url
}
