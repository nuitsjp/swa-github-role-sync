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
    const callback = args.find((arg) => typeof arg === 'function') as (
      err: Error | null,
      stdout?: unknown,
      stderr?: unknown
    ) => void
    callback(null, stdout, '')
  })
}

function mockExecErrorOnce(
  errorMessage: string,
  stderrMessage: string,
  assertArgs?: (args: unknown[]) => void
) {
  execFileMock.mockImplementationOnce((...args) => {
    assertArgs?.(args)
    const callback = args.find((arg) => typeof arg === 'function') as (
      err: Error | null,
      stdout?: unknown,
      stderr?: unknown
    ) => void
    const error = new Error(errorMessage) as Error & { stderr?: string }
    error.stderr = stderrMessage
    callback(error, '', stderrMessage)
  })
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function loadAzure() {
  jest.resetModules()
  jest.unstable_mockModule('node:child_process', () => ({
    execFile: execFileMock
  }))
  jest.unstable_mockModule('@actions/core', () => ({ debug: coreDebugMock }))
  return import('../src/azure.js')
}

beforeEach(() => {
  execFileMock.mockReset()
  coreDebugMock.mockReset()
})

describe('azure helpers', () => {
  // listSwaUsersがproviderの大小を無視してGitHubユーザーだけ返すことを確認
  it('returns only GitHub users from listSwaUsers regardless of provider case', async () => {
    mockExecOnce(
      JSON.stringify([
        { userDetails: 'octocat', roles: 'github-admin', provider: 'GitHub' },
        {
          userDetails: 'octo-lower',
          roles: 'github-writer',
          provider: 'github'
        },
        {
          userDetails: '',
          roles: 'github-admin',
          provider: ' Github '
        },
        {
          roles: 'github-admin',
          provider: 'GitHub'
        },
        {
          userDetails: 'ghost',
          roles: 'github-writer'
        },
        { userDetails: 'other', roles: 'github-writer', provider: 'Twitter' }
      ])
    )

    const { listSwaUsers } = await loadAzure()
    const users = await listSwaUsers('app', 'rg')

    expect(users).toEqual([
      { userDetails: 'octocat', roles: 'github-admin', provider: 'GitHub' },
      { userDetails: 'octo-lower', roles: 'github-writer', provider: 'github' },
      { userDetails: '', roles: 'github-admin', provider: ' Github ' },
      { roles: 'github-admin', provider: 'GitHub' }
    ])
    expect(coreDebugMock).toHaveBeenCalledWith('Fetched 4 SWA GitHub users')
  })

  // getSwaDefaultHostnameが余分な改行を除去して値を返すケース
  it('resolves default hostname and trims whitespace', async () => {
    mockExecOnce('example.azurewebsites.net\n')

    const { getSwaDefaultHostname } = await loadAzure()
    await expect(getSwaDefaultHostname('app', 'rg')).resolves.toBe(
      'example.azurewebsites.net'
    )
  })

  // 既定ホスト名が空のときにエラーで落ちることを検証
  it('throws when default hostname is empty', async () => {
    mockExecOnce('\n')

    const { getSwaDefaultHostname } = await loadAzure()
    await expect(getSwaDefaultHostname('app', 'rg')).rejects.toThrow(
      'Failed to resolve default hostname for Static Web App'
    )
  })

  // Azure CLI失敗時にstderrの内容をメッセージへ取り込む振る舞い
  it('includes stderr output when Azure CLI fails', async () => {
    mockExecErrorOnce(
      'Command failed: az staticwebapp show',
      'AuthorizationFailed: access denied'
    )

    const { getSwaDefaultHostname } = await loadAzure()
    const promise = getSwaDefaultHostname('app', 'rg')
    await expect(promise).rejects.toThrow(/AuthorizationFailed: access denied/)
    await expect(promise).rejects.toThrow(
      /Command failed: az staticwebapp show/
    )
  })

  // stderrが空の場合は元のメッセージを保つことを確認
  it('keeps original error message when stderr output is empty', async () => {
    mockExecErrorOnce('Command failed: az staticwebapp show', '')

    const { getSwaDefaultHostname } = await loadAzure()
    await expect(getSwaDefaultHostname('app', 'rg')).rejects.toMatchObject({
      message: 'Command failed: az staticwebapp show'
    })
  })

  // すでにstderr文字列がmessageに含まれている場合に重複しないよう検証
  it('does not duplicate stderr content when already present in message', async () => {
    const stderr = 'AuthorizationFailed: repeating details'
    mockExecErrorOnce(`Command failed: az staticwebapp show\n${stderr}`, stderr)

    const { getSwaDefaultHostname } = await loadAzure()
    const escaped = escapeRegExp(stderr)
    const singleOccurrencePattern = new RegExp(
      `^(?!.*${escaped}.*${escaped}).*${escaped}.*$`,
      's'
    )

    await expect(getSwaDefaultHostname('app', 'rg')).rejects.toMatchObject({
      message: expect.stringMatching(singleOccurrencePattern)
    })
  })

  // 招待・更新・削除の順にCLIを呼ぶ正常系
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

  // 招待レスポンスにURLが無い異常系
  it('throws when invite URL is missing in response', async () => {
    mockExecOnce(JSON.stringify({}))

    const { inviteUser } = await loadAzure()
    await expect(
      inviteUser('app', 'rg', 'domain', 'octocat', 'role')
    ).rejects.toThrow('Failed to retrieve invite URL for octocat')
  })
})
