# TODO: 次の課題リスト

1. 実環境でのE2E検証 ... done
2. 失敗時のハンドリング/ログ強化... done
3. テスト拡充... done
4. 入力バリデーション/テンプレート... done
5. CI/CD改善 ... done

- `.github/workflows/ci.yml` を Verify workflow として再構築し、format/lint/test/bundle/dist 差分チェック/npm audit を並列ジョブで実行。
- `npm run bundle` の実行結果で `dist/` に差分が出れば即検知し、必要に応じてアーティファクトをアップロード。
- CodeQL workflow は継続利用しつつ、依存関係スキャンとして `npm audit --omit=dev --audit-level=high` を必須化。

6. リリース準備

- バージョン付け（例: `v0.1.0` → `v1.0.0`）と`v1`タグ運用の整備。
- Marketplace公開を想定した`branding`調整とREADMEのスクリーンショット/使用例追記。
