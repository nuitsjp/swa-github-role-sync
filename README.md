# swa-github-role-sync

[![NPM CI](https://github.com/nuitsjp/swa-github-role-sync-ops/actions/workflows/npm-ci.yml/badge.svg)](https://github.com/nuitsjp/swa-github-role-sync-ops/actions/workflows/npm-ci.yml)
[![Deploy Site](https://github.com/nuitsjp/swa-github-role-sync-ops/actions/workflows/deploy-site.yml/badge.svg)](https://github.com/nuitsjp/swa-github-role-sync-ops/actions/workflows/deploy-site.yml)
[![Role Sync (Released)](https://github.com/nuitsjp/swa-github-role-sync-ops/actions/workflows/role-sync-released.yml/badge.svg)](https://github.com/nuitsjp/swa-github-role-sync-ops/actions/workflows/role-sync-released.yml)
[![swa-github-role-sync](https://img.shields.io/github/v/release/nuitsjp/swa-github-role-sync?label=role-sync)](https://github.com/nuitsjp/swa-github-role-sync/releases/latest)
[![swa-github-discussion-cleanup](https://img.shields.io/github/v/release/nuitsjp/swa-github-discussion-cleanup?label=discussion-cleanup)](https://github.com/nuitsjp/swa-github-discussion-cleanup/releases/latest)

[Japanese](README.ja.md)

Provides reusable GitHub Actions for controlling access to Azure Static Web Apps (SWA) based on GitHub repository permissions.

When hosting documentation on SWA that is associated with a GitHub repository, you can achieve access control such as "only users with read permission to the repository can view the content." This Action automatically syncs GitHub repository permissions (admin/maintain/write/triage/read) to SWA custom roles, and notifies target users with invitation links via GitHub Discussions.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Creating Azure Resources](#creating-azure-resources)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)
- [License](#license)

## Overview

### Problem Statement

When publishing documentation related to a GitHub repository on SWA, the following challenges exist:

- SWA authentication/authorization is not linked to GitHub repository permissions
- SWA role assignments must be manually updated when repository permissions change
- Managing invitation link expiration is cumbersome

### Provided Actions

This repository provides the following two reusable GitHub Actions:

| Action                                                                                    | Description                                                                                                               |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [swa-github-role-sync](https://github.com/nuitsjp/swa-github-role-sync)                   | Syncs users with GitHub repository permissions to SWA custom roles and notifies them via Discussion with invitation links |
| [swa-github-discussion-cleanup](https://github.com/nuitsjp/swa-github-discussion-cleanup) | Automatically deletes expired invitation Discussions                                                                      |

## Features

### swa-github-role-sync

- 1:1 mapping between GitHub permissions and SWA roles (5 levels)
  - `admin` → `github-admin`
  - `maintain` → `github-maintain`
  - `write` → `github-write`
  - `triage` → `github-triage`
  - `read` → `github-read`
- Configurable minimum permission level for sync targets via `minimum-permission` (default: `write`)
- Duplicate invitation suppression through diff detection
- Automatic creation of invitation Discussions for each user
- Sync result summary output to `GITHUB_STEP_SUMMARY`

### swa-github-discussion-cleanup

- Automatic deletion of expired Discussions based on creation date
- Filtering of deletion targets using title templates
- Immediate deletion mode for manual execution

## Prerequisites

- **On Windows, use WSL (Windows Subsystem for Linux).** Setup scripts are written in Bash.
- Azure CLI (`az`) and GitHub CLI (`gh`) must be installed and logged in.
- Enable Discussions on the target repository and prepare a category for posting invitation notifications (e.g., `Announcements`).
- Create a GitHub App (`Administration: read`, `Discussions: read & write`, and `Members: read` if needed). Note the App ID and private key.
- The workflow must have `permissions` configured for `contents: read` / `discussions: write` / `id-token: write`.

## Getting Started

If Azure resources (Static Web App, managed identity, etc.) already exist, start from the Secrets configuration. If you need to create Azure resources, refer to the "[Creating Azure Resources](#creating-azure-resources)" section first.

### 1. Secrets Configuration

#### Required Secrets

Register the following Secrets in your repository or Organization:

| Secret                            | Description                             |
| --------------------------------- | --------------------------------------- |
| `AZURE_CLIENT_ID`                 | Client ID for Azure OIDC authentication |
| `AZURE_TENANT_ID`                 | Azure tenant ID                         |
| `AZURE_SUBSCRIPTION_ID`           | Azure subscription ID                   |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | SWA deployment token                    |
| `ROLE_SYNC_APP_ID`                | GitHub App ID                           |
| `ROLE_SYNC_APP_PRIVATE_KEY`       | GitHub App private key                  |

#### GitHub App Creation Notes (UI Operations)

1. Create a "New GitHub App" from GitHub's "Developer settings > GitHub Apps".
2. Grant `Administration (Read-only)` and `Discussions (Read & write)` under **Repository permissions**. If using Organization member information, grant `Members (Read-only)` under **Organization permissions**.
3. Install the App on the target Organization/repository, obtain the App ID and Private key (`.pem`), and register them in Secrets.

#### Registering Secrets for GitHub App

Manually register Secrets for the GitHub App:

```bash
gh secret set ROLE_SYNC_APP_ID --body "123456"
gh secret set ROLE_SYNC_APP_PRIVATE_KEY < role-sync-app.private-key.pem
```

For Organization Secrets, add `--org <ORG>` and optionally limit visibility with `--repos`.

### 2. SWA Route Configuration

To enable role-based access control on SWA, configure `routes` in `staticwebapp.config.json`.

#### Basic Example: Allow Access Only to Users with Specific Roles or Above

```json
{
  "routes": [
    {
      "route": "/*",
      "allowedRoles": ["github-admin", "github-maintain", "github-write"]
    }
  ],
  "responseOverrides": {
    "401": {
      "redirect": "/.auth/login/github",
      "statusCode": 302
    }
  }
}
```

#### Role-Based Resource Access Restrictions

Example of separating admin-only areas from general user areas:

```json
{
  "routes": [
    {
      "route": "/admin/*",
      "allowedRoles": ["github-admin"]
    },
    {
      "route": "/internal/*",
      "allowedRoles": ["github-admin", "github-maintain", "github-write"]
    },
    {
      "route": "/*",
      "allowedRoles": [
        "github-admin",
        "github-maintain",
        "github-write",
        "github-triage",
        "github-read"
      ]
    }
  ],
  "responseOverrides": {
    "401": {
      "redirect": "/.auth/login/github",
      "statusCode": 302
    },
    "403": {
      "rewrite": "/403.html",
      "statusCode": 403
    }
  }
}
```

In this example:

- `/admin/*`: Accessible only by `github-admin` role
- `/internal/*`: Accessible by `github-admin`, `github-maintain`, `github-write` roles
- `/*`: Accessible by all synced roles

Specify the roles to allow in `allowedRoles` according to your `minimum-permission` and `role-for-*` settings. For details, see the [Azure Static Web Apps route configuration documentation](https://learn.microsoft.com/en-us/azure/static-web-apps/configuration).

### 3. Workflow Setup

#### Add Role Sync Workflow

Create `.github/workflows/role-sync.yml`. Change `swa-name`, `swa-resource-group`, and `discussion-category-name` to match your environment.

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
      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
      - name: Sync SWA role assignments
        uses: nuitsjp/swa-github-role-sync@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          swa-name: my-swa-app
          swa-resource-group: my-swa-rg
          discussion-category-name: Announcements
```

#### Add Invitation Discussion Cleanup Workflow (Optional)

Setting `cleanup-mode` to `immediate` enables immediate deletion during manual execution. For scheduled runs, maintaining `expiration` is safer.

```yaml
name: Cleanup invite discussions
on:
  schedule:
    - cron: '0 4 * * 1'
  workflow_dispatch:

jobs:
  cleanup:
    runs-on: ubuntu-latest
    permissions:
      discussions: write
    steps:
      - uses: nuitsjp/swa-github-discussion-cleanup@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          discussion-category-name: Announcements
          expiration-hours: 168
          cleanup-mode: ${{ github.event_name == 'workflow_dispatch' && 'immediate' || 'expiration' }}
```

### 4. Running Workflows

```bash
# Run role sync manually
gh workflow run role-sync.yml --ref main

# Check execution results
gh run watch --exit-status

# Run invitation Discussion cleanup manually
gh workflow run cleanup-invite-discussions.yml --ref main
```

### 5. Verify Results

- The number of invitations and updates are displayed in `GITHUB_STEP_SUMMARY`. Check via GitHub Web UI or `gh run view --log`.
- Invitation Discussions are created in the specified category with invitation URLs in the body.
- The cleanup workflow outputs the number of deleted items.

## Creating Azure Resources

If Azure resources are not yet created, follow these steps to create a resource group, Static Web App, managed identity, and configure OIDC login from GitHub Actions.

### Bulk Creation with Setup Script

Run the following command to create all necessary resources at once:

```bash
curl -fsSL https://raw.githubusercontent.com/nuitsjp/swa-github-role-sync-ops/main/scripts/setup-azure-resources.sh | bash -s -- <owner> <repository>
```

**Example:**

```bash
curl -fsSL https://raw.githubusercontent.com/nuitsjp/swa-github-role-sync-ops/main/scripts/setup-azure-resources.sh | bash -s -- nuitsjp swa-github-role-sync-ops
```

**Output:**

```
=== Azure Resource Setup for swa-github-role-sync-ops ===
Resource Group: rg-swa-github-role-sync-ops-prod
Static Web App: stapp-swa-github-role-sync-ops-prod
Managed Identity: id-swa-github-role-sync-ops-prod
GitHub Repo: nuitsjp/swa-github-role-sync-ops

[1/6] Creating Resource Group...
  Created: rg-swa-github-role-sync-ops-prod
[2/6] Creating Static Web App...
  Created: stapp-swa-github-role-sync-ops-prod
  Hostname: white-pond-06cee3400.3.azurestaticapps.net
[3/6] Creating Managed Identity...
  Created: id-swa-github-role-sync-ops-prod
  Client ID: a58912f6-5e94-4cf7-a68f-84a8f8537781
[4/6] Creating Federated Credential...
  Created: fc-github-actions-main
[5/6] Assigning RBAC role...
  Assigned Contributor role to id-swa-github-role-sync-ops-prod
[6/6] Registering GitHub Secrets...
  AZURE_CLIENT_ID: a58912f6-5e94-4cf7-a68f-84a8f8537781
  AZURE_TENANT_ID: fe689afa-3572-4db9-8e8a-0f81d5a9d253
  AZURE_SUBSCRIPTION_ID: fc7753ed-2e69-4202-bb66-86ff5798b8d5

=== Setup Complete ===
SWA URL: https://white-pond-06cee3400.3.azurestaticapps.net
```

The script automatically executes the following:

1. Create resource group (`rg-<repository>-prod`)
2. Create Static Web App (`stapp-<repository>-prod`, Standard SKU)
3. Create managed identity (`id-<repository>-prod`)
4. Create OIDC federated credential
5. Assign Contributor role
6. Register GitHub Secrets (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`)

### Resource Naming Convention

Based on the Azure Cloud Adoption Framework's [resource abbreviation guidance](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations), the following naming conventions are used:

| Resource Type    | Prefix  | Example                               |
| ---------------- | ------- | ------------------------------------- |
| Resource Group   | `rg`    | `rg-swa-github-role-sync-ops-prod`    |
| Static Web App   | `stapp` | `stapp-swa-github-role-sync-ops-prod` |
| Managed Identity | `id`    | `id-swa-github-role-sync-ops-prod`    |

## Configuration

### Changing Sync Target Permission Level

Use `minimum-permission` to specify the minimum permission level for sync targets:

| `minimum-permission` | Sync Targets                         |
| -------------------- | ------------------------------------ |
| `read`               | read, triage, write, maintain, admin |
| `triage`             | triage, write, maintain, admin       |
| `write`              | write, maintain, admin (default)     |
| `maintain`           | maintain, admin                      |
| `admin`              | admin only                           |

```yaml
- uses: nuitsjp/swa-github-role-sync@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    swa-name: my-swa-app
    swa-resource-group: my-swa-rg
    discussion-category-name: Announcements
    minimum-permission: read # Sync all users with read or above
```

### Customizing Role Names

You can configure SWA role names corresponding to each GitHub permission:

| Parameter           | Default           | Description                      |
| ------------------- | ----------------- | -------------------------------- |
| `role-for-admin`    | `github-admin`    | SWA role for admin permission    |
| `role-for-maintain` | `github-maintain` | SWA role for maintain permission |
| `role-for-write`    | `github-write`    | SWA role for write permission    |
| `role-for-triage`   | `github-triage`   | SWA role for triage permission   |
| `role-for-read`     | `github-read`     | SWA role for read permission     |

### Other Settings

- **Sync based on another repository's permissions**
  Specify `owner/repo` in `target-repo` and provide a PAT with access to the target repository in `github-token`.
- **Changing templates**
  Templates support placeholders such as `{login}`, `{role}`, `{inviteUrl}`, `{swaName}`, `{repo}`, `{date}`. Configure the same template on the Discussion cleanup side as well.
- **Invitation link expiration**
  Changing `invitation-expiration-hours` (default 168 hours) requires matching the `expiration-hours` in the cleanup workflow.
- **Using custom domain**
  Specifying a domain like `https://example.com` in `swa-domain` generates invitation URLs with that domain.

## Troubleshooting

- `Discussion category "..." not found`: Category name is incorrect or Discussions are disabled. Check your settings.
- `Resource not accessible by integration`: Insufficient `github-token` permissions. Check the `permissions` block and token scopes.
- Sync completes with 0 invitations: If already synced, it completes without changes. Note that differences in `role-prefix` exclude items from diff detection.

## Documentation

| Document                                                                                  | Contents                                                       |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [docs/developer-guide.md](docs/developer-guide.md)                                        | Development environment setup, testing, and release procedures |
| [swa-github-role-sync](https://github.com/nuitsjp/swa-github-role-sync)                   | Detailed documentation for Role Sync Action                    |
| [swa-github-discussion-cleanup](https://github.com/nuitsjp/swa-github-discussion-cleanup) | Detailed documentation for Discussion Cleanup Action           |

## License

MIT License - See the `LICENSE` file in each repository for details.
