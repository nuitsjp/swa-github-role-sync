# swa-github-role-sync

[![NPM CI](https://github.com/nuitsjp/swa-github-role-sync-ops/actions/workflows/npm-ci.yml/badge.svg)](https://github.com/nuitsjp/swa-github-role-sync-ops/actions/workflows/npm-ci.yml)
[![Deploy Site](https://github.com/nuitsjp/swa-github-role-sync-ops/actions/workflows/deploy-site.yml/badge.svg)](https://github.com/nuitsjp/swa-github-role-sync-ops/actions/workflows/deploy-site.yml)
[![Role Sync (Released)](https://github.com/nuitsjp/swa-github-role-sync-ops/actions/workflows/role-sync-released.yml/badge.svg)](https://github.com/nuitsjp/swa-github-role-sync-ops/actions/workflows/role-sync-released.yml)
[![swa-github-role-sync](https://img.shields.io/github/v/release/nuitsjp/swa-github-role-sync?label=role-sync)](https://github.com/nuitsjp/swa-github-role-sync/releases/latest)
[![swa-github-discussion-cleanup](https://img.shields.io/github/v/release/nuitsjp/swa-github-discussion-cleanup?label=discussion-cleanup)](https://github.com/nuitsjp/swa-github-discussion-cleanup/releases/latest)

[English](README.md)

GitHubリポジトリの権限に基づいてAzure Static Web Apps（SWA）へのアクセスを制御するための再利用可能なGitHub Actionsを提供します。

GitHubリポジトリ上のドキュメントをSWAでホストする際、「リポジトリへの読み取り権限を持つユーザーのみ閲覧可能」といったアクセス制御を実現できます。本Actionsは、GitHubリポジトリの権限（admin/maintain/write/triage/read）をSWAのカスタムロールへ自動同期し、対象ユーザーにはGitHub Discussionを通じて招待リンクを通知します。

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Azureリソースの作成](#azureリソースの作成)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)
- [License](#license)

## Overview

### 解決する課題

GitHubリポジトリに関連するドキュメントをSWAで公開する場合、以下の課題があります：

- SWAの認証・認可とGitHubリポジトリの権限は連携していない
- リポジトリの権限変更に応じて、SWAのロール割り当てを手動で更新する必要がある
- 招待リンクの有効期限管理が煩雑

### 提供するActions

本リポジトリは以下の2つの再利用可能なGitHub Actionsを提供します：

| Action                                                                                    | 説明                                                                                          |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [swa-github-role-sync](https://github.com/nuitsjp/swa-github-role-sync)                   | GitHubリポジトリの権限を持つユーザーをSWAカスタムロールへ同期し、招待リンクをDiscussionで通知 |
| [swa-github-discussion-cleanup](https://github.com/nuitsjp/swa-github-discussion-cleanup) | 有効期限切れの招待Discussionを自動削除                                                        |

## Features

### swa-github-role-sync

- GitHub権限とSWAロールの1:1マッピング（5段階）
  - `admin` → `github-admin`
  - `maintain` → `github-maintain`
  - `write` → `github-write`
  - `triage` → `github-triage`
  - `read` → `github-read`
- `minimum-permission`で同期対象の最小権限レベルを指定可能（デフォルト: `write`）
- 差分検出による重複招待の抑制
- ユーザーごとの招待Discussionを自動作成
- `GITHUB_STEP_SUMMARY`への同期結果サマリー出力

### swa-github-discussion-cleanup

- 作成日時ベースの期限切れDiscussion自動削除
- タイトルテンプレートによる削除対象のフィルタリング
- 手動実行時の即時削除モード

## Prerequisites

- **Windowsの場合はWSL (Windows Subsystem for Linux)を使用すること。** セットアップスクリプトはBashで記述されています。
- Azure CLI (`az`)とGitHub CLI (`gh`)がインストール済みで、ログイン済みであること。
- 対象リポジトリでDiscussionsを有効化し、招待通知を投稿するカテゴリーを用意しておく（例: `Announcements`）。
- GitHub Appを作成済み（`Administration: read`, `Discussions: read & write`、必要に応じて`Members: read`）。App IDとprivate keyを控えておく。
- 実行するワークフローが`contents: read` / `discussions: write` / `id-token: write`権限を持つよう`permissions`を設定できること。

## Getting Started

Azureリソース（Static Web App、マネージドID等）が既に存在する場合は、Secretsの設定から始めてください。新規にAzureリソースを作成する必要がある場合は、先に「[Azureリソースの作成](#azureリソースの作成)」セクションを参照してください。

### 1. Secretsの設定

#### 必要なSecrets一覧

以下のSecretsをリポジトリまたはOrganizationに登録してください：

| Secret                            | 説明                             |
| --------------------------------- | -------------------------------- |
| `AZURE_CLIENT_ID`                 | Azure OIDC認証用のクライアントID |
| `AZURE_TENANT_ID`                 | AzureテナントID                  |
| `AZURE_SUBSCRIPTION_ID`           | AzureサブスクリプションID        |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | SWAデプロイ用トークン            |
| `ROLE_SYNC_APP_ID`                | GitHub AppのID                   |
| `ROLE_SYNC_APP_PRIVATE_KEY`       | GitHub Appの秘密鍵               |

#### GitHub Appの作成メモ（UI操作）

1. GitHubの「Developer settings > GitHub Apps」から「New GitHub App」を作成。
2. **Repository permissions**で`Administration (Read-only)`と`Discussions (Read & write)`を付与。Organizationメンバー情報を使う場合は**Organization permissions**で`Members (Read-only)`を付与。
3. 対象Organization / リポジトリにAppをインストールし、App IDとPrivate key (`.pem`)を取得してSecretsに登録。

#### GitHub App用のSecrets登録

GitHub App用のSecretsは手動で登録してください:

```bash
gh secret set ROLE_SYNC_APP_ID --body "123456"
gh secret set ROLE_SYNC_APP_PRIVATE_KEY < role-sync-app.private-key.pem
```

Organization Secretにする場合は`--org <ORG>`を付け、必要なら公開範囲を`--repos`で絞ってください。

### 2. SWAのルート設定

SWA側でロールベースのアクセス制御を有効にするには、`staticwebapp.config.json`に`routes`を設定します。

#### 基本例: 特定ロール以上のユーザーのみアクセス許可

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

#### ロール別のリソースアクセス制限

管理者専用エリアと一般ユーザー向けエリアを分ける例：

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

この例では:

- `/admin/*`: `github-admin`ロールのみアクセス可能
- `/internal/*`: `github-admin`, `github-maintain`, `github-write`ロールがアクセス可能
- `/*`: すべての同期対象ロールがアクセス可能

`allowedRoles`には、`minimum-permission`と`role-for-*`の設定に応じて許可するロールを指定してください。詳細は[Azure Static Web Appsのルート設定ドキュメント](https://learn.microsoft.com/ja-jp/azure/static-web-apps/configuration)を参照してください。

### 3. ワークフローのセットアップ

#### ロール同期ワークフローを追加

`.github/workflows/role-sync.yml`を作成します。`swa-name`・`swa-resource-group`・`discussion-category-name`を環境に合わせて変更してください。

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

#### 招待Discussionの掃除ワークフローを追加（任意）

`cleanup-mode`を`immediate`にすると手動実行時に即時削除されます。定期実行時は`expiration`を維持するのが安全です。

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

### 4. ワークフローの実行

```bash
# ロール同期を手動実行
gh workflow run role-sync.yml --ref main

# 実行結果を確認
gh run watch --exit-status

# 招待Discussion掃除を手動実行
gh workflow run cleanup-invite-discussions.yml --ref main
```

### 5. 結果を確認

- `GITHUB_STEP_SUMMARY`に招待件数・更新件数が表示されます。GitHub Web UIか`gh run view --log`で確認できます。
- 招待Discussionが指定カテゴリーに作成され、本文に招待URLが含まれます。
- 掃除ワークフローは削除した件数を出力します。

## Azureリソースの作成

Azureリソースが未作成の場合、以下の手順でリソースグループ、Static Web App、マネージドIDを作成し、GitHub ActionsからOIDCでログインできるよう設定します。

### セットアップスクリプトによる一括作成

以下のコマンドで、必要なリソースをすべて一括で作成できます。

```bash
curl -fsSL https://raw.githubusercontent.com/nuitsjp/swa-github-role-sync-ops/main/scripts/setup-azure-resources.sh | bash -s -- <owner> <repository>
```

**例:**

```bash
curl -fsSL https://raw.githubusercontent.com/nuitsjp/swa-github-role-sync-ops/main/scripts/setup-azure-resources.sh | bash -s -- nuitsjp swa-github-role-sync-ops
```

**実行結果:**

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

スクリプトは以下を自動で実行します:

1. リソースグループの作成 (`rg-<repository>-prod`)
2. Static Web Appの作成 (`stapp-<repository>-prod`, Standard SKU)
3. マネージドIDの作成 (`id-<repository>-prod`)
4. OIDCフェデレーション資格情報の作成
5. Contributorロールの割り当て
6. GitHub Secretsの登録 (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`)

### リソース命名規則

Azure Cloud Adoption Frameworkの[リソース省略形ガイダンス](https://learn.microsoft.com/ja-jp/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations)に基づき、以下の命名規則を使用します。

| リソース種別     | プレフィクス | 命名例                                |
| ---------------- | ------------ | ------------------------------------- |
| リソースグループ | `rg`         | `rg-swa-github-role-sync-ops-prod`    |
| Static Web App   | `stapp`      | `stapp-swa-github-role-sync-ops-prod` |
| マネージドID     | `id`         | `id-swa-github-role-sync-ops-prod`    |

## Configuration

### 同期対象の権限レベルを変更する

`minimum-permission`で同期対象とする最小権限レベルを指定できます：

| `minimum-permission` | 同期対象                             |
| -------------------- | ------------------------------------ |
| `read`               | read, triage, write, maintain, admin |
| `triage`             | triage, write, maintain, admin       |
| `write`              | write, maintain, admin（デフォルト） |
| `maintain`           | maintain, admin                      |
| `admin`              | adminのみ                            |

```yaml
- uses: nuitsjp/swa-github-role-sync@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    swa-name: my-swa-app
    swa-resource-group: my-swa-rg
    discussion-category-name: Announcements
    minimum-permission: read # read以上の全ユーザーを同期
```

### ロール名をカスタマイズする

各GitHub権限に対応するSWAロール名を個別に設定できます：

| パラメーター        | デフォルト        | 説明                    |
| ------------------- | ----------------- | ----------------------- |
| `role-for-admin`    | `github-admin`    | admin権限のSWAロール    |
| `role-for-maintain` | `github-maintain` | maintain権限のSWAロール |
| `role-for-write`    | `github-write`    | write権限のSWAロール    |
| `role-for-triage`   | `github-triage`   | triage権限のSWAロール   |
| `role-for-read`     | `github-read`     | read権限のSWAロール     |

### その他の設定

- **別リポジトリの権限で同期する**
  `target-repo`に`owner/repo`を指定し、`github-token`に対象リポジトリへアクセスできるPATを渡します。
- **テンプレートを変更する**
  テンプレートは`{login}` `{role}` `{inviteUrl}` `{swaName}` `{repo}` `{date}`などのプレースホルダーを利用可能。Discussion掃除側も同じテンプレートを設定してください。
- **招待リンクの有効期限**
  `invitation-expiration-hours`（既定168時間）を変更すると、掃除ワークフローの`expiration-hours`も合わせる必要があります。
- **カスタムドメインを使う**
  `swa-domain`に`https://example.com`のようなドメインを指定すると招待URLがそのドメインで生成されます。

## Troubleshooting

- `Discussion category "..." not found`：カテゴリー名の誤り、またはDiscussionsが無効です。設定を確認してください。
- `Resource not accessible by integration`：`github-token`の権限不足です。`permissions`ブロックとトークンスコープを確認してください。
- 招待が0件で終了する：既に同期済みの場合は何も変更せず終了します。`role-prefix`が異なると差分対象外になる点に注意してください。

## Documentation

| ドキュメント                                                                              | 内容                                          |
| ----------------------------------------------------------------------------------------- | --------------------------------------------- |
| [docs/developer-guide.ja.md](docs/developer-guide.ja.md)                                  | 開発環境構築、テスト、リリース手順            |
| [swa-github-role-sync](https://github.com/nuitsjp/swa-github-role-sync)                   | Role Sync Actionの詳細なドキュメント          |
| [swa-github-discussion-cleanup](https://github.com/nuitsjp/swa-github-discussion-cleanup) | Discussion Cleanup Actionの詳細なドキュメント |

## License

MIT License - 詳細は各リポジトリの`LICENSE`ファイルを参照してください。
