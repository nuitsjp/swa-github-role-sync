# Development Guide

[日本語版 / Japanese version](dev-guide.ja.md)

## Purpose and Audience

This document summarizes local development, testing, and release procedures for developers who develop and maintain `swa-github-role-sync`. For usage on GitHub Actions, refer to `docs/user-guide.md`.

## Required Environment

- Node.js 20 or higher (same version as CI recommended)
- Dependencies installed via `npm install`
- Azure CLI and GitHub CLI are used for local validation and release operations

## Development Flow (TDD)

1. **RED**: Add expected behavior as tests in `__tests__/` and confirm failure.
   - Sync action: `__tests__/main.test.ts`
   - Cleanup action: `__tests__/cleanup.test.ts`
2. **GREEN**: Pass tests with minimal implementation in `src/`.
3. **REFACTOR**: Clean up duplication and naming, re-run tests and Lint to ensure safety.

Run tests and Lint in small units; use `npm test -- <pattern>` to narrow targets for faster iteration.

## Daily Commands

| Command                | Purpose                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| `npm run format:write` | Format source, documentation, and workflow YAML with Prettier       |
| `npm run lint`         | Run ESLint (TypeScript/Prettier config)                              |
| `npm test`             | Run unit tests with Jest (ESM mode)                                  |
| `npm run verify`       | Run format check + Lint + test + `dist` diff check comprehensively  |
| `npm run package`      | Regenerate `dist/sync.js` and `dist/cleanup.js` with Rollup         |
| `npm run bundle`       | Regenerate `dist/` in formatted state                                |
| `npm run local-action` | Try Action locally using `.env` input values                         |

Since `dist/` is committed to the repository, always run `npm run package` or `npm run bundle` for behavior-changing modifications.

## Local Validation Points

- Write Action inputs (`github-token`, SWA settings) in `.env` and run `npm run local-action` to execute the same entry point (`src/main.ts`) as production. Since this involves writes to Azure/GitHub, use validation resources.
  - To try cleanup action, modify `local-action` script to point to `src/cleanup-entry.ts` or execute directly with `ts-node` etc. (current `local-action` is for main action).
  - To verify `cleanup-mode` behavior, add `INPUT_CLEANUP_MODE=immediate` etc. to `.env` to test behavior changes.
- For diff and role determination logic, add cases referencing table-driven tests in `__tests__/` for easier understanding.
- CLI and GraphQL functions are extracted in mockable form, so replace external access in tests.

## Release Procedure

1. Confirm `npm run verify` passes format/Lint/test/`dist` check. Update badge with `npm run coverage` if needed.
2. Update `dist/` with `npm run package` or `npm run bundle`, commit if changed.
3. After merging to main branch, start release with one of the following:
   - To manually create existing tag: `git tag vX.Y.Z && git push origin vX.Y.Z`
   - Start `Release` workflow from GitHub UI via `workflow_dispatch`, passing `version` input in `1.2.3` format (with or without `v` prefix)
4. `release.yml` automatically executes tag generation, `v1` floating tag update, and GitHub Release creation. For pre-releases, specify with hyphen like `1.2.3-beta.1`.
5. If sample site is needed after publication, check deployment status with `deploy-site.yml`.

### Maintenance Checklist

- When changing Action inputs/outputs, align `action.yml` and `src/types.ts` definitions.
- When touching Discussion templates or diff logic, add related tests and check `coverage/` report for gaps.
- For dependency package updates, visually confirm regression with `npm run local-action` in addition to `npm run verify`.
