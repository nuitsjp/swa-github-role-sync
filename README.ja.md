# swa-github-role-sync

[![Coverage](https://raw.githubusercontent.com/nuitsjp/swa-github-role-sync/main/badges/coverage.svg)](https://github.com/nuitsjp/swa-github-role-sync)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[英語版はこちら](README.md)

Azure Static Web Apps（SWA）のユーザー/ロールを、対象GitHubリポジトリの`admin` /
`write`権限ユーザーと同期し、招待リンクをユーザーごとのDiscussionとして通知しつつ、集計結果をGitHub
ActionsのJobサマリーに掲載する再利用可能なJavaScript
Actionです。SWAへのアクセス管理を「GitHubリポジトリ権限のスナップショット」として扱い、Pull
Requestやブランチ保護の運用と整合させたいケースを想定しています。

> **お知らせ**
> CI / リリース / SWA同期などの運用ワークフローは [`nuitsjp/swa-github-role-sync-ops`](https://github.com/nuitsjp/swa-github-role-sync-ops) へ移管しました。本リポジトリはAction本体のみを管理します。

有効期限切れの招待Discussionを自動削除する専用Actionとして [`swa-github-discussion-cleanup`](https://github.com/nuitsjp/swa-github-discussion-cleanup)（別リポジトリーで提供）を用意しており、招待リンクのライフサイクル管理を完結させることができます。

## Overview

このActionは、GitHub REST/GraphQL APIとAzure
CLI（`az staticwebapp ...`）を組み合わせ、次のフローを1ステップのworkflowで提供します。

1. 対象リポジトリのコラボレーターのうち`admin` / `maintain` /
   `write`相当のユーザーを列挙する。
2. SWAに登録されているGitHubプロバイダーのユーザー・ロールを取得する。
3. GitHub側をソース・オブ・トゥルースとみなし、追加/更新/削除すべきユーザーの差分プランを生成する。
4. 必要なユーザーを`az staticwebapp users invite|update`で反映し、招待リンクをmarkdownサマリにまとめる。
5. 生成した招待リンクを利用者単位のDiscussionとして投稿し、同期結果の総数を`GITHUB_STEP_SUMMARY`にも追加する。

## Core Features

- GitHub `admin` → SWA任意ロール（デフォルト`github-admin`）、`write/maintain` →
  SWA任意ロール（デフォルト`github-writer`）のマッピング。
- 既存ロールとの差分判定で、重複招待や意図しないロール変更を抑制。
- Discussionタイトル・本文のテンプレート差し替えに対応し、@{login}や招待URL、日付/リポジトリ名を差し込んで認証完了後にDiscussionを閉じる指示を盛り込める。
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
        uses: nuitsjp/swa-github-discussion-cleanup@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          target-repo: my-org/my-repo
          discussion-category-name: Announcements
          expiration-hours: 168
```

## Inputs

| Name                          | Required | Default                                               | Description                                                                                                                                        |
| ----------------------------- | -------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github-token`                | true     | –                                                     | リポジトリのコラボレーターを取得しDiscussionを作成できるトークン。                                                                                 |
| `target-repo`                 | false    | 現在の`owner/repo`                                    | コラボレーターを取得する対象リポジトリ。異なるリポジトリの権限でSWAを管理する場合に指定。                                                          |
| `swa-name`                    | true     | –                                                     | 対象Static Web App名。                                                                                                                             |
| `swa-resource-group`          | true     | –                                                     | Static Web Appが属するリソースグループ名。                                                                                                         |
| `swa-domain`                  | false    | SWA既定ホスト名                                       | 招待リンクに含めるカスタムドメイン。省略時は`az staticwebapp show`で解決。                                                                         |
| `invitation-expiration-hours` | false    | `168`                                                 | 招待リンクの有効期限（1〜168時間）。                                                                                                               |
| `role-for-admin`              | false    | `github-admin`                                        | GitHub `admin`に付与するSWAロール名。                                                                                                              |
| `role-for-write`              | false    | `github-writer`                                       | GitHub `write`/`maintain`に付与するSWAロール名。                                                                                                   |
| `role-prefix`                 | false    | `github-`                                             | 差分対象とするSWAロールのプレフィックス。`role-for-*`で独自ロールを設定する際に指定。                                                              |
| `discussion-category-name`    | true     | –                                                     | 招待サマリを投稿するDiscussionカテゴリ名。                                                                                                         |
| `discussion-title-template`   | false    | `SWA access invite for @{login} ({swaName}) - {date}` | Discussionタイトルテンプレート。`{swaName}`, `{repo}`, `{date}`, `{login}`を差し込み可能。                                                         |
| `discussion-body-template`    | false    | See `action.yml`                                      | Discussion本文テンプレート。`{login}`, `{role}`, `{inviteUrl}`, `{invitationExpirationHours}`、必要に応じて`{summaryMarkdown}`などを差し込み可能。 |

### Cleanup Discussions Inputs

| Name                        | Required | Default                                              | Description                                                                      |
| --------------------------- | -------- | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| `github-token`              | true     | –                                                    | Discussionを削除するためのトークン。                                             |
| `target-repo`               | false    | 現在の`owner/repo`                                   | Discussionを削除する対象リポジトリ。                                             |
| `discussion-category-name`  | true     | –                                                    | 削除対象のDiscussionが含まれるカテゴリ名。                                       |
| `expiration-hours`          | false    | `168`                                                | 作成からこの時間を経過したDiscussionを削除対象とする。                           |
| `cleanup-mode`              | false    | `expiration`                                         | `expiration`（デフォルト）は期限切れのみ、`immediate`は即時削除する。            |
| `discussion-title-template` | false    | `SWA access invites for {swaName} ({repo}) - {date}` | 削除対象を特定するためのタイトルテンプレート（正規表現マッチングに使用される）。 |

## Outputs

| Name              | Description                                                      |
| ----------------- | ---------------------------------------------------------------- |
| `added-count`     | 新規に招待したユーザー数。                                       |
| `updated-count`   | 既存ユーザーでロールを更新した人数。                             |
| `removed-count`   | SWAからロールを削除した人数。                                    |
| `discussion-url`  | 最初に作成した招待DiscussionのURL（互換のため存続）。            |
| `discussion-urls` | すべての招待Discussion URL（改行区切り、招待が無ければ空文字）。 |

## Usage Notes

- 招待ごとにDiscussionが作成され、集計件数は`GITHUB_STEP_SUMMARY`に表示されるため、利用者への案内と管理者向けサマリーを使い分けてください。
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

- ユーザー向け詳細ガイド: [docs/user-guide.ja.md](docs/user-guide.ja.md) ([English](docs/user-guide.md))
- 開発・テスト・リリース手順: [docs/dev-guide.ja.md](docs/dev-guide.ja.md) ([English](docs/dev-guide.md))
- アーキテクチャと設計メモ: [docs/architecture.ja.md](docs/architecture.ja.md) ([English](docs/architecture.md))

## License

MIT License。詳細は`LICENSE`を参照してください。
