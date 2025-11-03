# GitHub Actionsでの定期実行設定例

## 概要

このファイルでは、GitHub Actionsを使用してユーザー同期スクリプトを定期実行する方法を説明します。

## ワークフローファイルの作成

`.github/workflows/sync-users.yml`を作成してください：

```yaml
name: Sync Azure SWA Users

on:
  # 毎日午前0時（UTC）に自動実行
  schedule:
    - cron: '0 0 * * *'
  
  # 手動実行も可能
  workflow_dispatch:

jobs:
  sync:
    runs-on: windows-latest
    
    steps:
      # リポジトリをチェックアウト
      - name: Checkout repository
        uses: actions/checkout@v3
      
      # Azure CLIでログイン
      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
      
      # GitHub CLIをセットアップ
      - name: Setup GitHub CLI
        run: |
          # GitHub CLIは既にインストール済み
          # トークンで認証
          echo "${{ secrets.GH_PAT }}" | gh auth login --with-token
      
      # ユーザー同期スクリプトを実行
      - name: Sync Users
        run: |
          .\sync-swa-users.ps1 `
            -AppName "${{ secrets.SWA_APP_NAME }}" `
            -ResourceGroup "${{ secrets.SWA_RESOURCE_GROUP }}" `
            -GitHubRepo "${{ github.repository }}"
        shell: pwsh
      
      # 失敗時の通知（オプション）
      - name: Notify on failure
        if: failure()
        run: |
          Write-Host "ユーザー同期に失敗しました" -ForegroundColor Red
          # ここに通知処理を追加（例: Slackへの通知など）
        shell: pwsh
```

## 必要なGitHub Secretsの設定

リポジトリの Settings > Secrets and variables > Actions で以下のシークレットを設定してください：

### 1. AZURE_CREDENTIALS

Azureサービスプリンシパルの認証情報（JSON形式）

```json
{
  "clientId": "<GUID>",
  "clientSecret": "<STRING>",
  "subscriptionId": "<GUID>",
  "tenantId": "<GUID>"
}
```

**作成方法:**

```bash
az ad sp create-for-rbac --name "github-actions-swa-sync" --role contributor \
  --scopes /subscriptions/{subscription-id}/resourceGroups/{resource-group}/providers/Microsoft.Web/staticSites/{static-site-name} \
  --sdk-auth
```

このコマンドの出力をそのままシークレットに設定してください。

### 2. GH_PAT

GitHub Personal Access Token

**必要なスコープ:**
- `repo` (フルアクセス)

**作成方法:**
1. GitHub の Settings > Developer settings > Personal access tokens > Tokens (classic)
2. "Generate new token (classic)" をクリック
3. `repo` スコープをチェック
4. トークンを生成してコピー
5. GitHub Secretsに設定

### 3. SWA_APP_NAME

Azure Static Web App名（例: `my-static-web-app`）

### 4. SWA_RESOURCE_GROUP

Azureリソースグループ名（例: `my-resource-group`）

## cronスケジュールの例

```yaml
# 毎日午前0時（UTC）
- cron: '0 0 * * *'

# 毎日午前9時（JST = UTC+9、つまりUTC 0時）
- cron: '0 0 * * *'

# 毎週月曜日の午前0時（UTC）
- cron: '0 0 * * 1'

# 毎月1日の午前0時（UTC）
- cron: '0 0 1 * *'

# 毎時0分
- cron: '0 * * * *'
```

## ドライランモードでのテスト

本番環境で実行する前に、ドライランモードでテストすることを推奨します：

```yaml
      - name: Sync Users (Dry Run)
        run: |
          .\sync-swa-users.ps1 `
            -AppName "${{ secrets.SWA_APP_NAME }}" `
            -ResourceGroup "${{ secrets.SWA_RESOURCE_GROUP }}" `
            -GitHubRepo "${{ github.repository }}" `
            -DryRun
        shell: pwsh
```

## 手動実行の方法

1. GitHubリポジトリのActionsタブに移動
2. "Sync Azure SWA Users"ワークフローを選択
3. "Run workflow"ボタンをクリック
4. ブランチを選択して"Run workflow"を実行

## ログの確認

1. GitHubリポジトリのActionsタブに移動
2. 実行されたワークフローをクリック
3. "Sync Users"ステップを展開してログを確認

## トラブルシューティング

### "Azure Login failed"

**原因:** AZURE_CREDENTIALSが正しく設定されていない

**解決方法:**
- シークレットが正しいJSON形式であることを確認
- サービスプリンシパルに適切な権限があることを確認

### "GitHub authentication failed"

**原因:** GH_PATが無効またはスコープが不足

**解決方法:**
- トークンが有効期限切れでないか確認
- `repo`スコープが付与されているか確認

### "Resource not found"

**原因:** SWA_APP_NAMEまたはSWA_RESOURCE_GROUPが間違っている

**解決方法:**
- Azure Portalで正しいリソース名を確認
- シークレットの値を更新

## セキュリティのベストプラクティス

1. **最小権限の原則**: サービスプリンシパルには必要最小限の権限のみを付与
2. **トークンのローテーション**: Personal Access Tokenは定期的に更新
3. **シークレットの管理**: シークレットをコードにハードコーディングしない
4. **監査ログの確認**: 定期的にワークフローの実行ログを確認

## 通知の追加（オプション）

### Slackへの通知

```yaml
      - name: Notify Slack
        if: always()
        uses: slackapi/slack-github-action@v1.24.0
        with:
          payload: |
            {
              "text": "Azure SWA User Sync: ${{ job.status }}",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "User sync completed with status: *${{ job.status }}*"
                  }
                }
              ]
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

### Emailでの通知

GitHub Actionsはデフォルトでワークフロー失敗時にメール通知を送信します。
Settings > Notifications で設定を確認してください。

## まとめ

GitHub Actionsを使用することで、ユーザー同期を完全に自動化できます。
定期実行により、GitHubリポジトリの権限変更が自動的にAzure Static Web Appに反映されます。

詳細は[USAGE.md](USAGE.md)を参照してください。
