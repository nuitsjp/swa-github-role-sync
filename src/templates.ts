import type { InvitationResult, RemovalResult, UpdateResult } from './types.js'

/** テンプレート置換オプション */
type FillTemplateOptions = {
  /** 未定義キーが見つかった際のコールバック */
  onMissingKey?: (key: string) => void
}

/**
 * テンプレート文字列の{key}形式プレースホルダーを値で置換する。
 * @param template テンプレート文字列。
 * @param values 置換値のマップ。
 * @param options 未定義キー通知用のコールバック。
 * @returns 置換済み文字列。
 */
export function fillTemplate(
  template: string,
  values: Record<string, string>,
  options: FillTemplateOptions = {}
): string {
  const { onMissingKey } = options
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    if (values[key] === undefined) {
      onMissingKey?.(key)
    }
    return values[key] ?? ''
  })
}

/** サマリーMarkdown生成パラメーター */
type SummaryParams = {
  /** リポジトリ名（owner/repo形式） */
  repo: string
  /** Static Web App名 */
  swaName: string
  /** 招待したユーザー */
  added: InvitationResult[]
  /** 更新したユーザー */
  updated: UpdateResult[]
  /** 削除したユーザー */
  removed: RemovalResult[]
  /** Discussion URL */
  discussionUrl?: string
  /** 同期ステータス */
  status?: 'success' | 'failure'
  /** 失敗時のエラーメッセージ */
  failureMessage?: string
}

/**
 * JobサマリーおよびDiscussion本文用のMarkdownを生成する。
 * @param params サマリー生成に必要なパラメーター。
 * @returns Markdown形式のサマリー文字列。
 */
export function buildSummaryMarkdown({
  repo,
  swaName,
  added,
  updated,
  removed,
  discussionUrl,
  status = 'success',
  failureMessage
}: SummaryParams): string {
  const lines: string[] = [
    `- Status: ${status}`,
    `- Repository: ${repo}`,
    `- Static Web App: ${swaName}`,
    `- Added: ${added.length}`,
    `- Updated: ${updated.length}`,
    `- Removed: ${removed.length}`
  ]

  if (discussionUrl) {
    lines.push(`- Discussion: ${discussionUrl}`)
  }

  if (status === 'failure' && failureMessage) {
    lines.push(`- Error: ${failureMessage}`)
  }

  const sections: string[] = []

  if (added.length) {
    sections.push(
      [
        '### Invited users',
        ...added.map(
          (invite) =>
            `- @${invite.login} (${invite.role}) - [Invite link](${invite.inviteUrl})`
        )
      ].join('\n')
    )
  }

  if (updated.length) {
    sections.push(
      [
        '### Updated roles',
        ...updated.map((update) => `- @${update.login} → ${update.role}`)
      ].join('\n')
    )
  }

  if (removed.length) {
    sections.push(
      ['### Removed users', ...removed.map((user) => `- @${user.login}`)].join(
        '\n'
      )
    )
  }

  return [lines.join('\n'), sections.join('\n\n')].filter(Boolean).join('\n\n')
}
