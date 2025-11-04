# GitHub Actions ワークフロー セットアップガイド

このドキュメントでは、Azure Static Web Appのユーザー同期を自動化するGitHub Actionsワークフローの設定方法を説明します。

## 概要

`sync-swa-users.yml` ワークフローは、PowerShellスクリプト `sync-swa-users.ps1` と同等の処理を実行し、GitHubリポジトリのコラボレーター（push権限以上）とAzure Static Web Appの認証済みユーザーを自動的に同期します。

## トリガー

このワークフローは以下の2つの方法で実行できます：

1. **手動トリガー** (`workflow_dispatch`)
   - GitHubリポジトリの「Actions」タブから手動で実行
   - 実行時にパラメータを指定可能

2. **スケジュール実行** (`schedule`)
   - 毎日UTC 00:00（日本時間 09:00）に自動実行
   - デフォルト値を使用

## 必要な権限

### GitHub
- リポジトリの読み取り権限
- GitHub APIアクセス用のPersonal Access Token（PAT）

### Azure
- Static Web Appの共同作成者ロール以上
- Service Principalの認証情報

## セットアップ手順

### 方法1: 自動セットアップ（推奨）

[setup-github-secrets.ps1](setup-github-secrets.ps1) スクリプトを使用して、必要なシークレットを自動的に作成・登録できます。

```powershell
.\setup-github-secrets.ps1 `
    -SubscriptionId "12345678-1234-1234-1234-123456789012" `
    -ResourceGroup "my-resource-group" `
   -StaticWebAppName "my-static-web-app"
```

GitHubリポジトリは、スクリプトを実行したGitリポジトリの`origin`リモートから自動的に判定されます。
ワークフローを運用する前に、開発環境とGitHub上の両方で `git remote get-url origin` を確認し、想定しているリポジトリを指していることをチェックしてください。
`origin`が未設定またはGitHub以外のリモートを指している場合、スクリプトは実行時に失敗します。

このスクリプトは以下を自動的に実行します：
1. Azure Service Principalの作成
2. 必要な権限の付与
3. GitHub Personal Access Tokenの取得（対話的）
4. 3つのシークレット（AZURE_CREDENTIALS、AZURE_STATIC_WEB_APP_NAME、AZURE_RESOURCE_GROUP）をGitHubリポジトリに登録

**注意**: ワークフローは自動的に `GITHUB_TOKEN` を使用するため、`GH_TOKEN` シークレットの設定は不要です。

**必要な前提条件：**
- Azure CLI (az) のインストールと認証 (`az login`)
- GitHub CLI (gh) のインストールと認証 (`gh auth login`)
- Azureサブスクリプションの所有者または管理者ロール
- GitHubリポジトリの管理者権限

**GitHub Personal Access Token の要件：**
- **Classic token の場合**：`repo` と `workflow` スコープが必須
- **Fine-grained token の場合**：Actions と Secrets の Read/Write 権限が必須

**オプション：**
- GitHub Tokenを事前に作成済みの場合は `-GitHubToken` パラメーターで指定可能

### 方法2: 手動セットアップ

リポジトリの Settings > Secrets and variables > Actions から以下のシークレットを追加します：

#### 必須シークレット

- **`AZURE_CREDENTIALS`**
  ```json
  {
    "clientId": "YOUR_CLIENT_ID",
    "clientSecret": "YOUR_CLIENT_SECRET",
    "subscriptionId": "YOUR_SUBSCRIPTION_ID",
    "tenantId": "YOUR_TENANT_ID"
  }
  ```

  取得方法：
  ```bash
  az ad sp create-for-rbac --name "GitHub-Actions-SWA-Sync" \
    --role contributor \
    --scopes /subscriptions/{subscription-id}/resourceGroups/{resource-group} \
    --sdk-auth
  ```

> **注意**: ワークフローは自動的に `GITHUB_TOKEN` を使用するため、`GH_TOKEN` シークレットは不要です。

- **`AZURE_STATIC_WEB_APP_NAME`**
  - Azure Static Web App名
  - ワークフロー実行時に使用される対象アプリ

- **`AZURE_RESOURCE_GROUP`**
  - Azureリソースグループ名
  - ワークフロー実行時に使用される対象リソースグループ

> **注意**: これらのシークレットは必須です。ワークフローは常にこれらの値を使用します。

### 2. Azure Service Principalの権限設定

Service Principalに適切な権限を付与します：

```bash
# リソースグループレベルでの権限付与
az role assignment create \
  --assignee YOUR_CLIENT_ID \
  --role "Website Contributor" \
  --scope /subscriptions/{subscription-id}/resourceGroups/{resource-group}
```

## 使用方法

### 手動実行

1. GitHubリポジトリの「Actions」タブを開く
2. 「Sync Azure Static Web App Users」ワークフローを選択
3. 「Run workflow」ボタンをクリック
4. オプション：
   - **ドライラン**: 変更を適用せずに確認する場合はチェック
5. 「Run workflow」をクリックして実行

**注意**: Azure Static Web App名、リソースグループ名、GitHubリポジトリはシークレットから自動取得されます。

### スケジュール実行

シークレットが正しく設定されていれば、毎日自動的に実行されます。実行履歴は「Actions」タブで確認できます。

## ワークフローの動作

1. **認証**
   - Azure CLIでAzureにログイン
   - GitHub CLIでGitHubに認証

2. **データ収集**
   - GitHubリポジトリからpush権限を持つコラボレーターを取得
   - Azure Static Web Appから現在の認証済みユーザーを取得

3. **差分計算**
   - 追加が必要なユーザー（GitHubにいてAzureにいない）
   - 削除が必要なユーザー（Azureにのみ存在）

4. **同期処理**（ドライランでない場合）
   - 新規ユーザーをAzure Static Web Appに招待
   - 不要なユーザーをanonymousロールに変更（削除）

5. **結果サマリー**
   - 実行結果を出力

## トラブルシューティング

### 認証エラー

**エラー**: Azure認証に失敗する
- `AZURE_CREDENTIALS`シークレットのJSON形式が正しいか確認
- Service Principalが有効であることを確認
- 権限スコープが正しく設定されているか確認

**エラー**: GitHub API認証に失敗する
- `GH_TOKEN`が有効であることを確認
- トークンに`repo`スコープが付与されているか確認

### API呼び出しエラー

ワークフローは各API呼び出しで最大3回リトライします。それでも失敗する場合：

- Azureサービスの状態を確認
- GitHubサービスの状態を確認
- レート制限に達していないか確認

### ユーザー同期エラー

**問題**: ユーザーの追加/削除が失敗する
- Static Web Appのドメイン名が取得できているか確認
- 対象ユーザー名が正しい形式か確認
- Service Principalの権限が十分か確認

## ログの確認

1. GitHubリポジトリの「Actions」タブを開く
2. 対象のワークフロー実行を選択
3. 各ステップをクリックして詳細ログを確認

各ステップで以下の情報が出力されます：
- 取得したユーザー数
- 追加/削除対象のユーザーリスト
- 処理の成功/失敗状況

## セキュリティに関する注意事項

- GitHub Secretsは暗号化されて保存されます
- ワークフローログにシークレット値は表示されません
- Personal Access Tokenは定期的に更新してください
- Service Principalの権限は最小限に設定してください

## カスタマイズ

### スケジュール実行の時刻変更

[.github/workflows/sync-swa-users.yml](.github/workflows/sync-swa-users.yml) の `cron` 式を変更：

```yaml
schedule:
  - cron: '0 0 * * *'  # UTC 00:00 = JST 09:00
```

例：
- `'0 12 * * *'` - UTC 12:00（JST 21:00）
- `'0 0 * * 1'` - 毎週月曜日 UTC 00:00
- `'0 */6 * * *'` - 6時間ごと

### 招待有効期限の変更

デフォルトは168時間（7日間）です。変更する場合は、[.github/workflows/sync-swa-users.yml](.github/workflows/sync-swa-users.yml#L145) の `--invitation-expiration-in-hours` 値を変更してください。

## 参考リンク

- [GitHub Actions ドキュメント](https://docs.github.com/actions)
- [Azure Static Web Apps CLI リファレンス](https://learn.microsoft.com/cli/azure/staticwebapp)
- [GitHub CLI ドキュメント](https://cli.github.com/manual/)
