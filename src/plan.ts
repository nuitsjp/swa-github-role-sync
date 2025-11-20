import type {
  DesiredUser,
  PlanAdd,
  PlanRemove,
  PlanUpdate,
  SwaUser,
  SyncPlan
} from './types.js'

// Azure Static Web Appsに用いるGitHubロール名は接頭辞を合わせて管理する
export const DEFAULT_ROLE_PREFIX = 'github-'

// GitHubのログイン名は大小や余分な空白が混在しやすいのでここで統一する
function normalizeLogin(login: string): string {
  return login.trim().toLowerCase()
}

// SWAユーザー情報はuserDetails/displayNameのどちらかしか無いことがあるので順番に確認する
function resolveSwaLogin(user: SwaUser): string | undefined {
  if (user.userDetails?.trim()) {
    return normalizeLogin(user.userDetails)
  }
  if (user.displayName?.trim()) {
    return normalizeLogin(user.displayName)
  }
  return undefined
}

// カンマ区切りのロール配列を整形し、比較対象の接頭辞だけ残した文字列にする
function normalizeRoles(roles: string | undefined, rolePrefix: string): string {
  if (!roles) return ''
  return roles
    .split(',')
    .map((role) => role.trim().toLowerCase())
    .filter((role) => role.startsWith(rolePrefix))
    .sort()
    .join(',')
}

// GitHub側の希望状態とSWA側の現状から、招待・更新・削除の実行計画を組み立てる
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

  // GitHubユーザーを基準に、存在しないなら招待・存在するならロール差分を調べる
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

  // SWA側にだけ残っているユーザーは削除対象とみなす
  for (const [login, user] of existing.entries()) {
    if (!desired.has(login)) {
      toRemove.push({ login, currentRoles: user.roles ?? '' })
    }
  }

  return { toAdd, toUpdate, toRemove }
}
