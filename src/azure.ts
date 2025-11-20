import { execFile, type ExecFileException } from 'node:child_process'
import { promisify } from 'node:util'
import * as core from '@actions/core'
import type { SwaUser } from './types.js'

/** Promise化されたexecFile関数 */
const execFileAsync = promisify(execFile)

/**
 * Azure CLIコマンドを実行する。
 * @param args CLIに渡す引数配列。
 * @returns 標準出力の文字列。
 * @throws コマンド実行エラー（stderrを含む）。
 */
async function runAzCommand(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('az', args, {
      maxBuffer: 10 * 1024 * 1024
    })
    return stdout
  } catch (error) {
    const execError = error as ExecFileException & { stderr?: string }
    const stderr =
      typeof execError?.stderr === 'string' ? execError.stderr.trim() : ''
    if (stderr && !execError.message.includes(stderr)) {
      execError.message = `${execError.message}\n${stderr}`
    }
    throw execError
  }
}

/**
 * プロバイダー文字列を正規化する。
 * @param provider プロバイダー名。
 * @returns 小文字化・トリム済みのプロバイダー名。
 */
function normalizeProvider(provider: string | undefined): string {
  return provider ? provider.trim().toLowerCase() : ''
}

/**
 * SWAに登録されているGitHubユーザー一覧を取得する。
 * @param name Static Web App名。
 * @param resourceGroup リソースグループ名。
 * @returns GitHubプロバイダーのユーザーのみを返す配列。
 */
export async function listSwaUsers(
  name: string,
  resourceGroup: string
): Promise<SwaUser[]> {
  const stdout = await runAzCommand([
    'staticwebapp',
    'users',
    'list',
    '--name',
    name,
    '--resource-group',
    resourceGroup,
    '--output',
    'json'
  ])
  const users = JSON.parse(stdout) as SwaUser[]

  // GitHubプロバイダーのみをフィルタリング
  const githubUsers = users.filter(
    (user): user is SwaUser => normalizeProvider(user.provider) === 'github'
  )
  core.debug(`Fetched ${githubUsers.length} SWA GitHub users`)
  return githubUsers
}

/**
 * SWAの既定ホスト名（*.azurestaticapps.netやカスタムドメイン）を解決する。
 * @param name Static Web App名。
 * @param resourceGroup リソースグループ名。
 * @returns 既定ホスト名。
 * @throws 解決できない場合。
 */
export async function getSwaDefaultHostname(
  name: string,
  resourceGroup: string
): Promise<string> {
  const stdout = await runAzCommand([
    'staticwebapp',
    'show',
    '--name',
    name,
    '--resource-group',
    resourceGroup,
    '--query',
    'defaultHostname',
    '--output',
    'tsv'
  ])
  const domain = stdout.trim()
  if (!domain) {
    throw new Error('Failed to resolve default hostname for Static Web App')
  }
  return domain
}

/**
 * GitHubユーザーをSWAへ招待するためのURLを発行する。
 * @param name Static Web App名。
 * @param resourceGroup リソースグループ名。
 * @param domain 招待URLに含めるドメイン。
 * @param githubUser 招待対象のGitHubログイン。
 * @param roles 付与するロール（カンマ区切り）。
 * @param expirationHours 招待リンクの有効期限（時間）。省略時は24時間。
 * @returns 招待URL。
 */
export async function inviteUser(
  name: string,
  resourceGroup: string,
  domain: string,
  githubUser: string,
  roles: string,
  expirationHours = 24
): Promise<string> {
  const stdout = await runAzCommand([
    'staticwebapp',
    'users',
    'invite',
    '--name',
    name,
    '--resource-group',
    resourceGroup,
    '--authentication-provider',
    'GitHub',
    '--user-details',
    githubUser,
    '--roles',
    roles,
    '--domain',
    domain,
    '--invitation-expiration-in-hours',
    String(expirationHours),
    '--output',
    'json'
  ])
  const result = JSON.parse(stdout) as Record<string, string>

  // 複数の可能性があるキー名から招待URLを取得
  const url = result.inviteUrl ?? result.invitationUrl ?? result.url ?? ''
  if (!url) {
    throw new Error(`Failed to retrieve invite URL for ${githubUser}`)
  }
  return url
}

/**
 * 既存のSWAユーザーに対してロールを更新する。
 * @param name Static Web App名。
 * @param resourceGroup リソースグループ名。
 * @param githubUser 対象GitHubユーザー。
 * @param roles 設定するロール（カンマ区切り）。空文字で削除を指示。
 */
export async function updateUserRoles(
  name: string,
  resourceGroup: string,
  githubUser: string,
  roles: string
): Promise<void> {
  await runAzCommand([
    'staticwebapp',
    'users',
    'update',
    '--name',
    name,
    '--resource-group',
    resourceGroup,
    '--authentication-provider',
    'GitHub',
    '--user-details',
    githubUser,
    '--roles',
    roles
  ])
}

/**
 * SWAユーザーからすべてのロールを削除する。
 * @param name Static Web App名。
 * @param resourceGroup リソースグループ名。
 * @param githubUser 対象GitHubユーザー。
 */
export async function clearUserRoles(
  name: string,
  resourceGroup: string,
  githubUser: string
): Promise<void> {
  // 空文字でロール削除を指示
  await updateUserRoles(name, resourceGroup, githubUser, '')
}
