# swa-github-auth-study

Azure Static Web App の組み込み認証を GitHub リポジトリのコラボレーターと同期する PowerShell サンプルです。`scripts/Sync-SwaUsers.ps1` が GitHub と Azure のユーザー差分を検出し、招待・削除・通知までを一括で実行します。

## 主な機能

- GitHub リポジトリの push 権限（maintain/admin 含む）を持つユーザーを自動取得
- Azure Static Web App の `github_collaborator` ロールを持つユーザーと差分比較
- 新規ユーザーの自動招待、権限を失ったユーザーの `anonymous` へのロールダウン
- ドライランでの安全な事前確認と詳細なログ出力
- 招待リンクを GitHub Discussions へ自動投稿（任意設定）
- `origin` リモートから対象リポジトリを自動判別

## 前提条件

### ツール

- PowerShell 5.1 以上（PowerShell 7 系推奨）
- Azure CLI 2.x 以上（`az login` 済みであること）
- GitHub CLI 2.x 以上（`gh auth login` 済みであること）

### アクセス権

- GitHub: 対象リポジトリの読み取り権限（コラボレーター一覧取得用）
- Azure: 対象 Static Web App への共同作成者ロール以上

## セットアップ

1. リポジトリを取得します。
   ```bash
   git clone https://github.com/nuitsjp/swa-github-auth-study.git
   cd swa-github-auth-study
   ```
2. 設定ファイルを作成します。
   ```bash
   cp config.json.template config.json
   ```
3. `config.json` を編集し、以下の項目を入力します。

   | セクション | キー | 説明 |
   |------------|------|------|
   | `azure` | `subscriptionId` | 対象サブスクリプション ID |
   | | `resourceGroup` | Static Web App が属するリソースグループ |
   | | `staticWebAppName` | Static Web App 名 |
   | `servicePrincipal` | `name` | `scripts/Initialize-GithubSecrets.ps1` が再利用する Service Principal 名 |
   | `sync` | `dryRun` | デフォルトの実行モード（初回は `true` 推奨） |
   | `discussion` | `enabled` | 招待リンクを Discussion に投稿する場合は `true` |
   | | `categoryId` | 投稿先カテゴリ ID。`gh api graphql` で取得します |
   | | `title` | 招待スレッドのタイトル。`{username}` が GitHub ID に置換されます |
   | | `bodyTemplate` | 招待文テンプレート（リポジトリルートからの相対パス） |

   > メモ: `invitationSettings.expiresInHours` は現行の同期スクリプトでは使用されず、招待期限は固定で 168 時間です。

4. Discussion テンプレートを利用する場合は、`bodyTemplate` に指定したファイル内で `{{USERNAME}}` と `{{INVITATION_URL}}` を使って差し込みができます。

## 実行方法

1. 実行前に `git remote get-url origin` を確認し、期待する GitHub リポジトリを指していることを確かめます。`origin` が未設定または GitHub 以外の場合、スクリプトはエラーで終了します。
2. まずは `config.json` の `sync.dryRun` を `true` に設定しドライランを実施します。
   ```powershell
   pwsh -File .\scripts\Sync-SwaUsers.ps1
   ```
   差分がない場合は即時終了し、差分がある場合は追加・削除候補をログ出力します（この段階では Azure 上の変更は行われません）。
3. 変更内容に問題がなければ `sync.dryRun` を `false` に戻し、同じコマンドを再実行します。スクリプトは以下を順に実行します。
   - GitHub コラボレーターの再取得
   - `github_collaborator` ロールを持つ Azure ユーザーとの突合
   - 追加対象ユーザーの招待（成功時は招待 URL を取得）
   - 不要になったユーザーのロールダウン
4. 実行が成功すると、成功件数・失敗件数が表示されます。失敗があった場合はプロセスが終了コード 1 で終了するため、CI からも検知できます。

## Discussion への投稿

- `discussion.enabled` が `true` の場合、招待 URL を取得できたユーザーごとに Discussion を新規作成します。
- カテゴリ ID は次のコマンドで確認できます（`owner` と `repo` を置換）。
  ```bash
  gh api graphql -f query='
  { repository(owner: "owner", name: "repo") {
      discussionCategories(first: 20) {
        nodes { id name }
      }
    }
  }'
  ```
- テンプレート本文では `{{USERNAME}}` と `{{INVITATION_URL}}` がそれぞれ GitHub ユーザー名と招待リンクに置換されます。

## GitHub Actions による自動化

`.github/workflows/azure-static-web-apps-calm-hill-0f33a0910.yml` で同じスクリプトを定期実行できます。セットアップ手順や必要なシークレットは `GITHUB_ACTIONS_SETUP.md` を参照してください。`scripts/Initialize-GithubSecrets.ps1` を使うとローカルから必要なシークレットをまとめて登録できます。

## トラブルシューティング

- `Azure CLI (az) がインストールされていません`: Azure CLI をインストールし `az login` を実行してください。
- `GitHub CLI (gh) がインストールされていません`: GitHub CLI をインストールし `gh auth login` で認証してください。
- `Azureにログインしていません / GitHubにログインしていません`: それぞれ `az login`、`gh auth login` を実行して再試行します。
- `origin リモートが GitHub リポジトリを指していません`: `git remote set-url origin` で正しいリポジトリを設定してください。
- Azure CLI 2.75 以降でユーザー一覧の `roles` が複数値を返すケースでも、スクリプト側で正しく解析するよう対応済みです。想定外のレスポンスが続く場合は `az staticwebapp users list` の出力を確認してください。

## 関連ドキュメント

- `TEST_EXAMPLES.md`: ドライラン・本番適用の検証シナリオ
- `GITHUB_ACTIONS_SETUP.md`: CI 実行時の前提条件とシークレット設定
- `WORKFLOW_SETUP.md`: ワークフロー全体のセットアップメモ

## ライセンス

MIT License
