// GitHub側の権限で同期対象を仕分けるための種別
export type GitHubRole = 'admin' | 'write'

// GitHubのコラボレーターリストから抽出した理想状態
export type DesiredUser = {
  login: string
  role: GitHubRole
}

// Azure CLIの応答を最小限の情報で扱うための型
export type SwaUser = {
  userId?: string
  userDetails?: string
  displayName?: string
  roles?: string
  provider?: string
}

// 差分計画で新規招待するユーザー
export type PlanAdd = {
  login: string
  role: string
}

// 既存ユーザーのロール更新情報
export type PlanUpdate = {
  login: string
  role: string
  currentRoles: string
}

// 不要になったユーザーの削除情報
export type PlanRemove = {
  login: string
  currentRoles: string
}

// 全体の同期計画
export type SyncPlan = {
  toAdd: PlanAdd[]
  toUpdate: PlanUpdate[]
  toRemove: PlanRemove[]
}

// Azure CLIの実行結果をまとめてJobサマリーに書き出すための型
export type InvitationResult = {
  login: string
  role: string
  inviteUrl: string
}

export type UpdateResult = {
  login: string
  role: string
}

export type RemovalResult = {
  login: string
}
