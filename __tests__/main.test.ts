import { jest } from '@jest/globals'

const inputs = new Map<string, string>()

const listSwaUsersMock = jest.fn()
const getSwaDefaultHostnameMock = jest.fn()
const inviteUserMock = jest.fn()
const updateUserRolesMock = jest.fn()
const clearUserRolesMock = jest.fn()
const getDiscussionCategoryIdMock = jest.fn()

const infoMock = jest.fn()
const errorMock = jest.fn()
const debugMock = jest.fn()
const warningMock = jest.fn()
const setOutputMock = jest.fn()
const setFailedMock = jest.fn()
const getInputValue = (
  name: string,
  options?: { required?: boolean }
): string => {
  const value = inputs.get(name) ?? ''
  if (!value && options?.required) {
    throw new Error(`Missing required input: ${name}`)
  }
  return value
}
const getInputMock = jest.fn(getInputValue)

const summaryAddHeadingMock = jest.fn()
const summaryAddRawMock = jest.fn()
const summaryWriteMock = jest.fn()

const summary = {
  addHeading: summaryAddHeadingMock,
  addRaw: summaryAddRawMock,
  write: summaryWriteMock
}

const parseTargetRepoMock = jest.fn((input: string) => {
  const [owner, repo] = input.split('/')
  return { owner, repo }
})

const listEligibleCollaboratorsMock = jest.fn()
const createDiscussionMock = jest.fn()

type LoadMainOptions = {
  buildSummaryMarkdown?: () => string
}

async function loadMain(options: LoadMainOptions = {}) {
  jest.resetModules()

  summaryAddHeadingMock.mockReturnValue(summary)
  summaryAddRawMock.mockReturnValue(summary)
  summaryWriteMock.mockResolvedValue(undefined)

  jest.unstable_mockModule('@actions/core', () => ({
    getInput: getInputMock,
    setOutput: setOutputMock,
    setFailed: setFailedMock,
    info: infoMock,
    error: errorMock,
    debug: debugMock,
    warning: warningMock,
    summary
  }))
  jest.unstable_mockModule('@actions/github', () => ({
    context: { repo: { owner: 'ctx-owner', repo: 'ctx-repo' } },
    getOctokit: () => ({})
  }))

  if (options.buildSummaryMarkdown) {
    jest.unstable_mockModule('../src/templates.js', () => ({
      buildSummaryMarkdown: options.buildSummaryMarkdown,
      fillTemplate: (template: string, values: Record<string, string>) =>
        template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '')
    }))
  }

  jest.unstable_mockModule('../src/azure.js', () => ({
    listSwaUsers: listSwaUsersMock,
    getSwaDefaultHostname: getSwaDefaultHostnameMock,
    inviteUser: inviteUserMock,
    updateUserRoles: updateUserRolesMock,
    clearUserRoles: clearUserRolesMock
  }))
  jest.unstable_mockModule('../src/github.js', () => ({
    parseTargetRepo: parseTargetRepoMock,
    listEligibleCollaborators: listEligibleCollaboratorsMock,
    createDiscussion: createDiscussionMock,
    getDiscussionCategoryId: getDiscussionCategoryIdMock
  }))

  return import('../src/main.js')
}

function setDefaultInputs() {
  inputs.set('github-token', 'token')
  inputs.set('target-repo', 'owner/repo')
  inputs.set('swa-name', 'my-swa')
  inputs.set('swa-resource-group', 'my-rg')
  inputs.set('discussion-category-name', 'Announcements')
  inputs.set('discussion-title-template', '')
  inputs.set('discussion-body-template', '')
  inputs.set('swa-domain', '')
  inputs.set('role-for-admin', 'github-admin')
  inputs.set('role-for-write', 'github-writer')
  inputs.set('role-prefix', '')
  inputs.set('invitation-expiration-hours', '')
}

beforeEach(() => {
  inputs.clear()
  setDefaultInputs()

  listSwaUsersMock.mockReset()
  getSwaDefaultHostnameMock.mockReset()
  inviteUserMock.mockReset()
  updateUserRolesMock.mockReset()
  clearUserRolesMock.mockReset()
  infoMock.mockReset()
  errorMock.mockReset()
  debugMock.mockReset()
  warningMock.mockReset()
  setOutputMock.mockReset()
  setFailedMock.mockReset()
  getInputMock.mockReset()
  parseTargetRepoMock.mockClear()
  listEligibleCollaboratorsMock.mockReset()
  createDiscussionMock.mockReset()
  getDiscussionCategoryIdMock.mockReset()
  getInputMock.mockImplementation(getInputValue)

  summaryAddHeadingMock.mockReset()
  summaryAddRawMock.mockReset()
  summaryWriteMock.mockReset()

  getDiscussionCategoryIdMock.mockResolvedValue({
    repositoryId: 'repo-id',
    categoryId: 'cat-id'
  })

  jest.useFakeTimers().setSystemTime(new Date('2024-01-02T12:00:00Z'))
})

afterEach(() => {
  jest.useRealTimers()
})

describe('run', () => {
  // 成功パスで招待・更新・削除とDiscussion作成まで一通り流れること
  it('syncs roles and creates a discussion with success summary', async () => {
    getSwaDefaultHostnameMock.mockResolvedValue('swa.azurewebsites.net')
    listSwaUsersMock.mockResolvedValue([
      { userDetails: 'bob', roles: 'github-admin', provider: 'GitHub' },
      { userDetails: 'carol', roles: 'github-writer', provider: 'GitHub' }
    ])
    listEligibleCollaboratorsMock.mockResolvedValue([
      { login: 'alice', role: 'admin' },
      { login: 'bob', role: 'write' }
    ])
    inviteUserMock.mockResolvedValue('https://invite/alice')
    updateUserRolesMock.mockResolvedValue(undefined)
    clearUserRolesMock.mockResolvedValue(undefined)
    createDiscussionMock.mockResolvedValue(
      'https://github.com/owner/repo/discussions/123'
    )

    const { run } = await loadMain()

    await run()

    expect(getSwaDefaultHostnameMock).toHaveBeenCalledWith('my-swa', 'my-rg')
    expect(getDiscussionCategoryIdMock).toHaveBeenCalledWith(
      'token',
      'owner',
      'repo',
      'Announcements'
    )
    expect(listSwaUsersMock).toHaveBeenCalledWith('my-swa', 'my-rg')
    expect(listEligibleCollaboratorsMock).toHaveBeenCalled()
    expect(inviteUserMock).toHaveBeenCalledWith(
      'my-swa',
      'my-rg',
      'swa.azurewebsites.net',
      'alice',
      'github-admin',
      168
    )
    expect(updateUserRolesMock).toHaveBeenCalledWith(
      'my-swa',
      'my-rg',
      'bob',
      'github-writer'
    )
    expect(clearUserRolesMock).toHaveBeenCalledWith('my-swa', 'my-rg', 'carol')

    expect(setOutputMock).toHaveBeenCalledWith('added-count', 1)
    expect(setOutputMock).toHaveBeenCalledWith('updated-count', 1)
    expect(setOutputMock).toHaveBeenCalledWith('removed-count', 1)
    expect(setOutputMock).toHaveBeenCalledWith(
      'discussion-url',
      'https://github.com/owner/repo/discussions/123'
    )
    expect(setFailedMock).not.toHaveBeenCalled()

    expect(createDiscussionMock).toHaveBeenCalledWith(
      'token',
      'owner',
      'repo',
      'Announcements',
      'SWA access invites for my-swa (owner/repo) - 2024-01-02',
      expect.stringContaining(
        'This discussion contains SWA access invite links'
      ),
      { repositoryId: 'repo-id', categoryId: 'cat-id' }
    )

    expect(summaryAddHeadingMock).toHaveBeenCalledWith('SWA role sync')
    const summaryMarkdown = summaryAddRawMock.mock.calls[0][0] as string
    expect(summaryMarkdown).toContain('Status: success')
    expect(summaryMarkdown).toContain('Added: 1')
    expect(summaryMarkdown).toContain('Updated roles')
    expect(summaryMarkdown).toContain('@alice')
    expect(summaryMarkdown).toContain('@carol')
    expect(summaryWriteMock).toHaveBeenCalled()
  })

  // Discussion作成がGraphQLエラーで壊れた場合に失敗サマリーを返す
  it('reports discussion creation failures with failure summary', async () => {
    getSwaDefaultHostnameMock.mockResolvedValue('swa.azurewebsites.net')
    listSwaUsersMock.mockResolvedValue([
      { userDetails: 'bob', roles: 'github-admin', provider: 'GitHub' }
    ])
    listEligibleCollaboratorsMock.mockResolvedValue([
      { login: 'alice', role: 'admin' },
      { login: 'bob', role: 'write' }
    ])
    inviteUserMock.mockResolvedValue('https://invite/alice')
    updateUserRolesMock.mockResolvedValue(undefined)
    createDiscussionMock.mockRejectedValue(new Error('GraphQL failed'))

    const { run } = await loadMain()

    await run()

    expect(setFailedMock).toHaveBeenCalledWith(
      'Failed to create Discussion: GraphQL failed'
    )
    expect(setOutputMock).not.toHaveBeenCalled()

    const summaryMarkdown = summaryAddRawMock.mock.calls[0][0] as string
    expect(summaryMarkdown).toContain('Status: failure')
    expect(summaryMarkdown).toContain(
      'Error: Failed to create Discussion: GraphQL failed'
    )
    expect(summaryWriteMock).toHaveBeenCalled()
  })

  // 入力でドメインやテンプレート・ロール名を上書きした場合の挙動
  it('uses provided domain and custom templates with default roles', async () => {
    inputs.set('swa-domain', 'provided.example.net')
    inputs.set('discussion-title-template', 'Custom title for {repo}')
    inputs.set('discussion-body-template', 'Body for {swaName}')
    inputs.set('role-for-admin', '')
    inputs.set('role-for-write', '')

    listEligibleCollaboratorsMock.mockResolvedValue([
      { login: 'alice', role: 'admin' }
    ])
    listSwaUsersMock.mockResolvedValue([])
    inviteUserMock.mockResolvedValue('https://invite/alice')
    createDiscussionMock.mockResolvedValue(
      'https://github.com/owner/repo/discussions/999'
    )

    const { run } = await loadMain()
    await run()

    expect(getSwaDefaultHostnameMock).not.toHaveBeenCalled()
    expect(inviteUserMock).toHaveBeenCalledWith(
      'my-swa',
      'my-rg',
      'provided.example.net',
      'alice',
      'github-admin',
      168
    )
    expect(updateUserRolesMock).not.toHaveBeenCalled()
    expect(clearUserRolesMock).not.toHaveBeenCalled()
    expect(createDiscussionMock).toHaveBeenCalledWith(
      'token',
      'owner',
      'repo',
      'Announcements',
      'Custom title for owner/repo',
      'Body for my-swa',
      { repositoryId: 'repo-id', categoryId: 'cat-id' }
    )
    expect(warningMock).toHaveBeenCalledWith(
      'discussion-body-template does not include {summaryMarkdown}; sync summary will not be added to the discussion body.'
    )
    expect(setOutputMock).toHaveBeenCalledWith('added-count', 1)
    expect(setOutputMock).toHaveBeenCalledWith('updated-count', 0)
    expect(setOutputMock).toHaveBeenCalledWith('removed-count', 0)
    expect(setOutputMock).toHaveBeenCalledWith(
      'discussion-url',
      'https://github.com/owner/repo/discussions/999'
    )
  })

  // 招待有効期限を入力から上書きしてAzure CLIに渡す
  it('forwards custom invitation expiration hours to Azure invites', async () => {
    inputs.set('invitation-expiration-hours', '48')
    getSwaDefaultHostnameMock.mockResolvedValue('swa.azurewebsites.net')
    listEligibleCollaboratorsMock.mockResolvedValue([
      { login: 'alice', role: 'admin' }
    ])
    listSwaUsersMock.mockResolvedValue([])
    inviteUserMock.mockResolvedValue('https://invite/alice')
    createDiscussionMock.mockResolvedValue(
      'https://github.com/owner/repo/discussions/123'
    )

    const { run } = await loadMain()
    await run()

    expect(inviteUserMock).toHaveBeenCalledWith(
      'my-swa',
      'my-rg',
      'swa.azurewebsites.net',
      'alice',
      'github-admin',
      48
    )
  })

  // 招待有効期限が許容範囲外なら早期に失敗させる
  it('validates invitation expiration hours range', async () => {
    inputs.set('invitation-expiration-hours', '0')

    const { run } = await loadMain()
    await run()

    expect(listEligibleCollaboratorsMock).not.toHaveBeenCalled()
    expect(setFailedMock).toHaveBeenCalledWith(
      'invitation-expiration-hours must be between 1 and 168 hours'
    )
    const summaryMarkdown = summaryAddRawMock.mock.calls[0][0] as string
    expect(summaryMarkdown).toContain('Status: failure')
    expect(summaryMarkdown).toContain(
      'invitation-expiration-hours must be between 1 and 168 hours'
    )
  })

  // 差分が無いときにDiscussionを作成せず結果だけ出力すること
  it('skips discussion creation when no role changes are needed', async () => {
    getSwaDefaultHostnameMock.mockResolvedValue('swa.azurewebsites.net')
    listEligibleCollaboratorsMock.mockResolvedValue([
      { login: 'alice', role: 'admin' },
      { login: 'bob', role: 'write' }
    ])
    listSwaUsersMock.mockResolvedValue([
      { userDetails: 'alice', roles: 'github-admin', provider: 'GitHub' },
      { userDetails: 'bob', roles: 'github-writer', provider: 'GitHub' }
    ])

    const { run } = await loadMain()
    await run()

    expect(inviteUserMock).not.toHaveBeenCalled()
    expect(updateUserRolesMock).not.toHaveBeenCalled()
    expect(clearUserRolesMock).not.toHaveBeenCalled()
    expect(createDiscussionMock).not.toHaveBeenCalled()
    expect(infoMock).toHaveBeenCalledWith(
      'No SWA role changes detected; skipping discussion creation.'
    )
    expect(setOutputMock).toHaveBeenCalledWith('added-count', 0)
    expect(setOutputMock).toHaveBeenCalledWith('updated-count', 0)
    expect(setOutputMock).toHaveBeenCalledWith('removed-count', 0)
    expect(setOutputMock).toHaveBeenCalledWith('discussion-url', '')
    const summaryMarkdown = summaryAddRawMock.mock.calls[0][0] as string
    expect(summaryMarkdown).toContain('Status: success')
    expect(summaryMarkdown).toContain('Added: 0')
  })

  // Discussionテンプレート内の不足プレースホルダーを警告できるかを確認
  it('logs missing template placeholders', async () => {
    inputs.set(
      'discussion-body-template',
      'Body with {unknown} {summaryMarkdown}'
    )

    listEligibleCollaboratorsMock.mockResolvedValue([
      { login: 'alice', role: 'admin' }
    ])
    listSwaUsersMock.mockResolvedValue([])
    inviteUserMock.mockResolvedValue('https://invite/alice')
    createDiscussionMock.mockResolvedValue(
      'https://github.com/owner/repo/discussions/999'
    )

    const { run } = await loadMain()
    await run()

    expect(warningMock).toHaveBeenCalledWith(
      'Unknown template placeholders with no value: unknown'
    )
    expect(createDiscussionMock).toHaveBeenCalledWith(
      'token',
      'owner',
      'repo',
      'Announcements',
      expect.any(String),
      expect.any(String),
      { repositoryId: 'repo-id', categoryId: 'cat-id' }
    )
  })

  // Discussionカテゴリ取得に失敗した時点で残りの処理を打ち切ること
  it('fails fast when discussion category is missing', async () => {
    getDiscussionCategoryIdMock.mockRejectedValueOnce(
      new Error('Discussion category "Announcements" not found')
    )

    listEligibleCollaboratorsMock.mockResolvedValue([])
    listSwaUsersMock.mockResolvedValue([])

    const { run } = await loadMain()
    await run()

    expect(listSwaUsersMock).not.toHaveBeenCalled()
    expect(createDiscussionMock).not.toHaveBeenCalled()
    expect(setFailedMock).toHaveBeenCalledWith(
      'Discussion category "Announcements" not found'
    )
    const summaryMarkdown = summaryAddRawMock.mock.calls[0][0] as string
    expect(summaryMarkdown).toContain('Status: failure')
    expect(summaryMarkdown).toContain(
      'Error: Discussion category "Announcements" not found'
    )
  })

  // PromiseがError以外の値でrejectされた場合のエラーハンドリング
  it('handles non-Error failures gracefully', async () => {
    inputs.set('swa-domain', 'provided.example.net')
    getSwaDefaultHostnameMock.mockResolvedValue('fallback-should-not-be-used')
    listEligibleCollaboratorsMock.mockRejectedValue('boom')

    const { run } = await loadMain()
    await run()

    expect(listSwaUsersMock).not.toHaveBeenCalled()
    expect(setFailedMock).toHaveBeenCalledWith('boom')
    expect(errorMock).toHaveBeenCalledWith('boom')
    const summaryMarkdown = summaryAddRawMock.mock.calls[0][0] as string
    expect(summaryMarkdown).toContain('Status: failure')
    expect(summaryMarkdown).toContain('boom')
  })

  // Errorのmessageが空でもUnknownで補足する
  it('falls back to unknown message when Error is missing text', async () => {
    inputs.set('swa-domain', 'provided.example.net')
    getSwaDefaultHostnameMock.mockResolvedValue('fallback-should-not-be-used')
    listEligibleCollaboratorsMock.mockRejectedValue(new Error(''))

    const { run } = await loadMain()
    await run()

    expect(setFailedMock).toHaveBeenCalledWith('Unknown error')
    const summaryMarkdown = summaryAddRawMock.mock.calls[0][0] as string
    expect(summaryMarkdown).toContain('Unknown error')
  })

  // 非Error値でも空文字ならUnknownとして扱う
  it('falls back to unknown message when rejection is an empty string', async () => {
    inputs.set('swa-domain', 'provided.example.net')
    listEligibleCollaboratorsMock.mockRejectedValue('')

    const { run } = await loadMain()
    await run()

    expect(setFailedMock).toHaveBeenCalledWith('Unknown error')
    const summaryMarkdown = summaryAddRawMock.mock.calls[0][0] as string
    expect(summaryMarkdown).toContain('Unknown error')
  })

  // 途中でsetOutput等が落ちても既に構築したサマリーを保持すること
  it('keeps existing summary when a later step fails', async () => {
    getSwaDefaultHostnameMock.mockResolvedValue('swa.azurewebsites.net')
    listSwaUsersMock.mockResolvedValue([
      { userDetails: 'bob', roles: 'github-admin', provider: 'GitHub' }
    ])
    listEligibleCollaboratorsMock.mockResolvedValue([
      { login: 'alice', role: 'admin' },
      { login: 'bob', role: 'write' }
    ])
    inviteUserMock.mockResolvedValue('https://invite/alice')
    updateUserRolesMock.mockResolvedValue(undefined)
    createDiscussionMock.mockResolvedValue(
      'https://github.com/owner/repo/discussions/123'
    )
    setOutputMock.mockImplementationOnce(() => {
      throw new Error('output failure')
    })

    const { run } = await loadMain()
    await run()

    expect(setFailedMock).toHaveBeenCalledWith('output failure')
    const summaryMarkdown = summaryAddRawMock.mock.calls[0][0] as string
    expect(summaryMarkdown).toContain('Status: success')
    expect(summaryMarkdown).toContain('Added: 1')
  })

  // Discussion作成が文字列など非Errorで失敗した際にメッセージを補足する
  it('propagates non-Error causes from discussion creation', async () => {
    getSwaDefaultHostnameMock.mockResolvedValue('swa.azurewebsites.net')
    listSwaUsersMock.mockResolvedValue([
      { userDetails: 'alice', provider: 'GitHub' }
    ])
    listEligibleCollaboratorsMock.mockResolvedValue([
      { login: 'alice', role: 'admin' }
    ])
    inviteUserMock.mockResolvedValue('https://invite/alice')
    createDiscussionMock.mockRejectedValue('bad-response')

    const { run } = await loadMain()
    await run()

    expect(setFailedMock).toHaveBeenCalledWith(
      'Failed to create Discussion: bad-response'
    )
    const summaryMarkdown = summaryAddRawMock.mock.calls[0][0] as string
    expect(summaryMarkdown).toContain(
      'Error: Failed to create Discussion: bad-response'
    )
  })

  // カスタムロール上限を超える人数がいた場合に即座に失敗させる
  it('fails when eligible collaborators exceed the SWA role limit', async () => {
    getSwaDefaultHostnameMock.mockResolvedValue('swa.azurewebsites.net')
    const tooManyUsers = Array.from({ length: 26 }, (_, idx) => ({
      login: `user${idx}`,
      role: 'write'
    }))
    listEligibleCollaboratorsMock.mockResolvedValue(tooManyUsers)

    const { run } = await loadMain()
    await run()

    expect(listSwaUsersMock).not.toHaveBeenCalled()
    expect(inviteUserMock).not.toHaveBeenCalled()
    expect(updateUserRolesMock).not.toHaveBeenCalled()
    expect(clearUserRolesMock).not.toHaveBeenCalled()
    expect(createDiscussionMock).not.toHaveBeenCalled()
    expect(setFailedMock).toHaveBeenCalledWith(
      'SWA custom role assignment limit (25) exceeded: 26 users require custom roles'
    )
    const summaryMarkdown = summaryAddRawMock.mock.calls[0][0] as string
    expect(summaryMarkdown).toContain('Status: failure')
    expect(summaryMarkdown).toContain(
      'Error: SWA custom role assignment limit (25) exceeded: 26 users require custom roles'
    )
  })

  // 必須入力が欠けているときにリポジトリ解析より前で失敗すること
  it('handles missing required inputs before repo parsing', async () => {
    inputs.delete('github-token')

    const { run } = await loadMain()
    await run()

    expect(getSwaDefaultHostnameMock).not.toHaveBeenCalled()
    expect(setFailedMock).toHaveBeenCalledWith(
      'Missing required input: github-token'
    )
    const summaryMarkdown = summaryAddRawMock.mock.calls[0][0] as string
    expect(summaryMarkdown).toContain('Repository: unknown')
    expect(summaryMarkdown).toContain('Static Web App: unknown')
  })

  // サマリー構築後に非Error例外が出てもUnknown扱いでまとめるケース
  it('treats non-Error failures after summary as unknown while keeping summary', async () => {
    getSwaDefaultHostnameMock.mockResolvedValue('swa.azurewebsites.net')
    listSwaUsersMock.mockResolvedValue([
      { userDetails: 'bob', roles: 'github-admin', provider: 'GitHub' }
    ])
    listEligibleCollaboratorsMock.mockResolvedValue([
      { login: 'alice', role: 'admin' },
      { login: 'bob', role: 'write' }
    ])
    inviteUserMock.mockResolvedValue('https://invite/alice')
    updateUserRolesMock.mockResolvedValue(undefined)
    createDiscussionMock.mockResolvedValue(
      'https://github.com/owner/repo/discussions/123'
    )
    setOutputMock.mockImplementationOnce(() => {
      throw 'string-failure'
    })

    const { run } = await loadMain()
    await run()

    expect(setFailedMock).toHaveBeenCalledWith('string-failure')
    const summaryMarkdown = summaryAddRawMock.mock.calls[0][0] as string
    expect(summaryMarkdown).toContain('Status: success')
  })

  // getInput自体が非Errorで失敗した場合でもunknownを埋めるリカバリー
  it('falls back to unknown fields when core inputs throw non-Error values', async () => {
    getInputMock.mockImplementation((name: string) => {
      if (name === 'github-token') {
        throw 'token missing'
      }
      return inputs.get(name) ?? ''
    })

    const { run } = await loadMain()
    await run()

    expect(setFailedMock).toHaveBeenCalledWith('token missing')
    const summaryMarkdown = summaryAddRawMock.mock.calls[0][0] as string
    expect(summaryMarkdown).toContain('Repository: unknown')
    expect(summaryMarkdown).toContain('Static Web App: unknown')
  })

  it('falls back to unknown SWA name when input is blank', async () => {
    inputs.set('swa-name', '')
    getInputMock.mockImplementation(
      (name: string, options?: { required?: boolean }) => {
        if (name === 'swa-name') {
          return ''
        }
        return getInputValue(name, options)
      }
    )
    getSwaDefaultHostnameMock.mockResolvedValue('swa.azurewebsites.net')
    listEligibleCollaboratorsMock.mockRejectedValue(new Error('sync failed'))

    const { run } = await loadMain()
    await run()

    expect(setFailedMock).toHaveBeenCalledWith('sync failed')
    const summaryMarkdown = summaryAddRawMock.mock.calls[0][0] as string
    expect(summaryMarkdown).toContain('Static Web App: unknown')
  })

  it('skips writing job summary when summary content is empty', async () => {
    getSwaDefaultHostnameMock.mockResolvedValue('swa.azurewebsites.net')
    listEligibleCollaboratorsMock.mockResolvedValue([
      { login: 'alice', role: 'admin' },
      { login: 'bob', role: 'write' }
    ])
    listSwaUsersMock.mockResolvedValue([
      { userDetails: 'alice', roles: 'github-admin', provider: 'GitHub' },
      { userDetails: 'bob', roles: 'github-writer', provider: 'GitHub' }
    ])

    const { run } = await loadMain({ buildSummaryMarkdown: () => '' })
    await run()

    expect(setFailedMock).not.toHaveBeenCalled()
    expect(summaryAddHeadingMock).not.toHaveBeenCalled()
    expect(summaryAddRawMock).not.toHaveBeenCalled()
    expect(summaryWriteMock).not.toHaveBeenCalled()
  })
})
