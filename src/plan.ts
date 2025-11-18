import type {
  DesiredUser,
  PlanAdd,
  PlanRemove,
  PlanUpdate,
  SwaUser,
  SyncPlan
} from './types.js'

function normalizeLogin(login: string): string {
  return login.trim().toLowerCase()
}

function normalizeRoles(roles: string | undefined): string {
  if (!roles) return ''
  return roles
    .split(',')
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',')
}

export function computeSyncPlan(
  githubUsers: DesiredUser[],
  swaUsers: SwaUser[],
  roleForAdmin: string,
  roleForWrite: string
): SyncPlan {
  const desired = new Map<string, string>()
  githubUsers.forEach((user) => {
    const role = user.role === 'admin' ? roleForAdmin : roleForWrite
    desired.set(normalizeLogin(user.login), role)
  })

  const existing = new Map<string, SwaUser>()
  swaUsers.forEach((user) => {
    existing.set(normalizeLogin(user.userDetails), user)
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

    const currentRoles = normalizeRoles(current.roles)
    const desiredRoles = normalizeRoles(role)
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
