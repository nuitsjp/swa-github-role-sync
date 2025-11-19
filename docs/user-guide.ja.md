# User Guide (Japanese)

## Purpose

このドキュメントはAzure Static Web
Apps(SWA)の運用担当者やGitHubリポジトリ管理者が`swa-github-role-sync`
Actionを利用してアクセス権を自動同期し、招待リンクを利用者へ安全に展開するための具体的な手順とベストプラクティスをまとめたものです。README.ja.mdでは全体像を説明していますが、本書は「実際にどう使えばよいか」にフォーカスしています。

## Audience

- SWAリソースに対するユーザー招待やロール管理を担当するGitHubリポジトリ管理者
- アプリケーションチームのプロダクトマネージャー、SRE、運用チーム
- GitHub Actionsを使ってSWAのアクセス制御を自動化したい開発者

## Supported Scenarios

1. **リポジトリ権限ベースのアクセス配布**:
   GitHubリポジトリの`admin`/`write`権限を持つメンバーがSWAにも自動招待されるため、Pull
   Requestレビュー体制とSWAアクセス権を常に一致させられます。
2. **スケジュール実行による定期同期**: 週次・日次でworkflowを走らせ、棚卸し作業無しに不要ユーザーを削除できます。
3. **複数SWAへの展開**: 同じActionを複数workflowで使い分けることで、検証/本番や複数リージョンのSWAを個別に同期できます。
4. **テンプレートによる通知**:
   Discussionのタイトル/本文テンプレートを変更し、組織ルールに沿った告知方法へ簡単に適応できます。

## Prerequisites

### GitHub

- 実行リポジトリでGitHub ActionsとDiscussionsが有効化されている。
- `discussions: write`, `contents: read`,
  `id-token: write`を含むpermissionsをworkflowで宣言している。
- 招待結果を投稿するDiscussionカテゴリが事前に作成済み。
- `github-token`として使用するGITHUB_TOKENまたはPATが対象`target-repo`にアクセスできる。

### Azure

- 対象のSWAがデプロイ済みでGitHubプロバイダーによる認証が有効。
- `azure/login@v2`を使ったOIDCフェデレーション設定(サービスプリンシパル、Client
  ID/Tenant ID/Subscription ID)が完了。
- workflowランナーで`az staticwebapp users ...`コマンドを実行するためのAzure
  CLIがインストール済み(ホステッドrunnerなら既定で利用可能)。
- SWA上で`role-prefix`に一致するカスタムロール（デフォルトは`github-admin`,
  `github-writer`など`github-`で始まるロール）が定義されているか、これから作成する計画がある。

## Inputs Reference

| Input                               | 説明                                                                                  | 推奨値                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `github-token`                      | コラボレーター取得とDiscussion作成に利用。                                            | `secrets.GITHUB_TOKEN`(デフォルト)またはリモートrepo対象のPAT |
| `target-repo`                       | 他リポジトリの権限を同期元にする場合に指定。                                          | 省略でカレントrepoを使用                                      |
| `swa-name` / `swa-resource-group`   | 対象SWAを特定。                                                                       | Azureポータルの正確な名称                                     |
| `swa-domain`                        | 招待リンクのドメイン。                                                                | カスタムドメイン運用時に必須、無ければ省略                    |
| `role-for-admin` / `role-for-write` | GitHub権限に応じて割り当てるSWAロール文字列。                                         | `github-admin`, `github-writer`                               |
| `role-prefix`                       | 差分対象とするSWAロールのプレフィックス。`role-for-*`で独自ロールを使う際に合わせる。 | `github-`                                                     |
| `discussion-category-name`          | 招待サマリを掲示するカテゴリ名。                                                      | `Announcements`など利用者に通知が届くカテゴリ                 |
| `discussion-title-template`         | Discussionタイトル。`{swaName}`/`{repo}`/`{date}`を差し込み。                         | `SWA access invites for {swaName} ({repo}) - {date}`          |
| `discussion-body-template`          | Discussion本文。`{summaryMarkdown}`を含めるとAction生成サマリが埋め込まれる。         | デフォルトテンプレートを推奨                                  |

## Step-by-Step Setup

1. **Discussionsカテゴリ作成**:
   `Settings → General → Discussions → Manage categories`でカテゴリを追加し、名前を控える。
2. **Secrets登録**: Azureフェデレーション資格情報(`AZURE_CLIENT_ID`,
   `AZURE_TENANT_ID`,
   `AZURE_SUBSCRIPTION_ID`)を`Actions secrets and variables`に登録。
3. **Workflow作成**: READMEのQuick
   Startサンプルをベースに`.github/workflows/sync-swa-roles.yml`などを配置し、上記inputsを埋める。
4. **テスト実行**:
   `workflow_dispatch`で手動実行してログを確認。初回は`core.summary`/Discussionの両方に結果が出るのでユーザーにリンクを共有する。
5. **スケジュール化**: 問題なければ`schedule`トリガーを有効化し、週次や平日日次など組織ポリシーに合わせてcronを設定。

## Recommended Workflow Patterns

- **ローリング招待**: 新規メンバーが多い場合は`workflow_dispatch`を常に残し、必要に応じて手動同期できるようにする。
- **複数SWA運用**:
  SWAごとに別workflowを準備し、`swa-*`入力とDiscussionカテゴリを分ける。共通`target-repo`であれば同じGitHub権限集合を使い回せる。
- **Dry
  Run**: 新しいテンプレートを導入する際は`discussion-body-template`に`{summaryMarkdown}`が含まれているか確認したうえで`workflow_dispatch`を使ってPreview。

## Discussion Template Tips

- タイトルに`{date}`を入れると実行日がISO形式(YYYY-MM-DD)で付与され、履歴を追跡しやすくなります。
- 本文テンプレート内でカスタムセクションを設けたい場合は、`{summaryMarkdown}`の上下に自由に案内文を追加してください。
- `{summaryMarkdown}`を削除した場合は`GITHUB_STEP_SUMMARY`の出力だけで状況を把握することになるため、Discussions閲覧者だけで完結したい場合は必ず残してください。

## Troubleshooting

| 事象                                         | 原因と対処                                                                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Discussion category "..." not found`        | 指定カテゴリ名が一致していないかDiscussions機能が無効。SettingsでDiscussionsを有効化して正しい名前を設定する。                                                                  |
| `Failed to retrieve invite URL`              | `swa-domain`に存在しないドメインを指定したか、`azure/login`ステップが失敗して`az`権限が無い。ログで`azure/login`成功を確認し、必要なら`az version`を追加してCLIの健全性を検証。 |
| `Plan -> add:0 update:0 remove:0`            | 差分が無い通常動作。GitHub側で権限を変更してから再実行する。                                                                                                                    |
| `403 Resource not accessible by integration` | `github-token`のpermissions不足。workflowの`permissions`ブロックを確認し、Discussions書き込みを許可する。また`target-repo`が異なる場合PATを使用する。                           |
| `Unauthorized`(Azure CLI)                    | OIDCフェデレーション設定が正しくない。サービスプリンシパルにStatic Web Appsのリソースアクセス権があるか再確認する。                                                             |

## FAQ

**Q1. オーガナイゼーションの外部コラボレーターは同期されますか?**  
`affiliation: all`でコラボレーター一覧を取得しているため、外部コラボレーターでも`write`以上なら同期対象になります。

**Q2. SWAの既存ユーザーを維持したい場合は?**  
`role-prefix`に一致しないロールは差分計算から除外されるため、手動追加したロールを残したい場合は別のプレフィックスを使うか、対象ロールのみ`role-prefix`に合わせるよう命名規則を調整してください。

**Q3. Discussionを作成せずに実行できますか?**  
いいえ。現状のActionは同期結果をDiscussionにも投稿することを前提にしています。もし不要な場合はテンプレートに`{summaryMarkdown}`を含めつつクローズドカテゴリへ投稿する運用を推奨します。

**Q4. 招待リンクの有効期限は変更できますか?**  
`inviteUser`内部で`--invitation-expiration-in-hours 24`を指定しています。ソースコードを変更して再パッケージすれば期限調整も可能ですが、一般的には24時間以内が安全です。

## Support & Next Steps

- 細かな挙動変更やテンプレート改善の要望はGitHub Issuesで受け付けています。
- ロールマッピングや差分アルゴリズムの仕組みに興味がある場合は`docs/architecture.ja.md`(今後公開)を参照してください。
- ローカル検証や開発プロセスを把握したい場合は`docs/dev-guide.ja.md`(今後公開)を参照予定です。
