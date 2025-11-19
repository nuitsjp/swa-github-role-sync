# TODO: 次の課題リスト

1. 実環境でのE2E検証 ... done
1. 失敗時のハンドリング/ログ強化
1. テスト拡充

- `src/main.ts`のE2Eに近いユニット/統合テストを追加（OctokitとAzure
  CLIをモック）。招待/更新/削除の各分岐とDiscussion作成成功/失敗の分岐をカバー。
- coverage閾値設定を検討（jestのcoverageThreshold）。

1. 入力バリデーション/テンプレート

- `discussion-category-name`が存在しない場合の明示的な事前チェックや、テンプレート置換キー欠如時のログ出力を検討。
- `{summaryMarkdown}`を埋め込まないテンプレート指定時の挙動（意図どおりか）を決める。

1. リリース準備

- バージョン付け（例: `v0.1.0` → `v1.0.0`）と`v1`タグ運用の整備。
- Marketplace公開を想定した`branding`調整とREADMEのスクリーンショット/使用例追記。

1. CI/CD改善

- 現在CIはformat/lint/testのみ。`check-dist`ワークフローで`dist`差分を検証済みだが、必要なら`npm run bundle`をCIジョブに追加。
- SAST/依存関係スキャン（CodeQL継続利用、npm auditの扱い）方針を決める。
