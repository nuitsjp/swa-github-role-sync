# Development Guide（Japanese）

[English version / 英語版](dev-guide.md)

## 目的と対象

このドキュメントは`swa-github-role-sync`を開発・メンテナンスする開発者向けに、ローカル開発、テスト、リリースの進め方をまとめたものです。GitHub Actions上での利用手順は`docs/user-guide.ja.md`を参照してください。

## 必要環境

- Node.js 20以上（CIと同一バージョンを推奨）
- `npm install`で依存関係をインストール済みであること
- Azure CLIとGitHub CLIはローカル検証やリリース操作を行う場合に利用します

## 開発フロー（TDD）

1. **RED**: 期待する振る舞いを`__tests__/`配下にテストとして追加し、失敗を確認します。
   - 同期アクション: `__tests__/main.test.ts`
   - クリーンアップアクション: `__tests__/cleanup.test.ts`
2. **GREEN**: `src/`の最小限の実装でテストを通します。
3. **REFACTOR**: 重複や命名を整え、テストとLintを再実行して安全性を担保します。

テストやLintはできるだけ小さな単位で回し、`npm test -- <pattern>`で対象を絞ると反復が楽になります。

## 日常で使うコマンド

| コマンド               | 用途                                                    |
| ---------------------- | ------------------------------------------------------- |
| `npm run format:write` | Prettierでソース・ドキュメント・workflow YAMLを整形     |
| `npm run lint`         | ESLint（TypeScript/Prettier設定）を実行                 |
| `npm test`             | Jest（ESMモード）でユニットテストを実施                 |
| `npm run verify`       | formatチェック+Lint+テスト+`dist`差分確認をまとめて実行 |
| `npm run package`      | Rollupで`dist/sync.js`と`dist/cleanup.js`を再生成       |
| `npm run bundle`       | フォーマット済みの状態で`dist/`を再生成                 |
| `npm run local-action` | `.env`の入力値を使ってローカルでActionを試行            |

`dist/`はリポジトリにコミットされるため、挙動変更を伴う修正では`npm run package`または`npm run bundle`を必ず実行してください。

## ローカル検証のポイント

- `.env`にAction入力（`github-token`やSWA設定）を記載し、`npm run local-action`で本番と同じエントリーポイント（`src/main.ts`）を動かせます。Azure/GitHubへの書き込みを伴うため、検証用リソースで行ってください。
  - クリーンアップアクションを試す場合は、`local-action`スクリプトを修正して`src/cleanup-entry.ts`を指すようにするか、直接`ts-node`等で実行する必要があります（現状`local-action`はメインアクション用です）。
  - `cleanup-mode`の動作確認は、`.env`に`INPUT_CLEANUP_MODE=immediate`などを追記して挙動が変わるか検証してください。
- 差分やロール判定ロジックは`__tests__/`のテーブル駆動テストを参考にケースを追加すると理解しやすくなります。
- CLIやGraphQL周りの関数はモック可能な形で切り出しているので、外部アクセスはテストで差し替えてください。

## リリース手順

1. `npm run verify`でformat/Lint/テスト/`dist`チェックが通ることを確認する。必要に応じて`npm run coverage`でバッジを更新する。
2. `npm run package`または`npm run bundle`で`dist/`を最新化し、変更があればコミットする。
3. mainブランチへマージした上で、次のいずれかでリリースを開始する。
   - 既存タグを手動で作成する場合: `git tag vX.Y.Z && git push origin vX.Y.Z`
   - GitHub UIから`Release` workflowを`workflow_dispatch`で起動し、`version`入力に`1.2.3`形式（`v`プレフィックス可）を渡す
4. `release.yml`がタグ生成や`v1`浮動タグの更新、GitHub Releaseの作成を自動実行する。プレリリース版は`1.2.3-beta.1`のようにハイフン付きで指定する。
5. 公開後にサンプルサイトなどが必要な場合は`deploy-site.yml`でデプロイ状況を確認する。

### メンテナンス時のチェックリスト

- Action入力/出力を変更した場合は`action.yml`と`src/types.ts`の定義を揃える。
- Discussionテンプレートや差分ロジックを触った際は関係テストを追加し、`coverage/`レポートでギャップがないか確認する。
- 依存パッケージ更新時は`npm run verify`に加えて`npm run local-action`でリグレッションを目視確認する。
