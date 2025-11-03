# swa-github-auth-study

Azure Static Web AppとGitHub Repositoryユーザーの同期サンプル

## 概要

このリポジトリは、Azure Static Web Appの組み込み認証において、GitHubリポジトリの編集権限（push権限）を持つユーザーのみにアクセスを許可するためのPowerShellスクリプトを提供します。

## 主な機能

- GitHubリポジトリのコラボレーター（push権限以上）を自動検出
- Azure Static Web Appの認証済みユーザーと同期
- 新規ユーザーの自動招待と権限を失ったユーザーの自動削除
- ドライランモードでの事前確認機能
- 詳細なログ出力とエラーハンドリング

## クイックスタート

### 前提条件

- Azure CLI（認証済み）
- GitHub CLI（認証済み）
- PowerShell 5.1以上

### 基本的な使い方

```powershell
.\sync-swa-users.ps1 -AppName "your-app-name" -ResourceGroup "your-resource-group" -GitHubRepo "owner/repo"
```

### ドライラン（変更を適用せずに確認）

```powershell
.\sync-swa-users.ps1 -AppName "your-app-name" -ResourceGroup "your-resource-group" -GitHubRepo "owner/repo" -DryRun
```

## ドキュメント

- **[USAGE.md](USAGE.md)** - 詳細な使用方法、インストール手順、トラブルシューティング
- **[TEST_EXAMPLES.md](TEST_EXAMPLES.md)** - テスト実行例と検証方法
- **[GITHUB_ACTIONS_SETUP.md](GITHUB_ACTIONS_SETUP.md)** - GitHub Actionsでの自動実行設定

## ファイル構成

- `sync-swa-users.ps1` - メインスクリプト（GitHubとAzureのユーザー同期）
- `USAGE.md` - 詳細な使用方法とドキュメント
- `TEST_EXAMPLES.md` - テスト実行例
- `GITHUB_ACTIONS_SETUP.md` - GitHub Actions設定ガイド
- `.github/workflows/` - Azure Static Web Apps CI/CD設定

## 主な特徴

- ✅ GitHubリポジトリのpush権限を持つユーザーを自動検出
- ✅ Azure Static Web Appと自動同期
- ✅ ドライランモードで安全に事前確認
- ✅ 詳細なログとエラーハンドリング
- ✅ API呼び出しの自動リトライ機能
- ✅ GitHub Actionsで定期実行可能

## 必要な権限

- **GitHub**: リポジトリの読み取り権限
- **Azure**: Static Web Appの共同作成者ロール以上

## ライセンス

MIT License
