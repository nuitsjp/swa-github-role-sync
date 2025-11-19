import type {
  DesiredUser,
  PlanAdd,
  PlanRemove,
  PlanUpdate,
  SwaUser,
  SyncPlan
} from './types.js'

export const DEFAULT_ROLE_PREFIX = 'github-'

function normalizeLogin(login: string): string {
  return login.trim().toLowerCase()
}

function resolveSwaLogin(user: SwaUser): string | undefined {
  if (user.userDetails?.trim()) {
    return normalizeLogin(user.userDetails)
  }
  if (user.displayName?.trim()) {
    return normalizeLogin(user.displayName)
  }
  return undefined
}

function normalizeRoles(roles: string | undefined, rolePrefix: string): string {
  if (!roles) return ''
  return roles
    .split(',')
    .map((role) => role.trim().toLowerCase())
    .filter((role) => role.startsWith(rolePrefix))
    .sort()
    .join(',')
}

export function computeSyncPlan(
  githubUsers: DesiredUser[],
  swaUsers: SwaUser[],
  roleForAdmin: string,
  roleForWrite: string,
  options?: {
    rolePrefix?: string
  }
): SyncPlan {
  const rolePrefix = options?.rolePrefix ?? DEFAULT_ROLE_PREFIX
  const desired = new Map<string, string>()
  githubUsers.forEach((user) => {
    const role = user.role === 'admin' ? roleForAdmin : roleForWrite
    desired.set(normalizeLogin(user.login), role)
  })

  const existing = new Map<string, SwaUser>()
  swaUsers.forEach((user) => {
    const login = resolveSwaLogin(user)
    if (login) {
      existing.set(login, user)
    }
  })

  const toAdd: PlanAdd[] = []
  const toUpdate: PlanUpdate[] = []
  const toRemove: PlanRemove[] = []

  for (const [login, role] of desired.entries()) {
    const current = existing.get(login)
    if (!current) {
      toAdd.push({ login, role })
      continue
    }

    const currentRoles = normalizeRoles(current.roles, rolePrefix)
    const desiredRoles = normalizeRoles(role, rolePrefix)
    if (currentRoles !== desiredRoles) {
      toUpdate.push({
        login,
        role,
        currentRoles: current.roles ?? ''
      })
    }
  }

  for (const [login, user] of existing.entries()) {
    if (!desired.has(login)) {
      toRemove.push({ login, currentRoles: user.roles ?? '' })
    }
  }

  return { toAdd, toUpdate, toRemove }
}
