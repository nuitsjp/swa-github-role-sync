# User Guide（Japanese）

[English version / 英語版](user-guide.md)

## Purpose

このドキュメントはAzure Static Web
Apps（SWA）の運用担当者やGitHubリポジトリ管理者が`swa-github-role-sync`
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
5. **招待リンクのクリーンアップ**:
   `cleanup-discussions` Actionを併用することで、有効期限切れの招待Discussionを自動的に削除し、セキュリティリスクや混乱を低減できます。

## Prerequisites

### GitHub

- 実行リポジトリでGitHub ActionsとDiscussionsが有効化されている。
- `discussions: write`, `contents: read`,
  `id-token: write`を含むpermissionsをworkflowで宣言している。
- 招待結果を投稿するDiscussionカテゴリが事前に作成済み。
- `github-token`として使用するGITHUB_TOKENまたはPATが対象`target-repo`にアクセスできる。

### Azure

- 対象のSWAがデプロイ済みでGitHubプロバイダーによる認証が有効。
- `azure/login@v2`を使ったOIDCフェデレーション設定（サービスプリンシパル、Client
  ID/Tenant ID/Subscription ID）が完了。
- workflowランナーで`az staticwebapp users ...`コマンドを実行するためのAzure
  CLIがインストール済み（ホステッドrunnerなら既定で利用可能）。
- SWA上で`role-prefix`に一致するカスタムロール（デフォルトは`github-admin`,
  `github-writer`など`github-`で始まるロール）が定義されているか、これから作成する計画がある。

## Inputs Reference

| Input                               | 説明                                                                                                                | 推奨値                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `invitation-expiration-hours`       | 招待リンクの有効期限（1〜168時間）。                                                                                | `168`                                                           |
| `github-token`                      | コラボレーター取得とDiscussion作成に利用。                                                                          | `secrets.GITHUB_TOKEN`（デフォルト）またはリモートrepo対象のPAT |
| `target-repo`                       | 他リポジトリの権限を同期元にする場合に指定。                                                                        | 省略でカレントrepoを使用                                        |
| `swa-name` / `swa-resource-group`   | 対象SWAを特定。                                                                                                     | Azureポータルの正確な名称                                       |
| `swa-domain`                        | 招待リンクのドメイン。                                                                                              | カスタムドメイン運用時に必須、無ければ省略                      |
| `role-for-admin` / `role-for-write` | GitHub権限に応じて割り当てるSWAロール文字列。                                                                       | `github-admin`, `github-writer`                                 |
| `role-prefix`                       | 同期対象とするSWAロールのプレフィックス。                                                                           | `github-`                                                       |
| `discussion-category-name`          | 招待サマリを掲示するカテゴリ名。                                                                                    | `Announcements`など利用者に通知が届くカテゴリ                   |
| `discussion-title-template`         | Discussionタイトル。`{swaName}`/`{repo}`/`{date}`を差し込み。                                                       | `SWA access invites for {swaName} ({repo}) - {date}`            |
| `discussion-body-template`          | Discussion本文。`{login}`, `{role}`, `{inviteUrl}`, `{invitationExpirationHours}`などを使って招待手順を案内できる。 | デフォルトテンプレートを推奨                                    |

## Step-by-Step Setup

以下ではAzureリソース準備からworkflow公開までを順に説明します。すでに完了している工程はスキップして構いません。

### 1. Azure CLIで基盤を用意する

#### 1.1 ログインとサブスクリプション確認

```bash
az login
az account show --query "{id:id, tenantId:tenantId}" -o json
```

出力例:

```json
{
  "id": "3b8a5c2d-1234-5678-9abc-def012345678",
  "tenantId": "0f12ab34-5678-90ab-cdef-1234567890ab"
}
```

#### 1.2 リソースグループ作成

```bash
az group create \
  --name rg-swa-github-role-sync-prod \
  --location japaneast
```

出力例:

```json
{
  "id": "/subscriptions/3b8a5c2d-1234-5678-9abc-def012345678/resourceGroups/rg-swa-github-role-sync-prod",
  "location": "japaneast",
  "managedBy": null,
  "name": "rg-swa-github-role-sync-prod",
  "properties": {
    "provisioningState": "Succeeded"
  },
  "tags": null,
  "type": "Microsoft.Resources/resourceGroups"
}
```

#### 1.3 サービスプリンシパルの作成/確認

新規に作成する場合:

```bash
az ad sp create-for-rbac \
  --name "sp-swa-github-role-sync-prod" \
  --role "Contributor" \
  --scopes "/subscriptions/3b8a5c2d-1234-5678-9abc-def012345678/resourceGroups/rg-swa-github-role-sync-prod"
```

出力例（`appId`, `tenant`, `password`を控える）:

```json
{
  "appId": "11111111-2222-3333-4444-555555555555",
  "displayName": "sp-swa-github-role-sync-prod",
  "password": "xyz1234.-generated-password",
  "tenant": "0f12ab34-5678-90ab-cdef-1234567890ab"
}
```

既存のサービスプリンシパルを使う場合は`az ad sp show --id <appId>`で`appId`と`tenant`を取得します。

#### 1.4 OIDCフェデレーション資格情報を追加

`azure/login@v2`でOIDCを利用するため、前項の`appId`にGitHub
Actions主体を紐づけます。

```bash
az ad app federated-credential create \
  --id "11111111-2222-3333-4444-555555555555" \
  --parameters '{
    "name": "swa-role-sync-main",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:nuitsjp/swa-github-role-sync:ref:refs/heads/main",
    "description": "OIDC for swa-github-role-sync workflow",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

出力例:

```json
{
  "audiences": ["api://AzureADTokenExchange"],
  "issuer": "https://token.actions.githubusercontent.com",
  "name": "swa-role-sync-main",
  "subject": "repo:nuitsjp/swa-github-role-sync:ref:refs/heads/main"
}
```

別ブランチや環境を許可したい場合は`subject`を`repo:<owner>/<repo>:ref:refs/heads/<branch>`や`repo:<owner>/<repo>:environment:<env-name>`に調整します。

### 2. Secrets登録

GitHub側で`Settings → Secrets and variables → Actions`を開き、Step
1で得た値を登録します。

- `AZURE_CLIENT_ID` → サービスプリンシパルの`appId`
- `AZURE_TENANT_ID` → `tenant`
- `AZURE_SUBSCRIPTION_ID` → `az account show`で取得した`id`

`github-token`は`GITHUB_TOKEN`を使う場合は追加不要です。`target-repo`に他リポジトリを指定する際はアクセス可能なPATを`GH_REPO_TOKEN`などで登録し、`github-token`に設定してください。

#### 2.1 GitHub CLIでSecretsを登録する例

CLIから設定する場合は`gh secret set`を利用します。

```bash
gh secret set AZURE_CLIENT_ID \
  --repo nuitsjp/swa-github-role-sync \
  --body "11111111-2222-3333-4444-555555555555"

gh secret set AZURE_TENANT_ID \
  --repo nuitsjp/swa-github-role-sync \
  --body "0f12ab34-5678-90ab-cdef-1234567890ab"

gh secret set AZURE_SUBSCRIPTION_ID \
  --repo nuitsjp/swa-github-role-sync \
  --body "3b8a5c2d-1234-5678-9abc-def012345678"
```

Organization全体で共有したい場合は`--org <org> --app actions`を指定します。`gh auth login`でGitHub
CLIにログイン済みであることを事前に確認してください。

### 3. Discussionsカテゴリの準備

`Settings → General → Discussions → Manage categories`で同期結果を掲示するカテゴリを作成し、`discussion-category-name`に指定する名称を控えます。通知用途に合わせて公開/限定カテゴリを選択してください。

### 4. Workflow作成

SWAごとの通知文面を柔軟に変えられるよう、Discussionタイトル/本文テンプレートはリポジトリ変数として管理し、workflow側では`vars`から参照する方法を推奨しています。

#### 4.1 GitHub CLIでテンプレート変数を登録

以下の例では、`@{login}`や招待リンク、期限を差し込みつつ、「サインイン後にDiscussionを閉じる」運用を促すテンプレートを登録しています。

```bash
gh variable set DISCUSSION_TITLE_TEMPLATE \
  --body 'SWAロール招待 @{login}（{swaName}）{date}'

gh variable set DISCUSSION_BODY_TEMPLATE --body $'@{login}さん\n\n- ロール: {role}\n- 招待リンク: {inviteUrl}\n- 有効期限: {invitationExpirationHours}時間\n\nリンクからサインインできたらこのDiscussionをクローズしてください。期限切れの場合はコメントで再発行をリクエストできます。'
```

マルチライン文字列を扱うため、本文テンプレートでは`$'...'`構文を利用しています。既存テンプレートを更新したい場合も同じコマンドを再実行するだけで済み、workflowファイルを変更する必要はありません。

#### 4.2 Workflow定義

`.github/workflows/sync-swa-roles.yml`を作成し、Secretsと`vars`を組み合わせてActionへ入力します。

```yaml
name: Sync SWA roles

on:
  workflow_dispatch:
  schedule:
    - cron: '0 3 * * 1'

jobs:
  sync:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      discussions: write
      id-token: write
    steps:
      - uses: actions/checkout@v4

      - name: Azure login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Sync SWA role assignments
        uses: nuitsjp/swa-github-role-sync@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          swa-name: my-swa-app
          swa-resource-group: rg-app-prod
          discussion-category-name: Announcements
          discussion-title-template: ${{ vars.DISCUSSION_TITLE_TEMPLATE }}
          discussion-body-template: ${{ vars.DISCUSSION_BODY_TEMPLATE }}
```

`vars`を参照することで、テンプレート変更をUIまたはGitHub
CLI経由で完結でき、レビュー負荷を抑えたままチームに合わせた告知文面へ差し替えられます。複数SWAを同期する場合はworkflowを複製し、`with`の`{swa-*}`入力や使用するテンプレート変数名を切り替えます。

### 5. テスト実行

`workflow_dispatch`で手動実行し、`core.summary`とDiscussion本文が期待どおりか確認します。初回は対象ユーザー全員に招待リンクが生成されるため、告知タイミングをチームと共有してから実行してください。

### 6. スケジュール化

問題なければ`schedule`トリガーを追加し、週次/平日日次など組織の棚卸し周期に合わせてcron式を設定します。即時反映したい場合は`push`や`pull_request`イベントと併用することもできます。

### 7. Cleanup Workflowの追加（推奨）

招待リンクの有効期限が切れたDiscussionを残しておくと、ユーザーが誤ってアクセスして混乱する原因になります。`cleanup-discussions` Actionを使って定期的に削除することを推奨します。

`.github/workflows/cleanup-discussions.yml`を作成します：

```yaml
name: Cleanup expired discussions

on:
  schedule:
    - cron: '0 0 * * *' # 毎日実行
  workflow_dispatch:

jobs:
  cleanup:
    runs-on: ubuntu-latest
    permissions:
      discussions: write
    steps:
      - name: Cleanup expired discussions
        uses: nuitsjp/swa-github-role-sync/cleanup-discussions@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          discussion-category-name: Announcements
          expiration-hours: 24 # 同期Actionの有効期限設定に合わせる
          cleanup-mode: ${{ github.event_name == 'workflow_dispatch' && 'immediate' || 'expiration' }}
```

`cleanup-mode`を指定することで、手動実行時（`workflow_dispatch`）は即座に削除し、スケジュール実行時は期限切れのみ削除するといった使い分けが可能になります。

`discussion-title-template`を変更している場合は、このActionにも同じテンプレートを指定して、削除対象を正しく特定できるようにしてください。

## Recommended Workflow Patterns

- **ローリング招待**: 新規メンバーが多い場合は`workflow_dispatch`を常に残し、必要に応じて手動同期できるようにする。
- **複数SWA運用**:
  SWAごとに別workflowを準備し、`swa-*`入力とDiscussionカテゴリを分ける。共通`target-repo`であれば同じGitHub権限集合を使い回せる。
- **Dry
  Run**: 新しいテンプレートを導入する際は`workflow_dispatch`で試走し、招待用DiscussionとJobサマリーの両方が期待どおりか確認する。

## Discussion Template Tips

- タイトルに`@{login}`と`{date}`を入れると宛先と実行日が一目で分かり、複数の招待を整理しやすくなります。
- 本文では`{role}`, `{inviteUrl}`, `{invitationExpirationHours}`とあわせて「サインイン後にDiscussionを閉じる」「期限切れ時はコメントする」といった運用ルールを書き込みましょう。
- 集計値は`GITHUB_STEP_SUMMARY`で確認できるため、Discussion本文には必要最低限の案内だけを残し、管理者向けの詳細はサマリーに任せる構成がおすすめです。

## Troubleshooting

| 事象                                         | 原因と対処                                                                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Discussion category "..." not found`        | 指定カテゴリ名が一致していないかDiscussions機能が無効。SettingsでDiscussionsを有効化して正しい名前を設定する。                                                                  |
| `Failed to retrieve invite URL`              | `swa-domain`に存在しないドメインを指定したか、`azure/login`ステップが失敗して`az`権限がない。ログで`azure/login`成功を確認し、必要なら`az version`を追加してCLIの健全性を検証。 |
| `Plan -> add:0 update:0 remove:0`            | 差分がない通常動作。GitHub側で権限を変更してから再実行する。                                                                                                                    |
| `403 Resource not accessible by integration` | `github-token`のpermissions不足。workflowの`permissions`ブロックを確認し、Discussions書き込みを許可する。また`target-repo`が異なる場合PATを使用する。                           |
| `Unauthorized`（Azure CLI）                  | OIDCフェデレーション設定が正しくない。サービスプリンシパルにStatic Web Appsのリソースアクセス権があるか再確認する。                                                             |

## FAQ

**Q1. オーガナイゼーションの外部コラボレーターは同期されますか?**  
`affiliation: all`でコラボレーター一覧を取得しているため、外部コラボレーターでも`write`以上なら同期対象になります。

**Q2. SWAの既存ユーザーを維持したい場合は?**  
`role-prefix`に一致しないロールは差分計算から除外されるため、手動追加したロールを残したい場合は別のプレフィックスを使うか、対象ロールのみ`role-prefix`に合わせるよう命名規則を調整してください。

**Q3. Discussionを作成せずに実行できますか?**  
いいえ。現状のActionは新規招待ごとにDiscussionを作成し、そこから利用者へ連絡することを前提にしています。もし一般公開したくない場合は限定カテゴリを用意するか、クローズドリポジトリで実行したうえで`cleanup-discussions`を合わせて運用してください。

**Q4. 招待リンクの有効期限は変更できますか?**
`invitation-expiration-hours`入力で1〜168時間（デフォルト168時間）の範囲で指定できます。長期アクセスが必要な場合でも、セキュリティの観点から短めの期限で定期的に発行する運用を推奨します。

**Q5. 同期できるユーザー数に上限はありますか？**  
はい。Azure Static Web Appsの仕様により、カスタムロールを割り当て可能なユーザーはFree/Standardプランともに25名までです。本Actionは同期対象が25名を超えた場合、安全のためエラーで処理を中断します。

## Support & Next Steps

- 細かな挙動変更やテンプレート改善の要望はGitHub Issuesで受け付けています。
- ロールマッピングや差分アルゴリズムの仕組みに興味がある場合は`docs/architecture.ja.md`（今後公開）を参照してください。
- ローカル検証や開発プロセスを把握したい場合は`docs/dev-guide.ja.md`（今後公開）を参照予定です。
