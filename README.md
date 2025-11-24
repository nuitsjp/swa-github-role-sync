# swa-github-role-sync

[![Coverage](https://raw.githubusercontent.com/nuitsjp/swa-github-role-sync/main/badges/coverage.svg)](https://github.com/nuitsjp/swa-github-role-sync)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Japanese](README.ja.md)

A reusable JavaScript Action that synchronizes Azure Static Web Apps (SWA) user/roles with users who have `admin` / `write` permissions on the target GitHub repository, notifies them via user-specific Discussions with invitation links, and publishes summary results to the GitHub Actions Job Summary. This approach treats SWA access management as a "snapshot of GitHub repository permissions," ideal for scenarios where you want to align access control with Pull Request workflows and branch protection policies.

> **Note**
> Operational workflows (CI, release, SWA synchronization) are now maintained in [`nuitsjp/swa-github-role-sync-ops`](https://github.com/nuitsjp/swa-github-role-sync-ops). This repository only hosts the Action code itself.

The dedicated [`swa-github-discussion-cleanup`](https://github.com/nuitsjp/swa-github-discussion-cleanup) Action (available separately) automatically deletes expired invitation Discussions, providing complete lifecycle management for invitation links.

## Overview

This Action combines the GitHub REST/GraphQL API and Azure CLI (`az staticwebapp ...`) to provide the following flow in a single workflow step:

1. Enumerate users with `admin` / `maintain` / `write` permissions in the target repository.
2. Retrieve GitHub provider user/role data registered in SWA.
3. Treat GitHub as the source of truth and generate a diff plan for users to add/update/remove.
4. Apply necessary users via `az staticwebapp users invite|update`, consolidating invitation links into a markdown summary.
5. Post generated invitation links as individual user Discussions and add sync result totals to `GITHUB_STEP_SUMMARY`.

## Core Features

- Maps GitHub `admin` ’ SWA custom role (default `github-admin`), `write/maintain` ’ SWA custom role (default `github-writer`).
- Diff detection with existing roles prevents duplicate invitations and unintended role changes.
- Supports Discussion title/body template customization, allowing insertion of @{login}, invite URL, date/repository name, and instructions to close the Discussion after authentication.
- Writes results to `core.summary` regardless of success/failure, enabling immediate status visibility from workflow execution logs.
- Can specify a different repository via `target-repo` for organization-wide membership synchronization.
- The `cleanup-discussions` Action automatically cleans up expired invitation Discussions (default 24-hour expiration).

## Prerequisites

### GitHub requirements

- GitHub Actions and Discussions must be enabled in the target repository.
- Workflow must have `discussions: write`, `contents: read`, and `id-token: write` permissions.
- Use `GITHUB_TOKEN` for `github-token`, or a PAT with `repo`, `discussions`, `read:org` scopes as needed.

### Azure requirements

- The target SWA (recommended: Standard plan) must be deployed and using GitHub authentication.
- OIDC authentication via `azure/login` must be completed so that the `az` CLI can execute `staticwebapp` commands.
- Specify accurate values for `swa-name` and `swa-resource-group` as confirmed in Azure Portal or CLI. If `swa-domain` is omitted, the default hostname will be resolved from `az staticwebapp show`.

## Quick Start

1. Enable the GitHub provider in your target SWA resource and confirm that user invitations can be executed from CLI.
2. Enable Discussions in your GitHub repository (Settings ’ General) and prepare a category (e.g., `Announcements`) to post invitation summaries.
3. Add the workflow below and register Azure federation credentials (Client ID, Tenant ID, Subscription ID) as repository or Organization secrets.

```yaml
name: Sync SWA roles

on:
  workflow_dispatch:
  schedule:
    - cron: '0 3 * * 1'

jobs:
  sync:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      discussions: write
      id-token: write
    steps:
      - uses: actions/checkout@v4

      - name: Azure login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Sync SWA role assignments
        uses: nuitsjp/swa-github-role-sync@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          swa-name: my-swa-app
          swa-resource-group: rg-app-prod
          discussion-category-name: Announcements

  cleanup:
    runs-on: ubuntu-latest
    permissions:
      discussions: write
    steps:
      - name: Cleanup expired discussions
        uses: nuitsjp/swa-github-discussion-cleanup@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          target-repo: my-org/my-repo
          discussion-category-name: Announcements
          expiration-hours: 168
```

## Inputs

| Name                          | Required | Default                                               | Description                                                                                                                                                                    |
| ----------------------------- | -------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `github-token`                | true     |                                                       | Token to retrieve repository collaborators and create Discussions.                                                                                                             |
| `target-repo`                 | false    | Current `owner/repo`                                  | Target repository to retrieve collaborators from. Specify when managing SWA with a different repository's permissions.                                                         |
| `swa-name`                    | true     |                                                       | Target Static Web App name.                                                                                                                                                    |
| `swa-resource-group`          | true     |                                                       | Resource group name of the Static Web App.                                                                                                                                     |
| `swa-domain`                  | false    | SWA default hostname                                  | Custom domain to include in invitation links. Resolved from `az staticwebapp show` when omitted.                                                                               |
| `invitation-expiration-hours` | false    | `168`                                                 | Invitation link expiration time (1-168 hours).                                                                                                                                 |
| `role-for-admin`              | false    | `github-admin`                                        | SWA role name assigned to GitHub `admin` users.                                                                                                                                |
| `role-for-write`              | false    | `github-writer`                                       | SWA role name assigned to GitHub `write`/`maintain` users.                                                                                                                     |
| `role-prefix`                 | false    | `github-`                                             | Prefix for SWA roles to be considered diff targets. Specify when using custom roles with `role-for-*`.                                                                         |
| `discussion-category-name`    | true     |                                                       | Discussion category name where invitation summaries will be posted.                                                                                                            |
| `discussion-title-template`   | false    | `SWA access invite for @{login} ({swaName}) - {date}` | Discussion title template. Supports placeholders: `{swaName}`, `{repo}`, `{date}`, `{login}`.                                                                                  |
| `discussion-body-template`    | false    | See `action.yml`                                      | Discussion body template. Supports placeholders: `{login}`, `{role}`, `{inviteUrl}`, `{invitationExpirationHours}`, and optionally `{summaryMarkdown}` for aggregated results. |

### Cleanup Discussions Inputs

| Name                        | Required | Default                                               | Description                                                                                                     |
| --------------------------- | -------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `github-token`              | true     |                                                       | Token for deleting Discussions.                                                                                 |
| `target-repo`               | false    | Current `owner/repo`                                  | Target repository from which to delete Discussions.                                                             |
| `discussion-category-name`  | true     |                                                       | Category name containing the Discussions to be deleted.                                                         |
| `expiration-hours`          | false    | `168`                                                 | Discussions created more than this many hours ago will be deleted.                                              |
| `cleanup-mode`              | false    | `expiration`                                          | `expiration` (default) deletes only expired, `immediate` deletes all matching discussions immediately.          |
| `discussion-title-template` | false    | `SWA access invite for @{login} ({swaName}) - {date}` | Title template to identify deletion targets (used for regex matching). Should match the template used for sync. |

## Outputs

| Name              | Description                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `added-count`     | Number of users newly invited.                                                           |
| `updated-count`   | Number of existing users whose roles were updated.                                       |
| `removed-count`   | Number of users whose roles were removed from SWA.                                       |
| `discussion-url`  | URL of the first created invitation Discussion (kept for backward compatibility).        |
| `discussion-urls` | Newline-separated URLs of all invitation Discussions (empty string when no invitations). |

## Usage Notes

- Each invitation creates a separate Discussion, and aggregate counts are displayed in `GITHUB_STEP_SUMMARY`. Use these appropriately for user notifications versus administrator summaries.
- When pointing `target-repo` to another repository, set a PAT with access to that target repository in `github-token`.
- The diff logic only synchronizes roles matching the `role-prefix`. When specifying custom roles with `role-for-*`, use the same prefix.
- Due to SWA specifications, users assignable to custom roles are limited to 25. This Action will error and abort if the sync target exceeds 25 users.
- Invitation link expiration defaults to 168 hours (7 days). You can change it to 1-168 hours via `invitation-expiration-hours`.

## Local Testing

```bash
npm install
npm run lint
npm test
npm run local-action
```

`npm run local-action` uses input values from `.env` for local execution, allowing you to verify templates and role settings before production deployment to Azure/GitHub. For CI-equivalent validation, use `npm run verify` and don't forget to run `npm run package` to keep `dist/` in sync.

## Troubleshooting

- `Discussion category "..." not found` failure: Verify that the Discussion category name matches and that Discussions are enabled in the workflow execution repository.
- `Failed to retrieve invite URL`: The `swa-domain` may specify a non-existent domain, or Azure CLI authorization may have expired. Check that the `azure/login` step succeeded and consider adding `az version` to verify CLI functionality.
- No diff when Action doesn't create Discussions: The Action displays `buildSummaryMarkdown` with `status: success` and all counts at 0 if already synchronized.

## Additional Documentation

- Detailed user guide: [docs/user-guide.md](docs/user-guide.md)
- Development, testing, and release procedures: [docs/dev-guide.md](docs/dev-guide.md)
- Architecture and design notes: [docs/architecture.md](docs/architecture.md)

## License

MIT License. See `LICENSE` for details.
