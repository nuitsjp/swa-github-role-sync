export type GitHubRole = 'admin' | 'write'

export type DesiredUser = {
  login: string
  role: GitHubRole
}

export type SwaUser = {
  userId?: string
  userDetails: string
  roles?: string
  provider?: string
}

export type PlanAdd = {
  login: string
  role: string
}

export type PlanUpdate = {
  login: string
  role: string
  currentRoles: string
}

export type PlanRemove = {
  login: string
  currentRoles: string
}

export type SyncPlan = {
  toAdd: PlanAdd[]
  toUpdate: PlanUpdate[]
  toRemove: PlanRemove[]
}

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
