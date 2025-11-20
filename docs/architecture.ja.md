# Architecture（Japanese）

## 全体像

`swa-github-role-sync`はGitHubリポジトリの権限をAzure Static Web Appsのカスタムロールへ同期し、招待リンクと結果サマリをGitHub DiscussionとJobサマリーに投稿するJavaScript Actionです。エントリーポイントは`src/main.ts`で、TypeScriptソースをRollupで`dist/`にバンドルしGitHub Actionsランナーで実行します。

## モジュール役割

- `src/main.ts`: 入力取得・差分計算・招待/更新/削除の実行・出力/サマリー書き出しまでのオーケストレーター。
- `src/github.ts`: Octokit/GraphQLを使って協働者一覧取得、DiscussionカテゴリID解決、Discussion作成を担当。
- `src/azure.ts`: `az staticwebapp ...`コマンド呼び出しをラップし、SWAユーザー取得と招待/ロール更新/削除を実行。
- `src/plan.ts`: GitHub側希望状態とSWA現状から招待・更新・削除の差分プランを生成（ロール接頭辞の正規化や大小文字差異を吸収）。
- `src/templates.ts`: Discussionテンプレート埋め込みと同期サマリーMarkdown生成を担当。
- `src/types.ts`: GitHubロールやSWAユーザー、差分プランの型定義。

## 呼び出しシーケンス（正常系）

```mermaid
sequenceDiagram
  participant Main as main.ts
  participant GitHub as github.ts
  participant Azure as azure.ts
  participant Plan as plan.ts
  participant Templates as templates.ts
  participant Actions as GitHub Actions

  Main->>Actions: getInputs()
  Main->>GitHub: parseTargetRepo()
  Main->>GitHub: getDiscussionCategoryId()
  alt swa-domain未指定
    Main->>Azure: getSwaDefaultHostname()
  else 指定あり
    Main-->>Main: 入力値を採用
  end
  Main->>GitHub: listEligibleCollaborators()
  Main->>Main: assertWithinSwaRoleLimit()
  Main->>Azure: listSwaUsers()
  Main->>Plan: computeSyncPlan()
  rect rgb(245,245,245)
    loop plan.toAdd
      Main->>Azure: inviteUser()
    end
    loop plan.toUpdate
      Main->>Azure: updateUserRoles()
    end
    loop plan.toRemove
      Main->>Azure: clearUserRoles()
    end
  end
  Main->>Templates: buildSummaryMarkdown()
  alt 差分あり
    Main->>Templates: fillTemplate() タイトル/本文
    Main->>GitHub: createDiscussion()
    Main->>Templates: buildSummaryMarkdown()（Discussion URL付き）
  else 差分なし
    Main-->>Main: Discussionは作成しない
  end
  Main->>Actions: setOutput()
  Main->>Actions: core.summary.addRaw()
```

エラー発生時は`catch`でサマリーを`status: failure`に差し替え、`core.setFailed`でジョブを失敗させます。Discussion作成前に失敗した場合でもJobサマリーには結果が残ります。

## データフローと外部API

- GitHub: REST APIでコラボレーターを取得し、GraphQLでDiscussionカテゴリIDとDiscussion作成を行う。`github-token`入力がすべての呼び出しに使用される。
- Azure: `execFile`で`az staticwebapp users list/invite/update`や`az staticwebapp show`を実行し、JSON/TSV出力を解析する。プロバイダーは`GitHub`に限定。
- 出力: `buildSummaryMarkdown`が招待URLや更新/削除リストをMarkdown化し、Discussion本文／`GITHUB_STEP_SUMMARY`の双方で再利用される。

## 差分ロジックと制約

- `role-prefix`に一致しないSWAロールは同期対象外とし、GitHub側で保持するロール文字列も小文字・ソート済みで比較する。
- SWAのカスタムロール割り当て上限（25名）超過を`assertWithinSwaRoleLimit`で早期検出し、API呼び出し前にエラーを返す。
- Discussion本文テンプレートに未知のプレースホルダーが含まれていてもテンプレート置換は続行し、警告ログのみを出力する。
