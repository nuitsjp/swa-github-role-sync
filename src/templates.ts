import type { InvitationResult, RemovalResult, UpdateResult } from './types.js'

export function fillTemplate(
  template: string,
  values: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '')
}

type SummaryParams = {
  repo: string
  swaName: string
  added: InvitationResult[]
  updated: UpdateResult[]
  removed: RemovalResult[]
}

export function buildSummaryMarkdown({
  repo,
  swaName,
  added,
  updated,
  removed
}: SummaryParams): string {
  const lines: string[] = [
    `- Repository: ${repo}`,
    `- Static Web App: ${swaName}`,
    `- Added: ${added.length}`,
    `- Updated: ${updated.length}`,
    `- Removed: ${removed.length}`
  ]

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
