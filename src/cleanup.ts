import * as core from '@actions/core'
import * as github from '@actions/github'
import { graphql } from '@octokit/graphql'
import { parseTargetRepo } from './github.js'

/**
 * 入力値の検証と取得
 */
function getInputs() {
    return {
        githubToken: core.getInput('github-token', { required: true }),
        targetRepo: core.getInput('target-repo'),
        discussionCategoryName: core.getInput('discussion-category-name', {
            required: true
        }),
        expirationHours: parseInt(core.getInput('expiration-hours') || '168', 10),
        discussionTitleTemplate:
            core.getInput('discussion-title-template') ||
            'SWA access invites for {swaName} ({repo}) - {date}',
        cleanupMode: core.getInput('cleanup-mode') || 'expiration'
    }
}

/**
 * タイトルがテンプレートにマッチするか簡易チェック
 * 厳密なパースは難しいので、固定部分が含まれているかなどをチェックする方針もあるが、
 * ここではテンプレートから正規表現を生成してマッチングを試みる。
 */
function createTitleRegex(template: string): RegExp {
    // テンプレート内の {var} を .*? に置換して正規表現化する
    // エスケープが必要な文字をエスケープする
    const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // \{var\} の形になっているので、それを (.*?) に置換
    const pattern = escaped.replace(/\\\{(\w+)\\\}/g, '.*?')
    return new RegExp(`^${pattern}$`)
}

/**
 * Discussionの削除
 */
async function deleteDiscussion(
    token: string,
    discussionId: string
): Promise<void> {
    const graphqlClient = graphql.defaults({
        headers: { authorization: `token ${token}` }
    })

    await graphqlClient(
        `
    mutation ($id: ID!) {
      deleteDiscussion(input: {id: $id}) {
        clientMutationId
      }
    }
  `,
        { id: discussionId }
    )
}

/**
 * メイン処理
 */
export async function run(): Promise<void> {
    try {
        const inputs = getInputs()
        const { owner, repo } = parseTargetRepo(inputs.targetRepo)

        // 削除基準時刻
        const expirationDate = new Date(
            Date.now() - inputs.expirationHours * 60 * 60 * 1000
        )
        core.info(`Expiration cutoff: ${expirationDate.toISOString()}`)

        const octokit = github.getOctokit(inputs.githubToken)
        const titleRegex = createTitleRegex(inputs.discussionTitleTemplate)

        core.info(`Searching for discussions in ${owner}/${repo} category "${inputs.discussionCategoryName}"`)

        // まずカテゴリIDを取得
        const categoryQuery = await octokit.graphql<{
            repository: {
                discussionCategories: { nodes: { id: string; name: string }[] }
            }
        }>(
            `
        query ($owner: String!, $repo: String!) {
            repository(owner: $owner, name: $repo) {
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

        const category = categoryQuery.repository.discussionCategories.nodes.find(
            (n: { name: string }) => n.name === inputs.discussionCategoryName
        )

        if (!category) {
            throw new Error(`Category "${inputs.discussionCategoryName}" not found.`)
        }

        core.info(`Found category ID: ${category.id}`)

        // カテゴリ指定でDiscussion取得
        const discussionsQuery = await octokit.graphql<{
            repository: {
                discussions: {
                    nodes: {
                        id: string
                        title: string
                        createdAt: string
                        url: string
                    }[]
                }
            }
        }>(
            `
        query ($owner: String!, $repo: String!, $categoryId: ID!) {
            repository(owner: $owner, name: $repo) {
                discussions(first: 100, categoryId: $categoryId, orderBy: {field: CREATED_AT, direction: ASC}) {
                    nodes {
                        id
                        title
                        createdAt
                        url
                    }
                }
            }
        }
        `,
            { owner, repo, categoryId: category.id }
        )

        const discussions = discussionsQuery.repository.discussions.nodes
        core.info(`Found ${discussions.length} discussions in category.`)

        let deletedCount = 0

        for (const discussion of discussions) {
            const createdAt = new Date(discussion.createdAt)
            const isExpired =
                inputs.cleanupMode === 'immediate'
                    ? true
                    : createdAt < expirationDate
            const isMatch = titleRegex.test(discussion.title)

            if (isExpired && isMatch) {
                core.info(`Deleting expired discussion: "${discussion.title}" (${discussion.url}) created at ${discussion.createdAt}`)
                await deleteDiscussion(inputs.githubToken, discussion.id)
                deletedCount++
            } else {
                core.debug(`Skipping: "${discussion.title}" (Expired: ${isExpired}, Match: ${isMatch})`)
            }
        }

        core.info(`Deleted ${deletedCount} discussions.`)
        core.setOutput('deleted-count', deletedCount)

    } catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message)
        } else {
            core.setFailed(String(error))
        }
    }
}


