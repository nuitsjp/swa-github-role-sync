import { computeSyncPlan } from '../src/plan.js'
import type { DesiredUser, SwaUser } from '../src/types.js'

describe('computeSyncPlan', () => {
  const githubUsers: DesiredUser[] = [
    { login: 'alice', role: 'admin' },
    { login: 'bob', role: 'write' }
  ]

  const swaUsers: SwaUser[] = [
    { userDetails: 'bob', roles: 'github-write', provider: 'GitHub' },
    { userDetails: 'carol', roles: 'github-write', provider: 'GitHub' }
  ]

  const defaultRoleMapping = {
    admin: 'github-admin',
    maintain: 'github-maintain',
    write: 'github-write',
    triage: 'github-triage',
    read: 'github-read'
  }

  // 最も基本的なadd/update/removeの仕分けができることを確認
  it('calculates add, update, and remove sets', () => {
    const plan = computeSyncPlan(githubUsers, swaUsers, defaultRoleMapping)

    expect(plan.toAdd).toEqual([{ login: 'alice', role: 'github-admin' }])
    expect(plan.toUpdate).toEqual([])
    expect(plan.toRemove).toEqual([
      { login: 'carol', currentRoles: 'github-write' }
    ])
  })

  // ロール差分がある場合に更新対象へ入ることを検証
  it('marks updates when roles differ', () => {
    const plan = computeSyncPlan(
      githubUsers,
      [{ userDetails: 'alice', roles: 'old-role', provider: 'GitHub' }],
      defaultRoleMapping
    )

    expect(plan.toAdd).toEqual([{ login: 'bob', role: 'github-write' }])
    expect(plan.toUpdate).toEqual([
      { login: 'alice', role: 'github-admin', currentRoles: 'old-role' }
    ])
    expect(plan.toRemove).toEqual([])
  })

  // ログイン名の大小・空白や空ロールを正規化できるかをテスト
  it('normalizes logins and handles missing roles', () => {
    const plan = computeSyncPlan(
      [{ login: ' Alice ', role: 'write' }],
      [
        { userDetails: 'alice', provider: 'GitHub' },
        { userDetails: 'bob', provider: 'GitHub' }
      ],
      defaultRoleMapping
    )

    expect(plan.toAdd).toEqual([])
    expect(plan.toUpdate).toEqual([
      { login: 'alice', role: 'github-write', currentRoles: '' }
    ])
    expect(plan.toRemove).toEqual([{ login: 'bob', currentRoles: '' }])
  })

  // userDetailsが無いSWAユーザーでもdisplayNameでマッチさせられること
  it('falls back to displayName when userDetails are missing', () => {
    const plan = computeSyncPlan(
      githubUsers,
      [
        {
          displayName: 'Alice',
          provider: 'GitHub',
          roles: 'github-admin'
        }
      ],
      defaultRoleMapping
    )

    expect(plan.toAdd).toEqual([{ login: 'bob', role: 'github-write' }])
    expect(plan.toUpdate).toEqual([])
    expect(plan.toRemove).toEqual([])
  })

  // anonymous/authenticatedのような既定ロールを比較から外す挙動
  it('ignores Azure default roles when comparing desired roles', () => {
    const plan = computeSyncPlan(
      githubUsers,
      [
        {
          userDetails: 'alice',
          roles: 'github-admin,anonymous,authenticated',
          provider: 'GitHub'
        }
      ],
      defaultRoleMapping
    )

    expect(plan.toAdd).toEqual([{ login: 'bob', role: 'github-write' }])
    expect(plan.toUpdate).toEqual([])
    expect(plan.toRemove).toEqual([])
  })

  // ログイン名が取得できないSWAユーザーを計画から除外するケース
  it('ignores SWA entries without any identifier data', () => {
    const plan = computeSyncPlan(
      githubUsers,
      [{ provider: 'GitHub', roles: 'github-admin' }],
      defaultRoleMapping
    )

    expect(plan.toAdd).toEqual([
      { login: 'alice', role: 'github-admin' },
      { login: 'bob', role: 'github-write' }
    ])
    expect(plan.toUpdate).toEqual([])
    expect(plan.toRemove).toEqual([])
  })

  // rolePrefixの上書きにより旧Prefix環境でも差分検出できるかを確認
  it('allows configuring the role prefix used for comparison', () => {
    const customRoleMapping = {
      admin: 'custom-admin',
      maintain: 'custom-maintain',
      write: 'custom-write',
      triage: 'custom-triage',
      read: 'custom-read'
    }
    const plan = computeSyncPlan(
      githubUsers,
      [
        {
          userDetails: 'alice',
          roles: 'custom-admin,anonymous',
          provider: 'GitHub'
        },
        {
          userDetails: 'bob',
          roles: 'legacy-role',
          provider: 'GitHub'
        },
        {
          userDetails: 'carol',
          roles: 'custom-write',
          provider: 'GitHub'
        }
      ],
      customRoleMapping,
      { rolePrefix: 'custom-' }
    )

    expect(plan.toAdd).toEqual([])
    expect(plan.toUpdate).toEqual([
      { login: 'bob', role: 'custom-write', currentRoles: 'legacy-role' }
    ])
    expect(plan.toRemove).toEqual([
      { login: 'carol', currentRoles: 'custom-write' }
    ])
  })

  // 5段階の権限すべてを正しくマッピングできることを確認
  it('maps all 5 permission levels to corresponding SWA roles', () => {
    const allLevelUsers: DesiredUser[] = [
      { login: 'admin-user', role: 'admin' },
      { login: 'maintain-user', role: 'maintain' },
      { login: 'write-user', role: 'write' },
      { login: 'triage-user', role: 'triage' },
      { login: 'read-user', role: 'read' }
    ]

    const plan = computeSyncPlan(allLevelUsers, [], defaultRoleMapping)

    expect(plan.toAdd).toEqual([
      { login: 'admin-user', role: 'github-admin' },
      { login: 'maintain-user', role: 'github-maintain' },
      { login: 'write-user', role: 'github-write' },
      { login: 'triage-user', role: 'github-triage' },
      { login: 'read-user', role: 'github-read' }
    ])
  })

  // maintain権限のユーザーがロール更新される場合
  it('updates maintain role correctly', () => {
    const plan = computeSyncPlan(
      [{ login: 'user', role: 'maintain' }],
      [{ userDetails: 'user', roles: 'github-write', provider: 'GitHub' }],
      defaultRoleMapping
    )

    expect(plan.toUpdate).toEqual([
      { login: 'user', role: 'github-maintain', currentRoles: 'github-write' }
    ])
  })
})
