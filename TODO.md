# TODO

- **`src/main.ts` のリファクタリングによる可読性とメンテナンス性の向上:**
  - `run` 関数を、責務が単一の小さな関数群（例: `gatherInputsAndPrepare`, `executeSyncPlan`, `reportResults`）に分割する。これにより、メインのワークフローが理解しやすくなる。
  - `catch` ブロック内のコードの重複を減らし、一貫したエラー報告を保証するために、統一されたエラーハンドリング関数を作成する。

- **`src/github.ts` の `createDiscussion` 関数の簡素化:**
  - `categoryId` と `repositoryId` を取得するためのフォールバックロジックを削除する。
  - `categoryIds` パラメータを必須にする。これにより、関数のロジックが簡素化され、"fail fast"のためにIDを事前に取得する `main.ts` での使い方と一致する。
  - この変更を反映するために `__tests__/github.test.ts` のテストを更新する。

- **非標準エラー発生時のエラーメッセージの改善:**
  - `src/main.ts` の `catch` ブロックで、`Error` インスタンスではないオブジェクトが `throw` された際のハンドリングを改善する。単に "Unknown error" とするのではなく、`throw` された値の文字列表現（例: `String(error)`）を含めることで、デバッグのコンテキストを充実させる。

- **新機能の追加: 招待の有効期限を設定可能にする:**
  - `src/azure.ts` の `inviteUser` 関数では、有効期限が24時間にハードコードされている。
  - これを新しいGitHub Actionの入力（例: `invitation-expiration-hours`）として公開し、ユーザーが設定できるようにする。`src/main.ts` の `getInputs` を更新し、その値を渡すようにする。
  - **バリデーションの追加:** 指定された `invitation-expiration-hours` の値が、Azure Static Web Appsで許容される範囲 (1～168時間) 内であることを検証する。範囲外の場合はエラーとして処理する。

- **コードドキュメントの拡充:**
  - `src/` ディレクトリ全体の主要な関数、特に `src/main.ts` の複雑な `run` 関数や、`azure.ts`, `github.ts`, `plan.ts` の公開関数にJSDocコメントを追加する。開発者体験を向上させるために、目的、パラメータ、戻り値を説明する。

- **テストのモック戦略の見直し (低優先度):**
  - `__tests__/azure.test.ts` の `execFile` に対するモック実装が複雑である。機能的には問題ないが、より再利用可能な `child_process` のモックファクトリを作成するなど、簡素化できるか検討する。これはテストコードの品質を向上させるための低優先度タスクである。
