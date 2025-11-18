# swa-github-role-sync

Azure Static Web Apps ロールを GitHub リポジトリ権限と同期する TypeScript Action。

## 1. このドキュメントの目的

このドキュメントは、次のような **実運用向け GitHub Action（TypeScript 製）** を作成・公開するための手順を整理したものです。

- 対象 GitHub リポジトリで **`write` 以上の権限（`admin` / `write` / `maintain`）** を持つユーザーを列挙し、  
- それらの GitHub ユーザーを **Azure Static Web Apps（SWA）のロール管理** に同期する
- 同期時に **SWA の招待リンクを発行**し、
- 招待リンク一覧をまとめた **GitHub Discussion を新規作成**してユーザーに通知する
- 同期の際、GitHub 側で `write/admin` を失ったユーザーからは **SWA ロールを必ず削除** する（＝双方向ではなく「GitHub → SWA」片方向の同期）

Action の実装は以下を前提とします。

- TypeScript 製の JavaScript Action（Node20 ランタイム）  
- GitHub 公式の `actions/typescript-action` テンプレートをベースにする  
  - コンパイル・テスト・lint・`check-dist`・CodeQL などが同梱されている  
- リポジトリは **1 リポジトリ = 1 アクション**（`swa-github-role-sync`）とする
- Azure への認証は `azure/login` + OIDC によって **workflow 側で行い**、Action 本体は Azure クレデンシャルの値を扱わない  

---

## 2. 全体アーキテクチャ

### 2.1 全体の流れ

1. GitHub Actions の Workflow で `azure/login` を実行し、OIDC 経由で Azure にログインする。  
2. Workflow 内で `swa-github-role-sync` アクションを呼び出す。
3. アクション内で次を行う：

   1. GitHub REST API を使って、対象リポジトリのコラボレーターとその権限（`permission`）を取得する。  
   2. `permission` が `admin` または `write`（内部的に `maintain` も `write` と同等に扱われる）ユーザーだけを抽出する。  
   3. Azure CLI (`az staticwebapp users list`) で、SWA に登録されている GitHub プロバイダーのユーザーとロールを取得する。  
   4. GitHub 側集合と SWA 側集合の差分を計算し、  
      - GitHub に存在・SWA に未登録 → **新規招待 + ロール付与**  
      - GitHub に存在・SWA にも存在 → **ロール更新**  
      - GitHub に存在しない・SWA に存在 → **ロール削除（＝同期の本質）**
   5. `az staticwebapp users invite` で新規ユーザーの招待リンクを生成する。  
   6. 生成された招待リンク／更新結果を Markdown にまとめ、GitHub GraphQL API の `createDiscussion` ミューテーションで **新規 Discussion** を作成し、本文に貼り付ける。  
   7. 同じサマリ（件数・主な対象など）を `GITHUB_STEP_SUMMARY` にも出力する。

### 2.2 同期の定義

この Action における「同期」は、次のように定義します。

- **ソース・オブ・トゥルース**：  
  対象 GitHub リポジトリの `write` 以上のユーザー集合
- **ターゲット**：  
  SWA のユーザー（GitHub プロバイダー）＋ロール
- 同期結果：
  - GitHub `admin` → SWA ロール `github-admin`
  - GitHub `write` / `maintain` → SWA ロール `github-writer`
  - GitHub 側で `write/admin` を失ったユーザー → SWA から該当ロールを削除

---

## 3. 前提条件

### 3.1 GitHub 側の前提

- 対象リポジトリは **GitHub Actions** が利用可能であること
- **Discussions が有効化**されていること（Settings → General → Discussions）  
- この Action 専用のリポジトリとして `swa-github-role-sync` を新規作成する
- Workflow からは、基本的に `GITHUB_TOKEN` を用い、`permissions` で適切な権限を付与する

```yaml
  permissions:
    contents: read
    discussions: write   # Discussions 作成に必要  
    id-token: write      # azure/login の OIDC 用  
````

必要に応じて、`repo` スコープを付与した PAT を `secrets.GH_REPO_TOKEN` として渡してもよいですが、
基本方針としては `GITHUB_TOKEN` を使う想定とします。

### 3.2 Azure 側の前提

* 対象の Azure Static Web Apps（Standard プラン推奨）がデプロイ済みであること
* 対象の SWA で **GitHub プロバイダーを用いた認証**が有効になっていること
* GitHub Actions から Azure に接続するための OIDC 設定が完了していること

  * `azure/login` を OIDC で使う公式ガイドに従う

---

## 4. リポジトリ構成（`swa-github-role-sync`）

### 4.1 テンプレートから作成

1. GitHub 公式の `actions/typescript-action` テンプレートを開く
2. 「Use this template」→「Create a new repository」で `swa-github-role-sync` という名前で作成
3. Public / Private は運用方針次第（Marketplace 公開を前提にするなら Public が自然）

`actions/typescript-action` テンプレートには、以下が含まれています。

* TypeScript ビルド設定 (`tsconfig`)
* テスト（Jest）
* Lint（ESLint）
* `check-dist` 用 workflow
* CodeQL 分析
* リリース・バージョニングのガイド

### 4.2 主なファイル

* `action.yml`
* `src/main.ts`（エントリポイント）
* `dist/index.js`（ビルド成果物：`ncc` 等でバンドルされた JS）
* `.github/workflows/ci.yml`（lint / test / build / check-dist）
* `.github/workflows/codeql-analysis.yml` など

---

## 5. `action.yml` の設計

### 5.1 Inputs / Outputs の定義例

```yaml
name: 'Sync SWA roles with GitHub repo permissions'
description: >
  Sync Azure Static Web Apps roles with users who have write/admin access
  to a GitHub repository, and post invite links to a new Discussion.
author: 'Your Name or Organization'

runs:
  using: 'node20'
  main: 'dist/index.js'

inputs:
  github-token:
    description: 'GitHub token (usually GITHUB_TOKEN) with permissions to read collaborators and create discussions.'
    required: true

  target-repo:
    description: 'Target repository in owner/repo format. Defaults to the current repository.'
    required: false

  swa-name:
    description: 'Name of the target Azure Static Web App.'
    required: true

  swa-resource-group:
    description: 'Resource group name of the Static Web App.'
    required: true

  swa-domain:
    description: 'Domain of the Static Web App (e.g. your-app.azurestaticapps.net). Used for invite links.'
    required: true

  role-for-admin:
    description: 'SWA role name assigned to GitHub admin users.'
    required: false
    default: 'github-admin'

  role-for-write:
    description: 'SWA role name assigned to GitHub write/maintain users.'
    required: false
    default: 'github-writer'

  discussion-category-name:
    description: 'Discussion category name where invite summary Discussion will be created.'
    required: true

  discussion-title-template:
    description: 'Template for discussion title. Placeholders: {swaName}, {repo}, {date}.'
    required: false
    default: 'SWA access invites for {swaName} ({repo}) - {date}'

  discussion-body-template:
    description: |
      Template for discussion body.
      Placeholders: {swaName}, {repo}, {summaryMarkdown}.
    required: false
    default: |
      This discussion contains SWA access invite links for **{swaName}** from **{repo}**.

      {summaryMarkdown}

outputs:
  added-count:
    description: 'Number of users newly invited on SWA.'
  updated-count:
    description: 'Number of users whose SWA roles were updated.'
  removed-count:
    description: 'Number of users removed from SWA roles.'
  discussion-url:
    description: 'URL of the created Discussion containing invite links.'
```

---

## 6. TypeScript 実装の概要（`src/main.ts`）

ここでは構造と役割だけ整理します（実コードは別ファイルに切り出す想定）。

### 6.1 依存パッケージ

`package.json` 例（抜粋）：

* `@actions/core` / `@actions/github`（入力・出力・ログ・REST API 呼び出し）
* `@octokit/rest` or `@octokit/core`（GitHub REST API）
* `@octokit/graphql`（GitHub GraphQL API：Discussions 用）
* `typescript`, `ts-node`, `jest`, `eslint` etc.（テンプレートに含まれる）

### 6.2 GitHub コラボレーターの取得とフィルタ

1. `github-token` で Octokit インスタンスを生成
2. `target-repo` の指定がなければ、`github.context.repo` を使用
3. `GET /repos/{owner}/{repo}/collaborators` を使い、全コラボレーターを取得
4. 各ユーザーの権限を `permission` から判定（`admin` / `maintain` / `write` / `triage` / `read` など）
5. `admin` → 「管理者」、`write` / `maintain` → 「writer」として扱う

### 6.3 SWA ユーザー一覧の取得（Azure CLI 利用）

`az staticwebapp users list` を CLI から呼び出すことで、招待を受け入れたユーザーとロールを取得できます。

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type SwaUser = {
  userId: string;
  userDetails: string; // GitHub ユーザー名
  roles: string;
  provider: string;
};

async function listSwaUsers(name: string, resourceGroup: string): Promise<SwaUser[]> {
  const { stdout } = await execFileAsync('az', [
    'staticwebapp', 'users', 'list',
    '--name', name,
    '--resource-group', resourceGroup,
    '--output', 'json',
  ]);
  const users = JSON.parse(stdout) as SwaUser[];
  // GitHub プロバイダーだけに絞り込む
  return users.filter(u => u.provider === 'GitHub');
}
```

### 6.4 差分計算と招待リンクの生成

* GitHub 側ユーザー集合 `G`（admin / write）
* SWA 側 GitHub ユーザー集合 `S`

として、

* 追加対象：`G - S`
* 更新対象：`G ∩ S`
* 削除対象：`S - G`（**必ず削除する**）

招待リンク生成は `az staticwebapp users invite` を CLI で呼び出します。

```ts
async function inviteUser(
  name: string,
  resourceGroup: string,
  domain: string,
  githubUser: string,
  roles: string,
  expirationHours = 24
): Promise<string> {
  const { stdout } = await execFileAsync('az', [
    'staticwebapp', 'users', 'invite',
    '--name', name,
    '--resource-group', resourceGroup,
    '--authentication-provider', 'GitHub',
    '--user-details', githubUser,
    '--roles', roles,
    '--domain', domain,
    '--invitation-expiration-in-hours', String(expirationHours),
    '--output', 'json',
  ]);
  const result = JSON.parse(stdout);
  // CLI ドキュメント上、戻り値のプロパティ名は実際の仕様を確認して適宜合わせる  
  return result.inviteUrl ?? result.invitationUrl ?? result.url ?? '';
}
```

既存ユーザーのロール更新は、`az staticwebapp users update` を用います。

```ts
async function updateUserRoles(
  name: string,
  resourceGroup: string,
  githubUser: string,
  roles: string
): Promise<void> {
  await execFileAsync('az', [
    'staticwebapp', 'users', 'update',
    '--name', name,
    '--resource-group', resourceGroup,
    '--authentication-provider', 'GitHub',
    '--user-details', githubUser,
    '--roles', roles,
  ]);
}
```

削除については、「ロールを空にする」形か、必要に応じてユーザーの削除 API（`userId` 指定）を利用する実装とします。

### 6.5 GitHub Discussion の新規作成

GitHub Discussions の GraphQL API では、`createDiscussion` ミューテーションを使って新しい Discussion を作成できます。

1. `discussion-category-name` からカテゴリ ID を取得するクエリを投げる。
2. `createDiscussion` ミューテーションに、`repositoryId` / `categoryId` / `title` / `body` を渡して Discussion を作る。

### 6.6 GITHUB_STEP_SUMMARY への出力

* `added-count` / `updated-count` / `removed-count` と、
* 代表的なユーザー一覧（追加/削除のトップ数件）、
* 作成された Discussion の URL

などを Markdown でまとめ、`GITHUB_STEP_SUMMARY` に書き出します。これにより：

* オペレーターが Actions 実行結果画面で差分を一目で確認できる
* Discussion 作成に失敗した場合でも、同期結果が summary に残るので後追いができる

というメリットがあります。

---

## 7. Workflow 例（利用側リポジトリ）

利用側リポジトリでの最小例：

```yaml
name: Sync SWA roles from GitHub repo

on:
  workflow_dispatch:
  schedule:
    - cron: '0 9 * * 1'  # 毎週月曜 09:00 UTC（日本時間18:00相当）

permissions:
  id-token: write
  contents: read
  discussions: write

jobs:
  sync-swa-roles:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Azure login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Sync SWA roles
        uses: your-org/swa-github-role-sync@v1
        with:
          github-token: ${{ github.token }} # または secrets.GH_REPO_TOKEN
          target-repo: ${{ github.repository }}
          swa-name: your-swa-name
          swa-resource-group: your-swa-resource-group
          swa-domain: your-swa-name.azurestaticapps.net
          role-for-admin: github-admin
          role-for-write: github-writer
          discussion-category-name: 'Announcements'
          discussion-title-template: 'SWA access invites for {swaName} ({repo}) - {date}'
          discussion-body-template: |
            This discussion contains SWA access invite links for **{swaName}** from **{repo}**.

            {summaryMarkdown}
```

---

## 8. 必要なシークレットと権限

### 8.1 GitHub 側

* `GITHUB_TOKEN`（組み込み）

  * Workflow で `permissions.discussions: write` を与えることで、
    Discussions を GraphQL API 経由で作成・更新可能になる。

* Azure 関連 OIDC 設定

  * `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`
  * `azure/login` + OIDC の公式手順に従って設定する。

### 8.2 Azure 側ロール

* 対象の SWA に対して `az staticwebapp users invite/list/update` を実行できる権限が必要。
* 通常は、対象リソースグループに対する `Contributor` または Static Web Apps 用のカスタムロールなどで満たす。

---

## 9. CI/テスト/リリース運用（`swa-github-role-sync` リポジトリ）

Action のリポジトリ自体にも普通に Workflow を定義できるので、`actions/typescript-action` テンプレート同様、同じリポジトリに CI を置きます。

### 9.1 CI（Push/PR 時）

* トリガー：`push` / `pull_request`
* 内容：

  * `npm ci`
  * `npm run lint`
  * `npm test`
  * `npm run build`（`dist/index.js` を更新）
  * `check-dist`（テンプレート標準ワークフロー）

### 9.2 リリース・バージョニング

* タグ戦略：

  * `v1.2.3`（完全なバージョン）
  * `v1`（メジャー版ショートタグ）
* 新バージョンを出すたびに：

  1. `v1.2.3` をタグとして切る
  2. `v1` タグを同じコミットに付け替える
* Marketplace 公開：

  * Repo を Public にしたうえで、GitHub の Marketpace 公開フローに従う（カテゴリ・branding 等を設定）

---

## 10. 運用メモ／設計上の意図

* 本 Action は「**GitHub リポジトリの write/admin 権限**」を正として、SWA ユーザーとロールを完全同期する設計

  * 不要ユーザーのロール削除は「オプション」ではなく **同期の本質的な一部**
* 招待リンクはメールではなく、「GitHub Discussion（＋必要に応じて GITHUB_STEP_SUMMARY）」を窓口としてユーザーに提供する

  * メールアドレスを知らなくても、GitHub ユーザー名で招待できる SWA の仕様を利用している
* `GITHUB_STEP_SUMMARY` は：

  * オペレーター向けの結果サマリ
  * Discussion 作成失敗時のバックアップビュー
  * ログよりも読みやすい定型レポート
    として活用する
