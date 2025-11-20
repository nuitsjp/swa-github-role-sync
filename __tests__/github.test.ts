import { jest } from '@jest/globals'

const graphqlRequestMock = jest.fn()
const graphqlMock = { defaults: jest.fn(() => graphqlRequestMock) }
const coreDebugMock = jest.fn()

async function loadGithub() {
  jest.resetModules()
  jest.unstable_mockModule('@octokit/graphql', () => ({ graphql: graphqlMock }))
  jest.unstable_mockModule('@actions/core', () => ({ debug: coreDebugMock }))
  jest.unstable_mockModule('@actions/github', () => ({
    context: { repo: { owner: 'ctx-owner', repo: 'ctx-repo' } }
  }))
  return import('../src/github.js')
}

beforeEach(() => {
  graphqlRequestMock.mockReset()
  graphqlMock.defaults.mockClear()
  coreDebugMock.mockReset()
})

describe('github helpers', () => {
  // target-repo入力のバリデーションとデフォルト利用を網羅的に確認
  it('parses target repo input with validation and defaults', async () => {
    const { parseTargetRepo } = await loadGithub()

    expect(parseTargetRepo('owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo'
    })
    expect(
      parseTargetRepo(undefined, {
        owner: 'ctx-owner',
        repo: 'ctx-repo'
      })
    ).toEqual({ owner: 'ctx-owner', repo: 'ctx-repo' })
    expect(() => parseTargetRepo('invalid')).toThrow(
      'Invalid target-repo format: invalid'
    )
  })

  // 書き込み以上の権限を持つコラボレーターだけを抽出する処理
  it('maps admin and write collaborators for syncing', async () => {
    const { listEligibleCollaborators } = await loadGithub()
    const paginateMock = jest.fn().mockResolvedValue([
      { login: 'alice', permissions: { admin: true } },
      { login: 'bob', permissions: { push: true } },
      { login: 'carol', permissions: { maintain: true } },
      { login: 'dave', permissions: { pull: true } }
    ])
    const octokit = {
      rest: { repos: { listCollaborators: jest.fn() } },
      paginate: paginateMock
    }

    const users = await listEligibleCollaborators(
      octokit as never,
      'owner',
      'repo'
    )

    expect(users).toEqual([
      { login: 'alice', role: 'admin' },
      { login: 'bob', role: 'write' },
      { login: 'carol', role: 'write' }
    ])
    expect(coreDebugMock).toHaveBeenCalledWith('Eligible collaborators: 3')
    expect(paginateMock).toHaveBeenCalledWith(
      octokit.rest.repos.listCollaborators,
      expect.objectContaining({ owner: 'owner', repo: 'repo' })
    )
  })

  // GraphQLを用いたDiscussion作成のハッピーパス
  it('creates discussions via GraphQL', async () => {
    graphqlRequestMock
      .mockResolvedValueOnce({
        repository: {
          id: 'repo-id',
          discussionCategories: {
            nodes: [{ id: 'cat-id', name: 'General' }]
          }
        }
      })
      .mockResolvedValueOnce({
        createDiscussion: { discussion: { url: 'https://example.com/disc/1' } }
      })

    const { createDiscussion } = await loadGithub()
    const url = await createDiscussion(
      'token',
      'owner',
      'repo',
      'General',
      'Title',
      'Body'
    )

    expect(url).toBe('https://example.com/disc/1')
    expect(graphqlMock.defaults).toHaveBeenCalledTimes(2)
    expect(graphqlRequestMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('discussionCategories'),
      { owner: 'owner', repo: 'repo' }
    )
    expect(graphqlRequestMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('createDiscussion'),
      {
        repositoryId: 'repo-id',
        categoryId: 'cat-id',
        title: 'Title',
        body: 'Body'
      }
    )
  })

  // 指定カテゴリが存在しない場合にエラーで失敗する挙動
  it('throws when discussion category is missing', async () => {
    graphqlRequestMock.mockResolvedValueOnce({
      repository: { id: 'repo-id', discussionCategories: { nodes: [] } }
    })

    const { createDiscussion } = await loadGithub()
    await expect(
      createDiscussion('token', 'owner', 'repo', 'Missing', 'Title', 'Body')
    ).rejects.toThrow('Discussion category "Missing" not found')
  })
})
