import type {
  DesiredUser,
  PlanAdd,
  PlanRemove,
  PlanUpdate,
  SwaUser,
  SyncPlan
} from './types.js'

/** 差分判定に用いるロール名のデフォルト接頭辞 */
export const DEFAULT_ROLE_PREFIX = 'github-'

/**
 * GitHubログイン名を正規化する。
 * @param login GitHubログイン名。
 * @returns 小文字化・トリム済みのログイン名。
 */
function normalizeLogin(login: string): string {
  return login.trim().toLowerCase()
}

/**
 * SWAユーザー情報からGitHubログイン名を解決する。
 * @param user SWAユーザー情報。
 * @returns 正規化済みログイン名、解決できない場合はundefined。
 */
function resolveSwaLogin(user: SwaUser): string | undefined {
  if (user.userDetails?.trim()) {
    return normalizeLogin(user.userDetails)
  }
  if (user.displayName?.trim()) {
    return normalizeLogin(user.displayName)
  }
  return undefined
}

/**
 * カンマ区切りのロール文字列を正規化する。
 * @param roles ロール文字列（カンマ区切り）。
 * @param rolePrefix 同期対象のロール接頭辞。
 * @returns ソート済みの正規化ロール文字列。
 */
function normalizeRoles(roles: string | undefined, rolePrefix: string): string {
  if (!roles) return ''
  return roles
    .split(',')
    .map((role) => role.trim().toLowerCase())
    .filter((role) => role.startsWith(rolePrefix))
    .sort()
    .join(',')
}

/**
 * GitHubの理想状態とSWAの現状を比較し、招待/更新/削除の差分プランを生成する。
 * @param githubUsers GitHubの書き込み以上ユーザーと役割。
 * @param swaUsers SWAに登録済みのユーザー情報。
 * @param roleForAdmin GitHub admin権限に割り当てるSWAロール。
 * @param roleForWrite GitHub write/maintain権限に割り当てるSWAロール。
 * @param options rolePrefixで同期対象ロールの接頭辞を指定可能。
 */
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
      // SWAに未登録なら招待が必要
      toAdd.push({ login, role })
      continue
    }

    // 既存ユーザーのロールが理想状態と異なれば更新対象
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
      // GitHub側に存在しないSWAユーザーは削除対象
      toRemove.push({ login, currentRoles: user.roles ?? '' })
    }
  }

  return { toAdd, toUpdate, toRemove }
}
