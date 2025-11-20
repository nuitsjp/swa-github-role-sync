import { computeSyncPlan } from '../src/plan.js'
import type { DesiredUser, SwaUser } from '../src/types.js'

describe('computeSyncPlan', () => {
  const githubUsers: DesiredUser[] = [
    { login: 'alice', role: 'admin' },
    { login: 'bob', role: 'write' }
  ]

  const swaUsers: SwaUser[] = [
    { userDetails: 'bob', roles: 'github-writer', provider: 'GitHub' },
    { userDetails: 'carol', roles: 'github-writer', provider: 'GitHub' }
  ]

  // 最も基本的なadd/update/removeの仕分けができることを確認
  it('calculates add, update, and remove sets', () => {
    const plan = computeSyncPlan(
      githubUsers,
      swaUsers,
      'github-admin',
      'github-writer'
    )

    expect(plan.toAdd).toEqual([{ login: 'alice', role: 'github-admin' }])
    expect(plan.toUpdate).toEqual([])
    expect(plan.toRemove).toEqual([
      { login: 'carol', currentRoles: 'github-writer' }
    ])
  })

  // ロール差分がある場合に更新対象へ入ることを検証
  it('marks updates when roles differ', () => {
    const plan = computeSyncPlan(
      githubUsers,
      [{ userDetails: 'alice', roles: 'old-role', provider: 'GitHub' }],
      'github-admin',
      'github-writer'
    )

    expect(plan.toAdd).toEqual([{ login: 'bob', role: 'github-writer' }])
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
      'github-admin',
      'github-writer'
    )

    expect(plan.toAdd).toEqual([])
    expect(plan.toUpdate).toEqual([
      { login: 'alice', role: 'github-writer', currentRoles: '' }
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
      'github-admin',
      'github-writer'
    )

    expect(plan.toAdd).toEqual([{ login: 'bob', role: 'github-writer' }])
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
      'github-admin',
      'github-writer'
    )

    expect(plan.toAdd).toEqual([{ login: 'bob', role: 'github-writer' }])
    expect(plan.toUpdate).toEqual([])
    expect(plan.toRemove).toEqual([])
  })

  // ログイン名が取得できないSWAユーザーを計画から除外するケース
  it('ignores SWA entries without any identifier data', () => {
    const plan = computeSyncPlan(
      githubUsers,
      [{ provider: 'GitHub', roles: 'github-admin' }],
      'github-admin',
      'github-writer'
    )

    expect(plan.toAdd).toEqual([
      { login: 'alice', role: 'github-admin' },
      { login: 'bob', role: 'github-writer' }
    ])
    expect(plan.toUpdate).toEqual([])
    expect(plan.toRemove).toEqual([])
  })

  // rolePrefixの上書きにより旧Prefix環境でも差分検出できるかを確認
  it('allows configuring the role prefix used for comparison', () => {
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
          roles: 'custom-writer',
          provider: 'GitHub'
        }
      ],
      'custom-admin',
      'custom-writer',
      { rolePrefix: 'custom-' }
    )

    expect(plan.toAdd).toEqual([])
    expect(plan.toUpdate).toEqual([
      { login: 'bob', role: 'custom-writer', currentRoles: 'legacy-role' }
    ])
    expect(plan.toRemove).toEqual([
      { login: 'carol', currentRoles: 'custom-writer' }
    ])
  })
})
