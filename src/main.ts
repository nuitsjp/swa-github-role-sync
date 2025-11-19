import * as core from '@actions/core'
import * as github from '@actions/github'
import {
  clearUserRoles,
  getSwaDefaultHostname,
  inviteUser,
  listSwaUsers,
  updateUserRoles
} from './azure.js'
import {
  createDiscussion,
  getDiscussionCategoryId,
  listEligibleCollaborators,
  parseTargetRepo
} from './github.js'
import { computeSyncPlan } from './plan.js'
import { buildSummaryMarkdown, fillTemplate } from './templates.js'
import type {
  DesiredUser,
  InvitationResult,
  RemovalResult,
  UpdateResult
} from './types.js'

const SWA_CUSTOM_ROLE_ASSIGNMENT_LIMIT = 25

function assertWithinSwaRoleLimit(users: DesiredUser[]): void {
  const uniqueLogins = new Set(
    users
      .map((user) => user.login.trim().toLowerCase())
      .filter((login) => login.length > 0)
  )
  if (uniqueLogins.size > SWA_CUSTOM_ROLE_ASSIGNMENT_LIMIT) {
    throw new Error(
      `SWA custom role assignment limit (${SWA_CUSTOM_ROLE_ASSIGNMENT_LIMIT}) exceeded: ${uniqueLogins.size} users require custom roles`
    )
  }
}

type Inputs = {
  githubToken: string
  targetRepo?: string
  swaName: string
  swaResourceGroup: string
  swaDomain?: string
  roleForAdmin: string
  roleForWrite: string
  rolePrefix: string
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
    swaDomain: core.getInput('swa-domain'),
    roleForAdmin: core.getInput('role-for-admin') || 'github-admin',
    roleForWrite: core.getInput('role-for-write') || 'github-writer',
    rolePrefix: core.getInput('role-prefix') || 'github-',
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
  let inputs: Inputs | undefined
  let repoFullName = ''
  let summaryMarkdown = ''
  let discussionUrl = ''

  const added: InvitationResult[] = []
  const updated: UpdateResult[] = []
  const removed: RemovalResult[] = []

  try {
    inputs = getInputs()
    const { owner, repo } = parseTargetRepo(inputs.targetRepo)
    repoFullName = `${owner}/${repo}`

    const categoryIds = await getDiscussionCategoryId(
      inputs.githubToken,
      owner,
      repo,
      inputs.discussionCategoryName
    )

    const swaDomain =
      inputs.swaDomain ||
      (await getSwaDefaultHostname(inputs.swaName, inputs.swaResourceGroup))
    core.info(`Using SWA domain: ${swaDomain}`)

    const octokit = github.getOctokit(inputs.githubToken)
    const githubUsers = await listEligibleCollaborators(octokit, owner, repo)

    core.info(
      `Found ${githubUsers.length} GitHub users with write/admin (owner/repo: ${repoFullName})`
    )

    assertWithinSwaRoleLimit(githubUsers)

    const swaUsers = await listSwaUsers(inputs.swaName, inputs.swaResourceGroup)
    const plan = computeSyncPlan(
      githubUsers,
      swaUsers,
      inputs.roleForAdmin,
      inputs.roleForWrite,
      { rolePrefix: inputs.rolePrefix }
    )

    core.info(
      `Plan -> add:${plan.toAdd.length} update:${plan.toUpdate.length} remove:${plan.toRemove.length}`
    )

    for (const add of plan.toAdd) {
      const inviteUrl = await inviteUser(
        inputs.swaName,
        inputs.swaResourceGroup,
        swaDomain,
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

    const syncSummaryMarkdown = buildSummaryMarkdown({
      repo: repoFullName,
      swaName: inputs.swaName,
      added,
      updated,
      removed,
      status: 'success'
    })

    const templateValues = {
      swaName: inputs.swaName,
      repo: repoFullName,
      date: today(),
      summaryMarkdown: syncSummaryMarkdown
    }

    const missingTemplateKeys = new Set<string>()
    const onMissingKey = (key: string): void => {
      missingTemplateKeys.add(key)
    }

    const discussionTitle = fillTemplate(
      inputs.discussionTitleTemplate,
      templateValues,
      { onMissingKey }
    )
    const discussionBodyTemplate = inputs.discussionBodyTemplate
    const discussionBody = fillTemplate(
      discussionBodyTemplate,
      templateValues,
      {
        onMissingKey
      }
    )

    if (!discussionBodyTemplate.includes('{summaryMarkdown}')) {
      core.warning(
        'discussion-body-template does not include {summaryMarkdown}; sync summary will not be added to the discussion body.'
      )
    }

    if (missingTemplateKeys.size) {
      core.warning(
        `Unknown template placeholders with no value: ${[
          ...missingTemplateKeys
        ].join(', ')}`
      )
    }

    try {
      discussionUrl = await createDiscussion(
        inputs.githubToken,
        owner,
        repo,
        inputs.discussionCategoryName,
        discussionTitle,
        discussionBody,
        categoryIds
      )
      core.info(`Created Discussion: ${discussionUrl}`)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown error creating discussion'
      throw new Error(`Failed to create Discussion: ${message}`)
    }

    summaryMarkdown = buildSummaryMarkdown({
      repo: repoFullName,
      swaName: inputs.swaName,
      added,
      updated,
      removed,
      discussionUrl,
      status: 'success'
    })

    core.setOutput('added-count', added.length)
    core.setOutput('updated-count', updated.length)
    core.setOutput('removed-count', removed.length)
    core.setOutput('discussion-url', discussionUrl)
  } catch (error) {
    if (error instanceof Error) {
      core.error(error.message)
      summaryMarkdown =
        summaryMarkdown ||
        buildSummaryMarkdown({
          repo: repoFullName || 'unknown',
          swaName: inputs?.swaName ?? 'unknown',
          added,
          updated,
          removed,
          discussionUrl,
          status: 'failure',
          failureMessage: error.message
        })
      core.setFailed(error.message)
    } else {
      summaryMarkdown =
        summaryMarkdown ||
        buildSummaryMarkdown({
          repo: repoFullName || 'unknown',
          swaName: inputs?.swaName ?? 'unknown',
          added,
          updated,
          removed,
          discussionUrl,
          status: 'failure',
          failureMessage: 'Unknown error'
        })
      core.error('Unknown error')
      core.setFailed('Unknown error')
    }
  } finally {
    if (summaryMarkdown) {
      await core.summary
        .addHeading('SWA role sync')
        .addRaw(summaryMarkdown, true)
        .write()
    }
  }
}
