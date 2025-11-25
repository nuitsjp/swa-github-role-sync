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

  // 全5段階の権限を持つコラボレーターを1:1でマッピングする
  it('maps all permission levels to corresponding roles (1:1 mapping)', async () => {
    const { listEligibleCollaborators } = await loadGithub()
    const paginateMock = jest.fn().mockResolvedValue([
      {
        login: 'admin-user',
        permissions: {
          admin: true,
          maintain: true,
          push: true,
          triage: true,
          pull: true
        }
      },
      {
        login: 'maintain-user',
        permissions: {
          admin: false,
          maintain: true,
          push: true,
          triage: true,
          pull: true
        }
      },
      {
        login: 'write-user',
        permissions: {
          admin: false,
          maintain: false,
          push: true,
          triage: true,
          pull: true
        }
      },
      {
        login: 'triage-user',
        permissions: {
          admin: false,
          maintain: false,
          push: false,
          triage: true,
          pull: true
        }
      },
      {
        login: 'read-user',
        permissions: {
          admin: false,
          maintain: false,
          push: false,
          triage: false,
          pull: true
        }
      }
    ])
    const octokit = {
      rest: { repos: { listCollaborators: jest.fn() } },
      paginate: paginateMock
    }

    const users = await listEligibleCollaborators(
      octokit as never,
      'owner',
      'repo',
      'read'
    )

    expect(users).toEqual([
      { login: 'admin-user', role: 'admin' },
      { login: 'maintain-user', role: 'maintain' },
      { login: 'write-user', role: 'write' },
      { login: 'triage-user', role: 'triage' },
      { login: 'read-user', role: 'read' }
    ])
    expect(coreDebugMock).toHaveBeenCalledWith('Eligible collaborators: 5')
  })

  // minimum-permission: writeの場合、write以上のみ同期（デフォルト動作）
  it('filters collaborators by minimum permission level (write)', async () => {
    const { listEligibleCollaborators } = await loadGithub()
    const paginateMock = jest.fn().mockResolvedValue([
      {
        login: 'admin-user',
        permissions: {
          admin: true,
          maintain: true,
          push: true,
          triage: true,
          pull: true
        }
      },
      {
        login: 'maintain-user',
        permissions: {
          admin: false,
          maintain: true,
          push: true,
          triage: true,
          pull: true
        }
      },
      {
        login: 'write-user',
        permissions: {
          admin: false,
          maintain: false,
          push: true,
          triage: true,
          pull: true
        }
      },
      {
        login: 'triage-user',
        permissions: {
          admin: false,
          maintain: false,
          push: false,
          triage: true,
          pull: true
        }
      },
      {
        login: 'read-user',
        permissions: {
          admin: false,
          maintain: false,
          push: false,
          triage: false,
          pull: true
        }
      }
    ])
    const octokit = {
      rest: { repos: { listCollaborators: jest.fn() } },
      paginate: paginateMock
    }

    const users = await listEligibleCollaborators(
      octokit as never,
      'owner',
      'repo',
      'write'
    )

    expect(users).toEqual([
      { login: 'admin-user', role: 'admin' },
      { login: 'maintain-user', role: 'maintain' },
      { login: 'write-user', role: 'write' }
    ])
    expect(coreDebugMock).toHaveBeenCalledWith('Eligible collaborators: 3')
  })

  // minimum-permission: triageの場合、triage以上のみ同期
  it('filters collaborators by minimum permission level (triage)', async () => {
    const { listEligibleCollaborators } = await loadGithub()
    const paginateMock = jest.fn().mockResolvedValue([
      { login: 'admin-user', permissions: { admin: true } },
      { login: 'write-user', permissions: { push: true } },
      { login: 'triage-user', permissions: { triage: true } },
      { login: 'read-user', permissions: { pull: true } }
    ])
    const octokit = {
      rest: { repos: { listCollaborators: jest.fn() } },
      paginate: paginateMock
    }

    const users = await listEligibleCollaborators(
      octokit as never,
      'owner',
      'repo',
      'triage'
    )

    expect(users).toEqual([
      { login: 'admin-user', role: 'admin' },
      { login: 'write-user', role: 'write' },
      { login: 'triage-user', role: 'triage' }
    ])
  })

  // minimum-permission: adminの場合、adminのみ同期
  it('filters collaborators by minimum permission level (admin)', async () => {
    const { listEligibleCollaborators } = await loadGithub()
    const paginateMock = jest.fn().mockResolvedValue([
      { login: 'admin-user', permissions: { admin: true } },
      { login: 'maintain-user', permissions: { maintain: true } },
      { login: 'write-user', permissions: { push: true } }
    ])
    const octokit = {
      rest: { repos: { listCollaborators: jest.fn() } },
      paginate: paginateMock
    }

    const users = await listEligibleCollaborators(
      octokit as never,
      'owner',
      'repo',
      'admin'
    )

    expect(users).toEqual([{ login: 'admin-user', role: 'admin' }])
  })

  // デフォルト（minimumPermission未指定）はwriteと同じ動作
  it('defaults to write minimum permission when not specified', async () => {
    const { listEligibleCollaborators } = await loadGithub()
    const paginateMock = jest
      .fn()
      .mockResolvedValue([
        { login: 'alice', permissions: { admin: true } },
        { login: 'bob', permissions: { push: true } },
        { login: 'carol', permissions: { maintain: true } },
        { login: 'dave', permissions: { pull: true } },
        { login: 'eve', permissions: {} },
        { login: 'frank' }
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
      { login: 'carol', role: 'maintain' }
    ])
    expect(coreDebugMock).toHaveBeenCalledWith('Eligible collaborators: 3')
    expect(paginateMock).toHaveBeenCalledWith(
      octokit.rest.repos.listCollaborators,
      expect.objectContaining({ owner: 'owner', repo: 'repo' })
    )
  })

  // GraphQLを用いてカテゴリIDを取得する流れ
  it('fetches discussion category ids via GraphQL', async () => {
    graphqlRequestMock.mockResolvedValueOnce({
      repository: {
        id: 'repo-id',
        discussionCategories: { nodes: [{ id: 'cat-id', name: 'General' }] }
      }
    })

    const { getDiscussionCategoryId } = await loadGithub()
    const ids = await getDiscussionCategoryId(
      'token',
      'owner',
      'repo',
      'General'
    )

    expect(ids).toEqual({ repositoryId: 'repo-id', categoryId: 'cat-id' })
    expect(graphqlMock.defaults).toHaveBeenCalledTimes(1)
    expect(graphqlRequestMock).toHaveBeenCalledWith(
      expect.stringContaining('discussionCategories'),
      { owner: 'owner', repo: 'repo' }
    )
  })

  // 指定カテゴリが存在しない場合にエラーで失敗する挙動
  it('throws when discussion category is missing', async () => {
    graphqlRequestMock.mockResolvedValueOnce({
      repository: { id: 'repo-id', discussionCategories: { nodes: [] } }
    })

    const { getDiscussionCategoryId } = await loadGithub()
    await expect(
      getDiscussionCategoryId('token', 'owner', 'repo', 'Missing')
    ).rejects.toThrow('Discussion category "Missing" not found')
  })

  // 取得済みのカテゴリIDを利用してDiscussionを作成する
  it('creates discussions via GraphQL with provided category ids', async () => {
    graphqlRequestMock.mockResolvedValueOnce({
      createDiscussion: { discussion: { url: 'https://example.com/disc/1' } }
    })

    const { createDiscussion } = await loadGithub()
    const url = await createDiscussion(
      'token',
      'owner',
      'repo',
      'General',
      'Title',
      'Body',
      { repositoryId: 'repo-id', categoryId: 'cat-id' }
    )

    expect(url).toBe('https://example.com/disc/1')
    expect(graphqlMock.defaults).toHaveBeenCalledTimes(1)
    expect(graphqlRequestMock).toHaveBeenCalledWith(
      expect.stringContaining('createDiscussion'),
      {
        repositoryId: 'repo-id',
        categoryId: 'cat-id',
        title: 'Title',
        body: 'Body'
      }
    )
  })

  // categoryIds無しで呼び出した場合に早期に失敗する
  it('requires category ids to create a discussion', async () => {
    const { createDiscussion } = await loadGithub()
    await expect(
      createDiscussion(
        'token',
        'owner',
        'repo',
        'General',
        'Title',
        'Body',
        undefined as never
      )
    ).rejects.toThrow('categoryIds is required to create a discussion')
  })
})
