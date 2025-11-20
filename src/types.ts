/** GitHub側の権限で同期対象を仕分けるための種別 */
export type GitHubRole = 'admin' | 'write'

/** GitHubのコラボレーターリストから抽出した理想状態 */
export type DesiredUser = {
  /** GitHubログイン名 */
  login: string
  /** 付与すべきロール種別 */
  role: GitHubRole
}

/** Azure CLIの応答を最小限の情報で扱うための型 */
export type SwaUser = {
  /** SWAユーザーID */
  userId?: string
  /** ユーザー詳細情報（通常はGitHubログイン名） */
  userDetails?: string
  /** 表示名 */
  displayName?: string
  /** カンマ区切りのロール文字列 */
  roles?: string
  /** 認証プロバイダー（github、aad等） */
  provider?: string
}

/** 差分計画で新規招待するユーザー */
export type PlanAdd = {
  /** GitHubログイン名 */
  login: string
  /** 付与するロール */
  role: string
}

/** 既存ユーザーのロール更新情報 */
export type PlanUpdate = {
  /** GitHubログイン名 */
  login: string
  /** 新しく設定するロール */
  role: string
  /** 現在のロール */
  currentRoles: string
}

/** 不要になったユーザーの削除情報 */
export type PlanRemove = {
  /** GitHubログイン名 */
  login: string
  /** 削除前のロール */
  currentRoles: string
}

/** 全体の同期計画 */
export type SyncPlan = {
  /** 招待するユーザー */
  toAdd: PlanAdd[]
  /** ロールを更新するユーザー */
  toUpdate: PlanUpdate[]
  /** 削除するユーザー */
  toRemove: PlanRemove[]
}

/** Azure CLIの実行結果をまとめてJobサマリーに書き出すための型 */
export type InvitationResult = {
  /** GitHubログイン名 */
  login: string
  /** 付与したロール */
  role: string
  /** 招待URL */
  inviteUrl: string
}

/** ロール更新結果 */
export type UpdateResult = {
  /** GitHubログイン名 */
  login: string
  /** 更新後のロール */
  role: string
}

/** ロール削除結果 */
export type RemovalResult = {
  /** GitHubログイン名 */
  login: string
}
