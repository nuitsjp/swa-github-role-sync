import * as core from '@actions/core'
import * as github from '@actions/github'
import {
  clearUserRoles,
  inviteUser,
  listSwaUsers,
  updateUserRoles
} from './azure.js'
import {
  createDiscussion,
  listEligibleCollaborators,
  parseTargetRepo
} from './github.js'
import { computeSyncPlan } from './plan.js'
import { buildSummaryMarkdown, fillTemplate } from './templates.js'
import type { InvitationResult, RemovalResult, UpdateResult } from './types.js'

type Inputs = {
  githubToken: string
  targetRepo?: string
  swaName: string
  swaResourceGroup: string
  swaDomain: string
  roleForAdmin: string
  roleForWrite: string
  discussionCategoryName: string
  discussionTitleTemplate: string
  discussionBodyTemplate: string
}

function getInputs(): Inputs {
  return {
    githubToken: core.getInput('github-token', { required: true }),
    targetRepo: core.getInput('target-repo'),
    swaName: core.getInput('swa-name', { required: true }),
    swaResourceGroup: core.getInput('swa-resource-group', { required: true }),
    swaDomain: core.getInput('swa-domain', { required: true }),
    roleForAdmin: core.getInput('role-for-admin') || 'github-admin',
    roleForWrite: core.getInput('role-for-write') || 'github-writer',
    discussionCategoryName: core.getInput('discussion-category-name', {
      required: true
    }),
    discussionTitleTemplate:
      core.getInput('discussion-title-template') ||
      'SWA access invites for {swaName} ({repo}) - {date}',
    discussionBodyTemplate:
      core.getInput('discussion-body-template') ||
      `This discussion contains SWA access invite links for **{swaName}** from **{repo}**.

{summaryMarkdown}`
  }
}

function today(): string {
  return new Date().toISOString().split('T')[0]
}

export async function run(): Promise<void> {
  try {
    const inputs = getInputs()
    const { owner, repo } = parseTargetRepo(inputs.targetRepo)
    const repoFullName = `${owner}/${repo}`

    const octokit = github.getOctokit(inputs.githubToken)
    const githubUsers = await listEligibleCollaborators(octokit, owner, repo)

    core.info(
      `Found ${githubUsers.length} GitHub users with write/admin (owner/repo: ${repoFullName})`
    )

    const swaUsers = await listSwaUsers(inputs.swaName, inputs.swaResourceGroup)
    const plan = computeSyncPlan(
      githubUsers,
      swaUsers,
      inputs.roleForAdmin,
      inputs.roleForWrite
    )

    core.info(
      `Plan -> add:${plan.toAdd.length} update:${plan.toUpdate.length} remove:${plan.toRemove.length}`
    )

    const added: InvitationResult[] = []
    const updated: UpdateResult[] = []
    const removed: RemovalResult[] = []

    for (const add of plan.toAdd) {
      const inviteUrl = await inviteUser(
        inputs.swaName,
        inputs.swaResourceGroup,
        inputs.swaDomain,
        add.login,
        add.role
      )
      added.push({ login: add.login, role: add.role, inviteUrl })
      core.info(`Invited ${add.login} with role ${add.role}`)
    }

    for (const update of plan.toUpdate) {
      await updateUserRoles(
        inputs.swaName,
        inputs.swaResourceGroup,
        update.login,
        update.role
      )
      updated.push({ login: update.login, role: update.role })
      core.info(`Updated ${update.login} to role ${update.role}`)
    }

    for (const removal of plan.toRemove) {
      await clearUserRoles(
        inputs.swaName,
        inputs.swaResourceGroup,
        removal.login
      )
      removed.push({ login: removal.login })
      core.info(`Removed roles from ${removal.login}`)
    }

    const summaryMarkdown = buildSummaryMarkdown({
      repo: repoFullName,
      swaName: inputs.swaName,
      added,
      updated,
      removed
    })

    const templateValues = {
      swaName: inputs.swaName,
      repo: repoFullName,
      date: today(),
      summaryMarkdown
    }

    const discussionTitle = fillTemplate(
      inputs.discussionTitleTemplate,
      templateValues
    )
    const discussionBody = fillTemplate(
      inputs.discussionBodyTemplate,
      templateValues
    )

    let discussionUrl = ''
    try {
      discussionUrl = await createDiscussion(
        inputs.githubToken,
        owner,
        repo,
        inputs.discussionCategoryName,
        discussionTitle,
        discussionBody
      )
      core.info(`Created Discussion: ${discussionUrl}`)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown error creating discussion'
      core.warning(`Failed to create Discussion: ${message}`)
    }

    await core.summary
      .addHeading('SWA role sync')
      .addRaw(summaryMarkdown, true)
      .write()

    core.setOutput('added-count', added.length)
    core.setOutput('updated-count', updated.length)
    core.setOutput('removed-count', removed.length)
    core.setOutput('discussion-url', discussionUrl)
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('Unknown error')
    }
  }
}
