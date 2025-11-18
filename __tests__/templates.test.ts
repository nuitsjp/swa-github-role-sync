import { buildSummaryMarkdown, fillTemplate } from '../src/templates.js'

describe('fillTemplate', () => {
  it('replaces placeholders', () => {
    const result = fillTemplate('Hello {name} - {env}', {
      name: 'world',
      env: 'prod'
    })
    expect(result).toBe('Hello world - prod')
  })
})

describe('buildSummaryMarkdown', () => {
  it('renders counts and sections', () => {
    const markdown = buildSummaryMarkdown({
      repo: 'owner/repo',
      swaName: 'my-swa',
      added: [
        { login: 'alice', role: 'github-admin', inviteUrl: 'https://url' }
      ],
      updated: [{ login: 'bob', role: 'github-writer' }],
      removed: [{ login: 'carol' }]
    })

    expect(markdown).toContain('Repository: owner/repo')
    expect(markdown).toContain('Static Web App: my-swa')
    expect(markdown).toContain('Added: 1')
    expect(markdown).toContain('Updated: 1')
    expect(markdown).toContain('Removed: 1')
    expect(markdown).toContain('@alice')
    expect(markdown).toContain('[Invite link](https://url)')
    expect(markdown).toContain('Updated roles')
    expect(markdown).toContain('Removed users')
  })
})
