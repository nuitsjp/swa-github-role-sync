import { buildSummaryMarkdown, fillTemplate } from '../src/templates.js'

describe('fillTemplate', () => {
  it('replaces placeholders', () => {
    const result = fillTemplate('Hello {name} - {env}', {
      name: 'world',
      env: 'prod'
    })
    expect(result).toBe('Hello world - prod')
  })

  it('omits unknown placeholders gracefully', () => {
    const result = fillTemplate('Hello {name} {missing}', {
      name: 'world'
    })
    expect(result).toBe('Hello world ')
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

    expect(markdown).toContain('Status: success')
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

  it('shows failure details and discussion link when provided', () => {
    const markdown = buildSummaryMarkdown({
      repo: 'owner/repo',
      swaName: 'my-swa',
      added: [],
      updated: [],
      removed: [],
      discussionUrl: 'https://github.com/owner/repo/discussions/1',
      status: 'failure',
      failureMessage: 'Azure CLI timed out'
    })

    expect(markdown).toContain('Status: failure')
    expect(markdown).toContain(
      'Discussion: https://github.com/owner/repo/discussions/1'
    )
    expect(markdown).toContain('Error: Azure CLI timed out')
  })
})
