# Repository Guidelines

## Project Structure & Module Organization
- `sync-swa-users.ps1` holds the user sync workflow, covering CLI validation, collaborator retrieval, and Azure updates.
- `.github/workflows/azure-static-web-apps-calm-hill-0f33a0910.yml` runs scheduled and manual sync jobs.
- Keep process notes in `USAGE.md`, `TEST_EXAMPLES.md`, and `GITHUB_ACTIONS_SETUP.md`; extend the matching file when you add functionality.

## Build, Test, and Development Commands
- Authenticate once per session with `az login` and `gh auth login` to unblock all CLI calls.
- Run the sync end-to-end: `pwsh -File .\sync-swa-users.ps1 -AppName "your-app" -ResourceGroup "rg-name"` (GitHubリポジトリはgitのoriginから検出)。
- Double-check the active repository with `git remote get-url origin` before executing the scripts.
- Validate planned changes safely with `pwsh -File .\sync-swa-users.ps1 ... -DryRun`, which skips mutations but surfaces discrepancies.
- When adjusting automation, mirror the existing workflow structure and document triggers in `GITHUB_ACTIONS_SETUP.md`.

## Coding Style & Naming Conventions
- Use 4-space indentation, reserve splatting for readability, and stick to PowerShell verb-noun functions such as `Get-GitHubCollaborators`.
- Match the existing naming split: PascalCase parameters, camelCase locals, and consistent `$ErrorActionPreference`.
- Update the comment-based help block whenever parameters change, and route console output through `Write-Log` with the appropriate level.
- Favor native PowerShell constructs (`Try/Catch`, `Where-Object`) to keep the script portable and testable.

## Testing Guidelines
- Follow the walkthroughs in `TEST_EXAMPLES.md` when introducing new scenarios; add concise notes for each additional case.
- Always execute a `-DryRun` before real syncs, then re-run with live writes targeting a non-production Static Web App.
- Capture Azure and GitHub CLI error output when reporting bugs, since the script exits on failed prerequisites.

## Commit & Pull Request Guidelines
- Emulate existing history: imperative subject lines near 70 characters (e.g., `Add implementation checklist verifying all requirements are met`) followed by focused bodies when needed.
- Group related script and documentation updates in single commits; note breaking behavior changes explicitly.
- Pull requests should state the user sync scenario covered, link relevant issues, and attach dry-run logs or screenshots that prove the change.
- Before requesting review, confirm CI passes, update `IMPLEMENTATION_CHECKLIST.md` if relevant, and note any manual deployment steps.

## Security & Configuration Tips
- Never hard-code credentials; rely on `az login` sessions locally and GitHub secrets (`AZURE_CREDENTIALS`, `GH_PAT`, `SWA_*`) in automation.
- When sharing examples, redact user names and app identifiers, matching the placeholders already used in the docs.
- Rotate personal access tokens regularly and log new secret names in `GITHUB_ACTIONS_SETUP.md`.
