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

async function loadMain() {
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
      'github-admin'
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

  it('uses provided domain and custom templates with default roles', async () => {
    inputs.set('swa-domain', 'provided.example.net')
    inputs.set('discussion-title-template', 'Custom title for {repo}')
    inputs.set('discussion-body-template', 'Body for {swaName}')
    inputs.set('role-for-admin', '')
    inputs.set('role-for-write', '')

    listEligibleCollaboratorsMock.mockResolvedValue([])
    listSwaUsersMock.mockResolvedValue([])
    createDiscussionMock.mockResolvedValue(
      'https://github.com/owner/repo/discussions/999'
    )

    const { run } = await loadMain()
    await run()

    expect(getSwaDefaultHostnameMock).not.toHaveBeenCalled()
    expect(inviteUserMock).not.toHaveBeenCalled()
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
    expect(setOutputMock).toHaveBeenCalledWith('added-count', 0)
    expect(setOutputMock).toHaveBeenCalledWith('updated-count', 0)
    expect(setOutputMock).toHaveBeenCalledWith('removed-count', 0)
    expect(setOutputMock).toHaveBeenCalledWith(
      'discussion-url',
      'https://github.com/owner/repo/discussions/999'
    )
  })

  it('logs missing template placeholders', async () => {
    inputs.set(
      'discussion-body-template',
      'Body with {unknown} {summaryMarkdown}'
    )

    listEligibleCollaboratorsMock.mockResolvedValue([])
    listSwaUsersMock.mockResolvedValue([])
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

  it('handles non-Error failures gracefully', async () => {
    inputs.set('swa-domain', 'provided.example.net')
    getSwaDefaultHostnameMock.mockResolvedValue('fallback-should-not-be-used')
    listEligibleCollaboratorsMock.mockRejectedValue('boom')

    const { run } = await loadMain()
    await run()

    expect(listSwaUsersMock).not.toHaveBeenCalled()
    expect(setFailedMock).toHaveBeenCalledWith('Unknown error')
    expect(errorMock).toHaveBeenCalledWith('Unknown error')
    const summaryMarkdown = summaryAddRawMock.mock.calls[0][0] as string
    expect(summaryMarkdown).toContain('Status: failure')
    expect(summaryMarkdown).toContain('Unknown error')
  })

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
      'Failed to create Discussion: Unknown error creating discussion'
    )
    const summaryMarkdown = summaryAddRawMock.mock.calls[0][0] as string
    expect(summaryMarkdown).toContain(
      'Error: Failed to create Discussion: Unknown error creating discussion'
    )
  })

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

    expect(setFailedMock).toHaveBeenCalledWith('Unknown error')
    const summaryMarkdown = summaryAddRawMock.mock.calls[0][0] as string
    expect(summaryMarkdown).toContain('Status: success')
  })

  it('falls back to unknown fields when core inputs throw non-Error values', async () => {
    getInputMock.mockImplementation((name: string) => {
      if (name === 'github-token') {
        throw 'token missing'
      }
      return inputs.get(name) ?? ''
    })

    const { run } = await loadMain()
    await run()

    expect(setFailedMock).toHaveBeenCalledWith('Unknown error')
    const summaryMarkdown = summaryAddRawMock.mock.calls[0][0] as string
    expect(summaryMarkdown).toContain('Repository: unknown')
    expect(summaryMarkdown).toContain('Static Web App: unknown')
  })
})
