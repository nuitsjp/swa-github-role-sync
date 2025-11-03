# テスト実行例

このファイルは、`sync-swa-users.ps1`のテスト方法と実行例を示します。

## 前提条件の確認

スクリプトを実行する前に、以下を確認してください：

```powershell
# Azure CLIのバージョン確認
az --version

# GitHub CLIのバージョン確認
gh --version

# Azure認証状態の確認
az account show

# GitHub認証状態の確認
gh auth status
```

## テスト1: ドライランモード

実際の変更を適用せずに、スクリプトの動作を確認します。

```powershell
# パラメータを環境に合わせて変更してください
$AppName = "your-static-web-app-name"
$ResourceGroup = "your-resource-group"
$GitHubRepo = "owner/repo"

# ドライラン実行
.\sync-swa-users.ps1 -AppName $AppName -ResourceGroup $ResourceGroup -GitHubRepo $GitHubRepo -DryRun
```

**期待される結果:**
- スクリプトが正常に起動する
- GitHubコラボレーターが取得される
- Azureユーザーが取得される
- 差分が計算される
- 「ドライランモードのため、変更は適用されません」というメッセージが表示される

## テスト2: ヘルプの表示

スクリプトのヘルプを表示して、パラメータの説明を確認します。

```powershell
Get-Help .\sync-swa-users.ps1 -Full
```

## テスト3: パラメータの検証

必須パラメータが正しく機能することを確認します。

```powershell
# パラメータなしで実行（エラーになるはず）
.\sync-swa-users.ps1

# 不足しているパラメータがあれば指摘されます
```

## テスト4: 実際の同期（注意して実行）

⚠️ **警告**: このテストは実際にAzure Static Web Appのユーザー設定を変更します。

```powershell
# 必ずドライランで確認してから実行してください
.\sync-swa-users.ps1 -AppName $AppName -ResourceGroup $ResourceGroup -GitHubRepo $GitHubRepo
```

**期待される結果:**
- GitHubコラボレーターとAzureユーザーが同期される
- 新規ユーザーが招待される
- 不要なユーザーが削除（anonymousロールに変更）される
- 成功/失敗のサマリーが表示される

## テスト5: エラーハンドリング

意図的に間違ったパラメータを指定して、エラーハンドリングを確認します。

```powershell
# 存在しないリポジトリを指定
.\sync-swa-users.ps1 -AppName $AppName -ResourceGroup $ResourceGroup -GitHubRepo "nonexistent/repo" -DryRun

# 存在しないStatic Web Appを指定
.\sync-swa-users.ps1 -AppName "nonexistent-app" -ResourceGroup $ResourceGroup -GitHubRepo $GitHubRepo -DryRun
```

**期待される結果:**
- エラーメッセージが表示される
- スクリプトが適切に終了する（exit code 1）

## テスト6: 認証エラーのシミュレーション

```powershell
# Azureからログアウト
az logout

# スクリプトを実行（認証エラーになるはず）
.\sync-swa-users.ps1 -AppName $AppName -ResourceGroup $ResourceGroup -GitHubRepo $GitHubRepo -DryRun

# 再度ログイン
az login
```

## ログの確認

スクリプト実行時のログは、カラーコードで分類されます：

- **白色**: 一般情報（INFO）
- **緑色**: 成功メッセージ（SUCCESS）
- **黄色**: 警告メッセージ（WARNING）
- **赤色**: エラーメッセージ（ERROR）

## トラブルシューティング

### よくある問題

1. **「Azure CLI (az) がインストールされていません」**
   - Azure CLIをインストールしてください: https://docs.microsoft.com/cli/azure/install-azure-cli

2. **「GitHub CLI (gh) がインストールされていません」**
   - GitHub CLIをインストールしてください: https://cli.github.com/

3. **「Azureにログインしていません」**
   - `az login` を実行してください

4. **「GitHubにログインしていません」**
   - `gh auth login` を実行してください

5. **「GitHubコラボレーターの取得に失敗しました」**
   - GitHubリポジトリへのアクセス権限を確認してください
   - リポジトリ名が正しいか確認してください（形式: owner/repo）

6. **「Azureユーザーの取得に失敗しました」**
   - Azure Static Web Appのリソース名とリソースグループ名が正しいか確認してください
   - 適切な権限（共同作成者ロール以上）があるか確認してください

## 実行結果の例

### 成功時

```
[2025-11-03 16:00:08] [SUCCESS] 同期完了
[2025-11-03 16:00:08] [SUCCESS] 成功: 3 件
[2025-11-03 16:00:08] [INFO] 失敗: 0 件
```

終了コード: 0

### 部分的な失敗時

```
[2025-11-03 16:00:08] [SUCCESS] 同期完了
[2025-11-03 16:00:08] [SUCCESS] 成功: 2 件
[2025-11-03 16:00:08] [ERROR] 失敗: 1 件
```

終了コード: 1

### エラー時

```
[2025-11-03 16:00:08] [ERROR] 予期しないエラーが発生しました: <エラーメッセージ>
```

終了コード: 1

## 次のステップ

テストが成功したら：

1. 定期実行の設定を検討（Windowsタスクスケジューラ、GitHub Actionsなど）
2. ログ監視の仕組みを構築
3. チームメンバーへの使用方法の共有

詳細は[USAGE.md](USAGE.md)を参照してください。
