# swa-github-role-sync

Azure Static Web Appsの簡易GitHub認証プロバイダー利用時に、リポジトリー権限に応じたロールをGitHub Actionsで同期するためサンプルリポジトリーです。

Azure Static Web AppsのGitHub認証プロバイダーは、GitHubのアカウントを利用して認証し、ユーザーにロールを割り当てることでアクセス制御を行うことができます。

しかし、デフォルトではリポジトリーの権限に基づくロールの同期は自動的に行われず、手動での設定が必要です。

このリポジトリーでは、GitHub Actionsを使用して、リポジトリーの権限に基づいてユーザーのロールを自動的に同期する方法を示しています。

## ワークフロー詳細 (sync-swa-users.yml)

### 基本情報
- **ワークフロー名**: Sync Azure Static Web App Users
- **トリガー**: 手動実行 (`workflow_dispatch`)
- **実行環境**: Ubuntu最新版
- **必要な権限**: `contents: read`, `discussions: write`

### 必要なシークレット
- **Azure関連**
  - `AZURE_CREDENTIALS`: Azure ログイン用の認証情報
  - `AZURE_STATIC_WEB_APP_NAME`: Static Web App名
  - `AZURE_RESOURCE_GROUP`: リソースグループ名
  - `AZURE_SUBSCRIPTION_ID`: サブスクリプションID（オプション）
- **Discussion関連**
  - `SWA_DISCUSSION_ENABLED`: Discussion投稿の有効化 (true/false)
  - `SWA_DISCUSSION_CATEGORY_ID`: Discussion投稿先のカテゴリーID
  - `SWA_DISCUSSION_TITLE`: Discussionタイトルのテンプレート（デフォルト: `Azure Static Web App への招待: {username}`）
  - `SWA_DISCUSSION_BODY_TEMPLATE`: Discussion本文のテンプレートファイルパスまたは内容
- **招待設定**
  - `SWA_INVITATION_EXPIRES_HOURS`: 招待リンクの有効期限（時間、デフォルト: 168）

### 処理フロー
1. **前提条件チェック**
   - `GITHUB_TOKEN` の存在確認
   - 必須シークレットの検証
   - Azure CLI, GitHub CLI, jq の利用可能性確認

2. **Azure認証**
   - Azure Login アクションで認証
   - サブスクリプションIDが指定されている場合は設定

3. **GitHubコラボレーター取得**
   - GitHub API経由で push/admin/maintain 権限を持つユーザーを取得
   - ページネーション対応

4. **Azureユーザー取得**
   - Azure Static Web App から `github_collaborator` ロールを持つユーザーを取得
   - ユーザーID、表示名、プロバイダー情報を保持

5. **差分計算**
   - 大文字小文字を無視したユーザー名比較
   - 追加対象: GitHubには存在するがAzureに未登録のユーザー
   - 削除対象: Azureには存在するがGitHubから削除されたユーザー

6. **招待処理**
   - 新規ユーザーをAzure Static Web Appへ招待
   - 招待URL生成（有効期限付き）
   - 成功・失敗件数を記録

7. **削除処理**
   - 削除対象ユーザーのロールを `anonymous` に変更
   - ユーザーIDまたはユーザー詳細で識別

8. **Discussion投稿**（オプション）
   - 有効化されている場合、招待URLをGitHub Discussionに投稿
   - プレースホルダー置換: `{username}`, `{invitation_url}`
   - GraphQL API使用

9. **結果サマリー**
   - 招待・削除の成功/失敗件数を出力
   - エラーがあれば終了コード1で終了
   - Discussion投稿失敗は警告として扱う

### 技術的特徴
- Bash, Python, jq を組み合わせた実装
- プレースホルダー置換機能（正規表現ベース）
- エラーハンドリングと詳細なログ出力
- 大文字小文字を区別しないユーザー名比較

