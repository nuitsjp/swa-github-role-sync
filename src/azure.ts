import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as core from '@actions/core'
import type { SwaUser } from './types.js'

const execFileAsync = promisify(execFile)

async function runAzCommand(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('az', args, {
    maxBuffer: 10 * 1024 * 1024
  })
  return stdout
}

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
  const githubUsers = users.filter((user) => user.provider === 'GitHub')
  core.debug(`Fetched ${githubUsers.length} SWA GitHub users`)
  return githubUsers
}

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
  const url = result.inviteUrl ?? result.invitationUrl ?? result.url ?? ''
  if (!url) {
    throw new Error(`Failed to retrieve invite URL for ${githubUser}`)
  }
  return url
}

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

export async function clearUserRoles(
  name: string,
  resourceGroup: string,
  githubUser: string
): Promise<void> {
  await updateUserRoles(name, resourceGroup, githubUser, '')
}
