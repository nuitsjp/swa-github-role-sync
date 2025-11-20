import type { InvitationResult, RemovalResult, UpdateResult } from './types.js'

type FillTemplateOptions = {
  onMissingKey?: (key: string) => void
}

// Discussionのテンプレート文字列に{key}形式で値を埋め込み、未定義キーはコールバックで通知する
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

type SummaryParams = {
  repo: string
  swaName: string
  added: InvitationResult[]
  updated: UpdateResult[]
  removed: RemovalResult[]
  discussionUrl?: string
  status?: 'success' | 'failure'
  failureMessage?: string
}

// Jobサマリー兼Discussion本文に貼り付けるMarkdownを合成する
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
