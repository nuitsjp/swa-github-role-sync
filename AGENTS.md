# Repository Guidelines

## Primary Directive

- Think in English, interact with the user in Japanese.
- Can execute GitHub CLI/Azure CLI. Will execute and verify them personally
  whenever possible.
- When modifying the implementation, strictly adhere to the t-wada style of
  Test-Driven Development (TDD). RED-GREEN-REFACTOR cycle must be followed
  without exception.

## Project Structure & Module Organization

- Source lives in `src/` (`main.ts` entrypoint; `azure.ts` for CLI calls,
  `github.ts` for API access, `templates.ts` for discussion text, `plan.ts` for
  diff logic).
- Tests are in `__tests__/` (Jest), and built output ships from `dist/` (checked
  in for the GitHub Action runner).
- Workflows, docs, and assets: `docs/` (design notes), `badges/` (coverage SVG),
  `coverage/` (HTML report), `site/` (sample SWA site).
- `action.yml` defines inputs/outputs; keep it in sync with `src` defaults when
  editing templates.

## Build, Test, and Development Commands

- Install: `npm install` (Node 20+ required).
- Lint: `npm run lint` (ESLint with TypeScript/Prettier rules).
- Test: `npm test` (Jest, Node ESM mode); CI uses `npm run ci-test`.
- Format check/fix: `npm run format:check` / `npm run format:write`;
  docs と workflow YAML も Prettier 管理なので編集後は `npm run format:write`
  で整形しないと Format & Lint ジョブが失敗します。
- Package: `npm run package` (Rollup bundle to `dist/`); full pipeline:
  `npm run all`.
- CI parity check: `npm run verify` (runs format check + lint + test + Rollup +
  `dist/` diff check, mirroring the Format/Lint + Lint/Check Transpiled
  workflows).
- Local action dry-run: `npm run local-action` with `.env` providing inputs.

## Coding Style & Naming Conventions

- TypeScript, ES modules, strict typing favored; prefer `async/await` over raw
  promises.
- Filenames are kebab/flat case (`azure.ts`, `github.ts`); exported
  classes/types PascalCase, functions/variables camelCase.
- Keep action inputs/outputs mirrored between `action.yml` and `src/types.ts`.
- Prettier handles formatting (2-space indent, single quotes per config); run
  before committing or rely on `npm run bundle`.
- 日本語ドキュメントでは和文と英単語の間にスペースを入れない（例:
  `SWA任意ロール`）。
- 日本語文書では括弧は全角（）、カタカナ語は長音を省略せず（例:「パラメーター」）、校正上ひらく語（例:「すでに」）は平仮名で記述する。

## Testing Guidelines

- Jest with `@jest/globals`; tests reside in `__tests__/*.{test,spec}.ts`.
- Prefer table-driven cases for templating and plan-diff logic; mock external
  APIs/CLI calls (GitHub/Azure) rather than hitting network.
- Aim to cover role sync edge cases: admin vs write mapping, removed users,
  discussion templating.
- Generate/update coverage badge via `npm run coverage` after meaningful test
  additions.

## Commit & Pull Request Guidelines

- Use concise, imperative titles; conventional prefixes (`feat:`, `fix:`,
  `chore:`) are welcome and common in history.
- Include summary of behavior change and affected inputs/outputs; mention
  discussion template or plan logic changes explicitly.
- Link related issues or workflows; add before/after notes or screenshots for
  discussion body/template changes.
- Run `npm run verify` before opening a PR (mirrors Lint + Check Transpiled);
  ensure `dist/` is refreshed when behavior changes.
