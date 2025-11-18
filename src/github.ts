import * as core from '@actions/core'
import * as github from '@actions/github'
import { graphql } from '@octokit/graphql'
import type { DesiredUser } from './types.js'

type Collaborator = {
  login: string
  permissions?: {
    admin?: boolean
    maintain?: boolean
    push?: boolean
  }
}

export function parseTargetRepo(
  input: string | undefined,
  contextRepo = github.context.repo
): { owner: string; repo: string } {
  if (!input) {
    return { owner: contextRepo.owner, repo: contextRepo.repo }
  }
  const [owner, repo] = input.split('/')
  if (!owner || !repo) {
    throw new Error(`Invalid target-repo format: ${input}`)
  }
  return { owner, repo }
}

function toRole(collaborator: Collaborator): DesiredUser | null {
  const { login, permissions } = collaborator
  if (permissions?.admin) {
    return { login, role: 'admin' }
  }
  if (permissions?.maintain || permissions?.push) {
    return { login, role: 'write' }
  }
  return null
}

export async function listEligibleCollaborators(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string
): Promise<DesiredUser[]> {
  const collaborators = await octokit.paginate(
    octokit.rest.repos.listCollaborators,
    {
      owner,
      repo,
      per_page: 100,
      affiliation: 'all'
    }
  )
  const desired = collaborators
    .map(toRole)
    .filter((user): user is DesiredUser => Boolean(user))

  core.debug(`Eligible collaborators: ${desired.length}`)
  return desired
}

async function findDiscussionCategoryId(
  token: string,
  owner: string,
  repo: string,
  categoryName: string
): Promise<{ repositoryId: string; categoryId: string }> {
  const graphqlClient = graphql.defaults({
    headers: { authorization: `token ${token}` }
  })

  const query = await graphqlClient<{
    repository: {
      id: string
      discussionCategories: { nodes: { id: string; name: string }[] }
    }
  }>(
    `
      query ($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          id
          discussionCategories(first: 100) {
            nodes {
              id
              name
            }
          }
        }
      }
    `,
    { owner, repo }
  )

  const category = query.repository.discussionCategories.nodes.find(
    (node) => node.name === categoryName
  )
  if (!category) {
    throw new Error(`Discussion category "${categoryName}" not found`)
  }
  return { repositoryId: query.repository.id, categoryId: category.id }
}

export async function createDiscussion(
  token: string,
  owner: string,
  repo: string,
  categoryName: string,
  title: string,
  body: string
): Promise<string> {
  const graphqlClient = graphql.defaults({
    headers: { authorization: `token ${token}` }
  })
  const { repositoryId, categoryId } = await findDiscussionCategoryId(
    token,
    owner,
    repo,
    categoryName
  )

  const mutation = await graphqlClient<{
    createDiscussion: { discussion: { url: string } }
  }>(
    `
      mutation (
        $repositoryId: ID!
        $categoryId: ID!
        $title: String!
        $body: String!
      ) {
        createDiscussion(
          input: {
            repositoryId: $repositoryId
            categoryId: $categoryId
            title: $title
            body: $body
          }
        ) {
          discussion {
            url
          }
        }
      }
    `,
    { repositoryId, categoryId, title, body }
  )
  return mutation.createDiscussion.discussion.url
}
