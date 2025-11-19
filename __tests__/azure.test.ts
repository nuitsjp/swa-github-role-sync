import { jest } from '@jest/globals'
import { promisify } from 'node:util'

const execFileMock = jest.fn()
const coreDebugMock = jest.fn()

execFileMock[promisify.custom] = (...args: unknown[]) =>
  new Promise((resolve, reject) => {
    execFileMock(
      ...args,
      (error: Error | null, stdout?: unknown, stderr?: unknown) => {
        if (error) {
          reject(error)
          return
        }
        resolve({ stdout, stderr })
      }
    )
  })

function mockExecOnce(stdout: string, assertArgs?: (args: unknown[]) => void) {
  execFileMock.mockImplementationOnce((...args) => {
    assertArgs?.(args)
    const callback = args.find(
      (arg) => typeof arg === 'function'
    ) as (err: Error | null, stdout?: unknown, stderr?: unknown) => void
    callback(null, stdout, '')
  })
}

async function loadAzure() {
  jest.resetModules()
  jest.unstable_mockModule('node:child_process', () => ({ execFile: execFileMock }))
  jest.unstable_mockModule('@actions/core', () => ({ debug: coreDebugMock }))
  return import('../src/azure.js')
}

beforeEach(() => {
  execFileMock.mockReset()
  coreDebugMock.mockReset()
})

describe('azure helpers', () => {
  it('returns only GitHub users from listSwaUsers', async () => {
    mockExecOnce(
      JSON.stringify([
        { userDetails: 'octocat', roles: 'github-admin', provider: 'GitHub' },
        { userDetails: 'other', roles: 'github-writer', provider: 'Twitter' }
      ])
    )

    const { listSwaUsers } = await loadAzure()
    const users = await listSwaUsers('app', 'rg')

    expect(users).toEqual([
      { userDetails: 'octocat', roles: 'github-admin', provider: 'GitHub' }
    ])
    expect(coreDebugMock).toHaveBeenCalledWith('Fetched 1 SWA GitHub users')
  })

  it('resolves default hostname and trims whitespace', async () => {
    mockExecOnce('example.azurewebsites.net\n')

    const { getSwaDefaultHostname } = await loadAzure()
    await expect(getSwaDefaultHostname('app', 'rg')).resolves.toBe(
      'example.azurewebsites.net'
    )
  })

  it('throws when default hostname is empty', async () => {
    mockExecOnce('\n')

    const { getSwaDefaultHostname } = await loadAzure()
    await expect(getSwaDefaultHostname('app', 'rg')).rejects.toThrow(
      'Failed to resolve default hostname for Static Web App'
    )
  })

  it('invites and updates users via Azure CLI', async () => {
    mockExecOnce(JSON.stringify({ invitationUrl: 'https://invite/me' }))
    mockExecOnce('', (args) => {
      const cliArgs = args[1] as string[]
      const rolesIndex = cliArgs.indexOf('--roles')
      expect(cliArgs[rolesIndex + 1]).toBe('new-role')
    })
    mockExecOnce('', (args) => {
      const cliArgs = args[1] as string[]
      const rolesIndex = cliArgs.indexOf('--roles')
      expect(cliArgs[rolesIndex + 1]).toBe('')
    })

    const { inviteUser, updateUserRoles, clearUserRoles } = await loadAzure()

    await expect(
      inviteUser('app', 'rg', 'domain', 'octocat', 'new-role')
    ).resolves.toBe('https://invite/me')
    await updateUserRoles('app', 'rg', 'octocat', 'new-role')
    await clearUserRoles('app', 'rg', 'octocat')

    expect(execFileMock).toHaveBeenCalledTimes(3)
  })

  it('throws when invite URL is missing in response', async () => {
    mockExecOnce(JSON.stringify({}))

    const { inviteUser } = await loadAzure()
    await expect(
      inviteUser('app', 'rg', 'domain', 'octocat', 'role')
    ).rejects.toThrow('Failed to retrieve invite URL for octocat')
  })
})
