# swa-github-role-sync

[![CI](https://github.com/nuitsjp/swa-github-role-sync/actions/workflows/npm-ci.yml/badge.svg)](https://github.com/nuitsjp/swa-github-role-sync/actions/workflows/npm-ci.yml)
[![Sync SWA roles](https://github.com/nuitsjp/swa-github-role-sync/actions/workflows/sync-swa-roles.yml/badge.svg)](https://github.com/nuitsjp/swa-github-role-sync/actions/workflows/sync-swa-roles.yml)
[![Deploy site](https://github.com/nuitsjp/swa-github-role-sync/actions/workflows/deploy-site.yml/badge.svg)](https://github.com/nuitsjp/swa-github-role-sync/actions/workflows/deploy-site.yml)
[![Release](https://github.com/nuitsjp/swa-github-role-sync/actions/workflows/release.yml/badge.svg)](https://github.com/nuitsjp/swa-github-role-sync/actions/workflows/release.yml)
[![npm version](https://img.shields.io/github/package-json/v/nuitsjp/swa-github-role-sync?label=npm%20version)](package.json)
[![Coverage](https://raw.githubusercontent.com/nuitsjp/swa-github-role-sync/main/badges/coverage.svg)](coverage/index.html)
[![Dependabot](https://img.shields.io/badge/Dependabot-enabled-025E8C?logo=dependabot)](https://github.com/nuitsjp/swa-github-role-sync/network/updates)

Azure Static Web Apps（SWA）のユーザー/ロールを、対象GitHubリポジトリの`admin` /
`write`権限ユーザーと同期し、招待リンクをまとめたDiscussionを自動作成する再利用可能なJavaScript
Actionです。SWAへのアクセス管理を「GitHubリポジトリ権限のスナップショット」として扱い、Pull
Requestやブランチ保護の運用と整合させたいケースを想定しています。

また、有効期限切れの招待Discussionを自動削除する `cleanup-discussions` Actionも同梱しており、招待リンクのライフサイクル管理を完結させることができます。

## Overview

このActionは、GitHub REST/GraphQL APIとAzure
CLI（`az staticwebapp ...`）を組み合わせ、次のフローを1ステップのworkflowで提供します。

1. 対象リポジトリのコラボレーターのうち`admin` / `maintain` /
   `write`相当のユーザーを列挙する。
2. SWAに登録されているGitHubプロバイダーのユーザー・ロールを取得する。
3. GitHub側をソース・オブ・トゥルースとみなし、追加/更新/削除すべきユーザーの差分プランを生成する。
4. 必要なユーザーを`az staticwebapp users invite|update`で反映し、招待リンクをmarkdownサマリにまとめる。
5. Discussionを新規作成し、生成した招待リンクと同期結果を投稿、同じサマリを`GITHUB_STEP_SUMMARY`にも追加する。

## Core Features

- GitHub `admin` → SWA任意ロール（デフォルト`github-admin`）、`write/maintain` →
  SWA任意ロール（デフォルト`github-writer`）のマッピング。
- 既存ロールとの差分判定で、重複招待や意図しないロール変更を抑制。
- Discussionタイトル・本文のテンプレート差し替えに対応し、日付やリポジトリ名を差し込み可能。
- 成功/失敗にかかわらず`core.summary`へ結果を書き出し、workflow実行ログから状況を即座に把握。
- `target-repo`で別リポジトリを指定でき、オーガナイゼーション共通のメンバーシップ反映にも利用可能。
- `cleanup-discussions` Actionにより、有効期限（デフォルト24時間）を過ぎた招待Discussionを自動的にクリーンアップ。

## Prerequisites

### GitHub requirements

- 対象リポジトリでGitHub Actions / Discussionsが有効化されていること。
- workflowに`discussions: write`, `contents: read`,
  `id-token: write`の各権限を必須で付与すること。
- `github-token`には`GITHUB_TOKEN`か、必要に応じて`repo`, `discussions`,
  `read:org`などを含むPATを使用する。

### Azure requirements

- 対象のSWA（推奨:
  Standardプラン）がデプロイ済みでGitHub認証を使用していること。
- `azure/login`などでOIDC認証済みで`az`
  CLIが`staticwebapp`コマンドを実行できること。
- `swa-name`,
  `swa-resource-group`はAzureポータルやCLIで確認した正確な値を指定する。`swa-domain`を省略すると`az staticwebapp show`から既定ホスト名を解決する。

## Quick Start

1. 対象SWAリソースでGitHubプロバイダーを有効にし、ユーザー招待をCLIから実行できることを確認します。
2. GitHubリポジトリのSettings →
   GeneralでDiscussionsをONにして、招待サマリを投稿するカテゴリ（例:
   `Announcements`）を用意します。
3. 下記workflowを追加し、Azure側のフェデレーション資格情報（Client ID, Tenant
   ID, Subscription ID）をリポジトリまたはOrganization secretに登録します。

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
        uses: your-org/swa-github-role-sync@v1
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
        uses: nuitsjp/swa-github-role-sync/cleanup-discussions@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          target-repo: my-org/my-repo
          discussion-category-name: Announcements
          expiration-hours: 24
```

## Inputs

| Name                          | Required | Default                                              | Description                                                                               |
| ----------------------------- | -------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `github-token`                | true     | –                                                    | リポジトリのコラボレーターを取得しDiscussionを作成できるトークン。                        |
| `target-repo`                 | false    | 現在の`owner/repo`                                   | コラボレーターを取得する対象リポジトリ。異なるリポジトリの権限でSWAを管理する場合に指定。 |
| `swa-name`                    | true     | –                                                    | 対象Static Web App名。                                                                    |
| `swa-resource-group`          | true     | –                                                    | Static Web Appが属するリソースグループ名。                                                |
| `swa-domain`                  | false    | SWA既定ホスト名                                      | 招待リンクに含めるカスタムドメイン。省略時は`az staticwebapp show`で解決。                |
| `invitation-expiration-hours` | false    | `168`                                                | 招待リンクの有効期限（1〜168時間）。                                                      |
| `role-for-admin`              | false    | `github-admin`                                       | GitHub `admin`に付与するSWAロール名。                                                     |
| `role-for-write`              | false    | `github-writer`                                      | GitHub `write`/`maintain`に付与するSWAロール名。                                          |
| `role-prefix`                 | false    | `github-`                                            | 差分対象とするSWAロールのプレフィックス。`role-for-*`で独自ロールを設定する際に指定。     |
| `discussion-category-name`    | true     | –                                                    | 招待サマリを投稿するDiscussionカテゴリ名。                                                |
| `discussion-title-template`   | false    | `SWA access invites for {swaName} ({repo}) - {date}` | Discussionタイトルテンプレート。`{swaName}`, `{repo}`, `{date}`を差し込み可能。           |
| `discussion-body-template`    | false    | See `action.yml`                                     | Discussion本文テンプレート。`{summaryMarkdown}`を含めると同期サマリを挿入。               |

### Cleanup Discussions Inputs

| Name                       | Required | Default                                              | Description                                                                     |
| -------------------------- | -------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `github-token`             | true     | –                                                    | Discussionを削除するためのトークン。                                            |
| `target-repo`              | false    | 現在の`owner/repo`                                   | Discussionを削除する対象リポジトリ。                                            |
| `discussion-category-name` | true     | –                                                    | 削除対象のDiscussionが含まれるカテゴリ名。                                      |
| `expiration-hours`         | false    | `168`                                                | 作成からこの時間を経過したDiscussionを削除対象とする。                          |
| `cleanup-mode`             | false    | `expiration`                                         | `expiration`（デフォルト）は期限切れのみ、`immediate`は即時削除する。           |
| `discussion-title-template`| false    | `SWA access invites for {swaName} ({repo}) - {date}` | 削除対象を特定するためのタイトルテンプレート（正規表現マッチングに使用される）。|
## Outputs

| Name             | Description                           |
| ---------------- | ------------------------------------- |
| `added-count`    | 新規に招待したユーザー数。            |
| `updated-count`  | 既存ユーザーでロールを更新した人数。  |
| `removed-count`  | SWAからロールを削除した人数。         |
| `discussion-url` | 招待サマリを投稿したDiscussionのURL。 |

## Usage Notes

- Discussion本文テンプレートに`{summaryMarkdown}`が含まれない場合は警告が出力され、`GITHUB_STEP_SUMMARY`でのみ結果を確認できます。
- `target-repo`を他リポジトリに向ける際は`github-token`に対象リポジトリへアクセス可能なPATをセットしてください。
- 差分ロジックは`role-prefix`で指定したプレフィックスに一致するロールのみを同期対象としています。`role-for-*`で独自ロールを指定する場合は同じプレフィックスを使ってください。
- SWAの仕様によりカスタムロールを割り当て可能なユーザーは25名に制限されています。同期対象が25名を超えた場合、本Actionはエラーで中断します。
- 招待リンクの有効期限はデフォルトで24時間です。`invitation-expiration-hours`で1〜168時間の範囲に変更できます。

## Local Testing

```bash
npm install
npm run lint
npm test
npm run local-action
```

`npm run local-action`は`.env`の入力値を使ってローカル実行できるため、Azure/GitHubへの本番反映前にテンプレートやロール設定を確認できます。CIと同じ検証をしたい場合は`npm run verify`を使い、`dist/`の差分が最新になるよう`npm run package`を忘れないでください。

## Troubleshooting

- `Discussion category "..." not found`で失敗する場合: GitHub
  Discussionsのカテゴリ名が一致しているか、workflow実行repositoryにDiscussionが有効化されているかを確認してください。
- `Failed to retrieve invite URL`の場合:
  `swa-domain`に存在しないドメインを指定している、もしくはAzure
  CLIの認可が切れている可能性があります。`azure/login`のステップが成功しているか、`az version`でCLIが動作しているか調べてください。
- 何も差分がない場合ActionはDiscussionを作成しません。`buildSummaryMarkdown`に`status: success`が表示され、すべて0であれば同期済みです。

## Additional Documentation

- ユーザー向け詳細ガイド: `docs/user-guide.ja.md`
- 開発・テスト・リリース手順: `docs/dev-guide.ja.md`
- アーキテクチャと設計メモ: `docs/architecture.ja.md`

README英語版と各種詳細ドキュメントは日本語版レビュー完了後に追加します。

## License

MIT License。詳細は`LICENSE`を参照してください。
