# Release Guide

This document breaks down how to publish a new version of the reusable GitHub
Action so that the GitHub Marketplace listing and the `v1` floating tag stay in
sync.

## Versioning strategy

- Follow Semantic Versioning. Patch bumps are for bug fixes, minor bumps for
  backward-compatible features, major bumps for breaking changes.
- Release tags must be annotated: `git tag -a v1.2.3 -m "Release v1.2.3"`.
- Keep the moving `v1` tag up to date by force-updating it to the latest
  published `v1.x.y` tag after every release: `git tag -f v1 v1.2.3`.

## Pre-release checklist

1. `git switch main && git pull` to make sure the workspace reflects the latest
   merge.
2. Run `npm run verify` locally; fix lint/test failures.
3. Run `npm run package` to refresh `dist/` and commit the generated files.
4. Update README/docs when behavior changes (usage examples, workflow snippets,
   etc.).
5. Ensure主要PRのタイトル/本文で変更点・重要事項を明確にし、自動リリースノートへ反映させる。
6. Open a PR from `release/vX.Y.Z`, have it reviewed, and squash/merge.

## Release workflow

After the PR lands on `main`, run `.github/workflows/release.yml` with the new
version number.

```text
1. Trigger: workflow_dispatch with input `version` (example: 1.2.3).
2. Job steps:
   a. Checkout the merged commit.
   b. Verify that tag `v1.2.3` does not exist yet.
   c. Create annotated tag `v1.2.3` (workflow-dispatch only) and push it.
   d. Update the floating `v1` tag to point at the new tag and push with --force.
   e. Run `gh release create v1.2.3 --generate-notes` to publish the Release using
      GitHub's automatic release-note generator.
```

To avoid relying solely on a manual UI run, configure the workflow to also run
on `push` events for tags matching `v*`. In that mode, pushing a signed tag from
the CLI (`git push origin v1.2.3`) is enough to trigger the same automation;
`workflow_dispatch` acts as a recovery/redo option when a rerun is needed
without pushing a new tag.

### CLI trigger

```bash
gh workflow run release.yml -f version=1.2.3
```

The command above mirrors the UI run: it creates/pushes `v1.2.3`, refreshes
`v1`, and publishes the GitHub Release with automatically generated notes.

### Pre-release support

If the provided version contains a hyphen (for example `1.2.3-beta.1`), the
workflow:

- Marks the GitHub Release as a prerelease
  (`gh release create ... --prerelease`).
- Skips updating the floating `v1` tag so production consumers stay on the
  latest stable tag.

このモードは、実運用に影響を与えずにリリースワークフローを検証したい場合に利用できます。

## Release notes and GitHub Releases

- `gh release create v1.2.3 --generate-notes` leverages
  GitHubの自動リリースノート機能で、前回のタグからのPR/コミット差分をまとめます。
- Breaking
  change等を確実に伝えるには、PRタイトル/本文やコミットメッセージに明確な情報を記載し、必要ならRelease作成時に`--notes`で追記します。
- READMEやアナウンスから最新Releaseへリンクし、利用者が変更点を把握できるようにします。

## Manual fallback via UI

It is still possible to run the Release workflow from the GitHub Actions UI:

1. Go to _Actions → Release_.
2. Click _Run workflow_, enter the desired version (for example `1.2.3`).
3. Confirm that the workflow finishes successfully, then double-check that both
   `v1.2.3` and `v1` tags are pushed and the GitHub Release contains the
   expected notes.

When combined with the tag-based trigger, the UI serves as a convenient recovery
path without being the single source of truth.
