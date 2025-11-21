# User Guide

[日本語版 / Japanese version](user-guide.ja.md)

## Purpose

This document provides concrete procedures and best practices for Azure Static Web Apps (SWA) operators and GitHub repository administrators using the `swa-github-role-sync` Action to automatically synchronize access permissions and securely distribute invitation links to users. While the README provides an overview, this guide focuses on "how to actually use it."

## Audience

- GitHub repository administrators responsible for user invitations and role management for SWA resources
- Product managers, SREs, and operations teams of application teams
- Developers who want to automate SWA access control using GitHub Actions

## Supported Scenarios

1. **Repository permission-based access distribution**:
   Members with `admin`/`write` permissions on the GitHub repository are automatically invited to SWA, keeping Pull Request review structure and SWA access permissions always aligned.
2. **Scheduled periodic synchronization**: Run workflows weekly/daily to remove unnecessary users without manual auditing.
3. **Multi-SWA deployment**: Use the same Action across multiple workflows to individually synchronize staging/production or multi-region SWAs.
4. **Template-based notifications**:
   Modify Discussion title/body templates to easily adapt to organizational announcement methods.
5. **Invitation link cleanup**:
   Use the `cleanup-discussions` Action in conjunction to automatically delete expired invitation Discussions, reducing security risks and confusion.

## Prerequisites

### GitHub

- GitHub Actions and Discussions are enabled in the execution repository.
- Workflow declares permissions including `discussions: write`, `contents: read`, and `id-token: write`.
- Discussion category to post invitation results is created in advance.
- GITHUB_TOKEN or PAT used as `github-token` can access the target `target-repo`.

### Azure

- Target SWA is deployed and GitHub provider authentication is enabled.
- OIDC federation setup using `azure/login@v2` is complete (service principal, Client ID/Tenant ID/Subscription ID).
- Azure CLI is installed to execute `az staticwebapp users ...` commands on the workflow runner (available by default on hosted runners).
- Custom roles matching `role-prefix` (default: roles starting with `github-` like `github-admin`, `github-writer`) are defined in SWA or planned to be created.

## Inputs Reference

| Input                               | Description                                                                                       | Recommended Value                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `invitation-expiration-hours`       | Invitation link expiration time (1-168 hours).                                                    | `168`                                                                           |
| `github-token`                      | Used for collaborator retrieval and Discussion creation.                                          | `secrets.GITHUB_TOKEN` (default) or PAT for remote repo targets                 |
| `target-repo`                       | Specify when synchronizing from another repository's permissions.                                 | Omit to use current repo                                                        |
| `swa-name` / `swa-resource-group`   | Identify target SWA.                                                                              | Exact name from Azure Portal                                                    |
| `swa-domain`                        | Domain for invitation links.                                                                      | Required when using custom domain, omit otherwise                               |
| `role-for-admin` / `role-for-write` | SWA role strings assigned according to GitHub permissions.                                        | `github-admin`, `github-writer`                                                 |
| `role-prefix`                       | Prefix for SWA roles to be considered sync targets.                                               | `github-`                                                                       |
| `discussion-category-name`          | Category name to post invitation summaries.                                                       | Category where users receive notifications like `Announcements`                 |
| `discussion-title-template`         | Discussion title. Insert `{swaName}`/`{repo}`/`{date}`.                                           | `SWA access invite for @{login} ({swaName}) - {date}`                           |
| `discussion-body-template`          | Discussion body. Use `{login}`, `{role}`, `{inviteUrl}`, `{invitationExpirationHours}` to guide. | Default template recommended                                                    |

## Step-by-Step Setup

Below explains the process from Azure resource preparation to workflow publication in order. Skip steps already completed.

### 1. Prepare infrastructure with Azure CLI

#### 1.1 Login and subscription confirmation

```bash
az login
az account show --query "{id:id, tenantId:tenantId}" -o json
```

Example output:

```json
{
  "id": "3b8a5c2d-1234-5678-9abc-def012345678",
  "tenantId": "0f12ab34-5678-90ab-cdef-1234567890ab"
}
```

#### 1.2 Create resource group

```bash
az group create \
  --name rg-swa-github-role-sync-prod \
  --location japaneast
```

Example output:

```json
{
  "id": "/subscriptions/3b8a5c2d-1234-5678-9abc-def012345678/resourceGroups/rg-swa-github-role-sync-prod",
  "location": "japaneast",
  "managedBy": null,
  "name": "rg-swa-github-role-sync-prod",
  "properties": {
    "provisioningState": "Succeeded"
  },
  "tags": null,
  "type": "Microsoft.Resources/resourceGroups"
}
```

#### 1.3 Create/confirm service principal

To create new:

```bash
az ad sp create-for-rbac \
  --name "sp-swa-github-role-sync-prod" \
  --role "Contributor" \
  --scopes "/subscriptions/3b8a5c2d-1234-5678-9abc-def012345678/resourceGroups/rg-swa-github-role-sync-prod"
```

Example output (note `appId`, `tenant`, `password`):

```json
{
  "appId": "11111111-2222-3333-4444-555555555555",
  "displayName": "sp-swa-github-role-sync-prod",
  "password": "xyz1234.-generated-password",
  "tenant": "0f12ab34-5678-90ab-cdef-1234567890ab"
}
```

To use existing service principal, get `appId` and `tenant` with `az ad sp show --id <appId>`.

#### 1.4 Add OIDC federation credential

To use OIDC with `azure/login@v2`, bind the GitHub Actions principal to the `appId` from the previous section.

```bash
az ad app federated-credential create \
  --id "11111111-2222-3333-4444-555555555555" \
  --parameters '{
    "name": "swa-role-sync-main",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:nuitsjp/swa-github-role-sync:ref:refs/heads/main",
    "description": "OIDC for swa-github-role-sync workflow",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

Example output:

```json
{
  "audiences": ["api://AzureADTokenExchange"],
  "issuer": "https://token.actions.githubusercontent.com",
  "name": "swa-role-sync-main",
  "subject": "repo:nuitsjp/swa-github-role-sync:ref:refs/heads/main"
}
```

To allow different branches or environments, adjust `subject` to `repo:<owner>/<repo>:ref:refs/heads/<branch>` or `repo:<owner>/<repo>:environment:<env-name>`.

### 2. Register Secrets

Open `Settings → Secrets and variables → Actions` on GitHub and register values obtained in Step 1.

- `AZURE_CLIENT_ID` → Service principal `appId`
- `AZURE_TENANT_ID` → `tenant`
- `AZURE_SUBSCRIPTION_ID` → `id` from `az account show`

If using `GITHUB_TOKEN` for `github-token`, no additional registration needed. When specifying another repository with `target-repo`, register an accessible PAT as `GH_REPO_TOKEN` etc. and set it in `github-token`.

#### 2.1 Example: Register Secrets with GitHub CLI

To set from CLI, use `gh secret set`.

```bash
gh secret set AZURE_CLIENT_ID \
  --repo nuitsjp/swa-github-role-sync \
  --body "11111111-2222-3333-4444-555555555555"

gh secret set AZURE_TENANT_ID \
  --repo nuitsjp/swa-github-role-sync \
  --body "0f12ab34-5678-90ab-cdef-1234567890ab"

gh secret set AZURE_SUBSCRIPTION_ID \
  --repo nuitsjp/swa-github-role-sync \
  --body "3b8a5c2d-1234-5678-9abc-def012345678"
```

To share organization-wide, specify `--org <org> --app actions`. Confirm GitHub CLI login with `gh auth login` beforehand.

### 3. Prepare Discussions category

Create a category to post sync results in `Settings → General → Discussions → Manage categories` and note the name to specify in `discussion-category-name`. Choose public/restricted category according to notification purpose.

### 4. Create Workflow

To flexibly change Discussion title/body templates for each SWA, we recommend managing them as repository variables and referencing them from workflow via `vars`.

#### 4.1 Register template variables with GitHub CLI

The following example registers templates that insert `@{login}`, invitation link, and expiration while prompting "close Discussion after sign-in" workflow.

```bash
gh variable set DISCUSSION_TITLE_TEMPLATE \
  --body 'SWA role invitation for @{login} ({swaName}) {date}'

gh variable set DISCUSSION_BODY_TEMPLATE --body $'@{login},\n\n- Role: {role}\n- Invitation link: {inviteUrl}\n- Valid for: {invitationExpirationHours} hours\n\nPlease sign in using the link above. Close this Discussion after confirming access. If expired, request reissue via comment.'
```

Using `$'...'` syntax handles multiline strings. To update existing templates, simply re-run the same command without changing workflow files.

#### 4.2 Workflow definition

Create `.github/workflows/sync-swa-roles.yml` and combine Secrets and `vars` as Action inputs.

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
          discussion-title-template: ${{ vars.DISCUSSION_TITLE_TEMPLATE }}
          discussion-body-template: ${{ vars.DISCUSSION_BODY_TEMPLATE }}
```

Referencing `vars` allows template changes via UI or GitHub CLI, enabling team-customized announcement text with reduced review burden. For multiple SWA synchronization, duplicate workflows and switch `{swa-*}` inputs and template variable names in `with`.

### 5. Test Execution

Manually execute via `workflow_dispatch` and verify that `core.summary` and Discussion content meet expectations. Since the first run generates invitation links for all target users, coordinate announcement timing with the team before execution.

### 6. Schedule

Once confirmed, add `schedule` trigger and set cron expression according to organizational audit cycle (weekly/weekday daily, etc.). For immediate reflection, combine with `push` or `pull_request` events.

### 7. Add Cleanup Workflow (Recommended)

Leaving expired invitation link Discussions can cause user confusion. We recommend using the `cleanup-discussions` Action for periodic deletion.

Create `.github/workflows/cleanup-discussions.yml`:

```yaml
name: Cleanup expired discussions

on:
  schedule:
    - cron: '0 0 * * *' # Daily execution
  workflow_dispatch:

jobs:
  cleanup:
    runs-on: ubuntu-latest
    permissions:
      discussions: write
    steps:
      - name: Cleanup expired discussions
        uses: nuitsjp/swa-github-role-sync/cleanup-discussions@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          discussion-category-name: Announcements
          expiration-hours: 24 # Match sync Action expiration setting
          cleanup-mode: ${{ github.event_name == 'workflow_dispatch' && 'immediate' || 'expiration' }}
```

Specifying `cleanup-mode` allows different behavior: immediate deletion on manual execution (`workflow_dispatch`) and expired-only deletion on scheduled execution.

If changing `discussion-title-template`, specify the same template to this Action to correctly identify deletion targets.

## Recommended Workflow Patterns

- **Rolling invitation**: When many new members, always keep `workflow_dispatch` to enable manual sync as needed.
- **Multi-SWA operation**:
  Prepare separate workflows per SWA, dividing `swa-*` inputs and Discussion categories. Same `target-repo` can reuse the same GitHub permission set.
- **Dry Run**: When introducing new templates, trial run with `workflow_dispatch` and verify both invitation Discussion and Job summary meet expectations.

## Discussion Template Tips

- Including `@{login}` and `{date}` in title makes recipient and execution date immediately visible, organizing multiple invitations easier.
- In body, combine `{role}`, `{inviteUrl}`, `{invitationExpirationHours}` with workflow rules like "close Discussion after sign-in" and "comment if expired."
- Since aggregate values are visible in `GITHUB_STEP_SUMMARY`, keep only essential guidance in Discussion body and leave detailed administrator info to summary.

## Troubleshooting

| Issue                                         | Cause and Solution                                                                                                                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Discussion category "..." not found`         | Specified category name doesn't match or Discussions feature is disabled. Enable Discussions in Settings and set correct name.                                                                                       |
| `Failed to retrieve invite URL`               | Non-existent domain specified in `swa-domain` or `azure/login` step failed with no `az` permission. Confirm `azure/login` success in logs and optionally add `az version` to verify CLI health.                     |
| `Plan -> add:0 update:0 remove:0`             | No diff detected (normal behavior). Change permissions on GitHub side and re-run.                                                                                                                                    |
| `403 Resource not accessible by integration`  | Insufficient `github-token` permissions. Check workflow `permissions` block to allow Discussion writes. If `target-repo` differs, use PAT.                                                                           |
| `Unauthorized` (Azure CLI)                    | Incorrect OIDC federation setup. Reconfirm service principal has Static Web Apps resource access.                                                                                                                    |

## FAQ

**Q1. Are external collaborators in organizations synchronized?**
Since we retrieve collaborator list with `affiliation: all`, external collaborators with `write` or higher are also sync targets.

**Q2. How to maintain existing SWA users?**
Roles not matching `role-prefix` are excluded from diff calculation, so to preserve manually added roles, use a different prefix or adjust naming convention to match only target roles with `role-prefix`.

**Q3. Can I execute without creating Discussions?**
No. The current Action assumes creating Discussions per new invitation to contact users. If you don't want public visibility, prepare a restricted category or execute in a closed repository combined with `cleanup-discussions`.

**Q4. Can invitation link expiration be changed?**
`invitation-expiration-hours` input allows 1-168 hours (default 168 hours). Even if long-term access is needed, we recommend short expiration with periodic issuance from a security perspective.

**Q5. Is there a limit on synchronizable users?**
Yes. Due to Azure Static Web Apps specifications, users assignable to custom roles are limited to 25 for both Free/Standard plans. This Action aborts with an error when sync targets exceed 25 users for safety.

## Support & Next Steps

- Feature change and template improvement requests are accepted via GitHub Issues.
- For role mapping and diff algorithm details, refer to `docs/architecture.md`.
- For local validation and development process understanding, see `docs/dev-guide.md`.
