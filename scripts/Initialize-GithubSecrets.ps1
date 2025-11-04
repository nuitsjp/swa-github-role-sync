<#
.SYNOPSIS
    GitHub ActionsワークフローのためのシークレットをAzureリソースから作成・登録するスクリプト

.DESCRIPTION
    Azure Service Principalを作成し、必要なシークレット（AZURE_CREDENTIALS、AZURE_STATIC_WEB_APP_NAME、
    AZURE_RESOURCE_GROUP など）をGitHubリポジトリに自動的に登録します。
    対象のGitHubリポジトリは、スクリプトを実行したGitリポジトリの`origin`リモートから自動検出されます。
    設定値は指定された config.json から読み込みます。

    注意: このスクリプトを実行するには、GitHub Personal Access Tokenに以下の権限が必要です：
    - Classic token: 'repo' と 'workflow' スコープ
    - Fine-grained token: Actions と Secrets の Read/Write 権限

    ワークフローは自動的にGITHUB_TOKENを使用するため、GH_TOKENシークレットは不要です。

.EXAMPLE
    pwsh -File .\scripts\Initialize-GithubSecrets.ps1

.EXAMPLE
    pwsh -File .\scripts\Initialize-GithubSecrets.ps1 -ConfigPath .\config.prod.json

.PARAMETER ConfigPath
    読み込む設定ファイルのパス。既定値はリポジトリルートの config.json です。

.NOTES
    必要な権限:
    - Azure: サブスクリプションの所有者または管理者ロール
    - GitHub: リポジトリの管理者権限

    事前準備:
    - Azure CLI (az) のインストールと認証 (az login)
    - GitHub CLI (gh) のインストールと認証 (gh auth login)

    このスクリプトは以下を実行します:
    1. Azure Service Principalの作成
    2. 必要な権限の付与
    3. GitHub Personal Access Tokenの取得または検証
    4. GitHubリポジトリへのシークレット登録
#>

param(
    [string]$ConfigPath = "config.json"
)

# エラー発生時に停止
$ErrorActionPreference = "Stop"

# 共通関数を読み込む
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDir "common-functions.ps1")

# Azure Service Principalの作成
function New-AzureServicePrincipal {
    param(
        [string]$Name,
        [string]$SubscriptionId,
        [string]$ResourceGroup,

        [Parameter(Mandatory=$false)]
        [string]$StaticWebAppName
    )

    try {
        # 既存のService Principalを確認
        $existingSp = az ad sp list --display-name $Name --query "[0]" 2>&1 | ConvertFrom-Json

        if ($existingSp) {
            Write-Log "既存のService Principalが見つかりました: $Name" -Level WARNING
            $response = Read-Host "既存のService Principalを削除して再作成しますか？ (y/N)"

            if ($response -eq "y" -or $response -eq "Y") {
                Write-Log "既存のService Principalを削除中..."
                az ad sp delete --id $existingSp.id 2>&1 | Out-Null
                Write-Log "削除完了" -Level SUCCESS
            }
            else {
                Write-Log "既存のService Principalの資格情報を再生成します..." -Level INFO

                $credentialResetOutput = az ad sp credential reset `
                    --name $existingSp.appId `
                    --credential-description "GitHubActions-$([Guid]::NewGuid().ToString())" `
                    --years 1 `
                    --output json 2>&1

                if ($LASTEXITCODE -ne 0) {
                    throw "Service Principal の資格情報リセットに失敗しました: $credentialResetOutput"
                }

                $resetCredentials = $credentialResetOutput | ConvertFrom-Json

                $credentialsJson = [pscustomobject]@{
                    clientId = $resetCredentials.appId
                    clientSecret = $resetCredentials.password
                    subscriptionId = $SubscriptionId
                    tenantId = $resetCredentials.tenant
                    activeDirectoryEndpointUrl = "https://login.microsoftonline.com"
                    resourceManagerEndpointUrl = "https://management.azure.com/"
                    activeDirectoryGraphResourceId = "https://graph.windows.net/"
                    sqlManagementEndpointUrl = "https://management.core.windows.net:8443/"
                    galleryEndpointUrl = "https://gallery.azure.com/"
                    managementEndpointUrl = "https://management.core.windows.net/"
                }

                Write-Log "資格情報を再生成しました" -Level SUCCESS
                Write-Log "Client ID: $($credentialsJson.clientId)" -Level SUCCESS
                return $credentialsJson
            }
        }

        # Service Principalを作成
        $scope = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup"

        Write-Log "スコープ: $scope"
        Write-Log "Service Principalを作成しています..."

        # stderrを別ファイルにリダイレクトしてJSON出力のみを取得
        $tempErrorFile = [System.IO.Path]::GetTempFileName()

        try {
            $credentials = az ad sp create-for-rbac `
                --name $Name `
                --role contributor `
                --scopes $scope `
                --sdk-auth `
                2>$tempErrorFile

            if ($LASTEXITCODE -ne 0) {
                $errorContent = Get-Content $tempErrorFile -Raw
                throw "Service Principalの作成に失敗しました: $errorContent"
            }

            # 警告メッセージを表示（あれば）
            if (Test-Path $tempErrorFile) {
                $errorContent = Get-Content $tempErrorFile -Raw
                if ($errorContent -and $errorContent.Trim()) {
                    Write-Log "Azure CLIからの警告: $errorContent" -Level WARNING
                }
            }

            # JSONをパース
            $credentialsJson = $credentials | ConvertFrom-Json
        }
        finally {
            # 一時ファイルを削除
            if (Test-Path $tempErrorFile) {
                Remove-Item $tempErrorFile -Force -ErrorAction SilentlyContinue
            }
        }

        Write-Log "Service Principalの作成に成功しました" -Level SUCCESS
        Write-Log "Client ID: $($credentialsJson.clientId)" -Level SUCCESS

        return $credentialsJson
    }
    catch {
        Write-Log "Service Principalの作成に失敗しました: $_" -Level ERROR
        throw
    }
}

# GitHub認証の確認（gh CLIの認証状態をチェック）
function Test-GitHubCLIAuth {
    param([string]$Repo)

    Write-Log "GitHub CLIの認証状態を確認中..."

    try {
        # gh CLIが認証済みか確認
        $authStatus = gh auth status 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Log "GitHub CLI認証: OK" -Level SUCCESS
            
            # リポジトリへのアクセスをテスト
            $result = gh api "repos/$Repo" 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Log "リポジトリアクセス: OK" -Level SUCCESS
                return $true
            }
        }
        
        Write-Log "GitHub CLIが認証されていないか、リポジトリにアクセスできません" -Level WARNING
        return $false
    }
    catch {
        Write-Log "GitHub CLI認証の確認に失敗しました: $_" -Level WARNING
        return $false
    }
}

# GitHub Personal Access Tokenの取得（フォールバック用）
function Get-GitHubToken {
    param([string]$ProvidedToken)

    if ($ProvidedToken) {
        Write-Log "提供されたGitHub Tokenを使用します"
        return $ProvidedToken
    }

    Write-Log "GitHub Personal Access Tokenが必要です" -Level WARNING
    Write-Log "以下の手順でトークンを作成してください:" -Level INFO
    Write-Log "1. https://github.com/settings/tokens にアクセス" -Level INFO
    Write-Log "2. 'Generate new token (classic)' をクリック" -Level INFO
    Write-Log "3. 必須スコープを選択:" -Level INFO
    Write-Log "   - 'repo' (Full control of private repositories)" -Level INFO
    Write-Log "   - 'workflow' (Update GitHub Action workflows) ← 重要！" -Level INFO
    Write-Log "4. トークンを生成してコピー" -Level INFO
    Write-Log "" -Level INFO
    Write-Log "注意: 'workflow' スコープがないとActions secretsを設定できません" -Level WARNING
    Write-Log "" -Level INFO

    $token = Read-Host "GitHub Personal Access Tokenを入力してください" -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($token)
    $plainToken = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)

    if ([string]::IsNullOrWhiteSpace($plainToken)) {
        throw "GitHub Tokenが入力されませんでした"
    }

    return $plainToken
}

# GitHub Tokenの検証（明示的なトークンが提供された場合のみ使用）
function Test-GitHubTokenAccess {
    param(
        [string]$Token,
        [string]$Repo
    )

    Write-Log "GitHub Tokenを検証中..."

    try {
        # 一時的に環境変数を設定
        $env:GH_TOKEN = $Token

        # リポジトリへのアクセスをテスト
        $result = gh api "repos/$Repo" 2>&1

        if ($LASTEXITCODE -ne 0) {
            throw "リポジトリへのアクセスに失敗しました: $result"
        }

        Write-Log "GitHub Tokenの検証に成功しました" -Level SUCCESS
        return $true
    }
    catch {
        Write-Log "GitHub Tokenの検証に失敗しました: $_" -Level ERROR
        return $false
    }
    finally {
        Remove-Item Env:\GH_TOKEN -ErrorAction SilentlyContinue
    }
}

# GitHubシークレットの設定
function Set-GitHubSecret {
    param(
        [string]$Repo,
        [string]$SecretName,
        [string]$SecretValue,
        [string]$Token = $null
    )

    Write-Log "GitHubシークレットを設定中: $SecretName"

    try {
        # Tokenが提供されている場合のみ環境変数を設定
        if ($Token) {
            $env:GH_TOKEN = $Token
        }

        # stderrを別ファイルにリダイレクトして詳細なエラー情報を取得
        $tempErrorFile = [System.IO.Path]::GetTempFileName()

        try {
            # シークレットを設定
            $SecretValue | gh secret set $SecretName --repo $Repo 2>$tempErrorFile | Out-Null

            if ($LASTEXITCODE -ne 0) {
                $errorContent = Get-Content $tempErrorFile -Raw -ErrorAction SilentlyContinue
                if ($errorContent -and $errorContent.Trim()) {
                    throw "シークレットの設定に失敗しました: $errorContent"
                } else {
                    throw "シークレットの設定に失敗しました (終了コード: $LASTEXITCODE)"
                }
            }

            Write-Log "シークレットの設定に成功しました: $SecretName" -Level SUCCESS
            return $true
        }
        finally {
            # 一時ファイルを削除
            if (Test-Path $tempErrorFile) {
                Remove-Item $tempErrorFile -Force -ErrorAction SilentlyContinue
            }
        }
    }
    catch {
        Write-Log "シークレットの設定に失敗しました: $SecretName - $_" -Level ERROR
        return $false
    }
    finally {
        if ($Token) {
            Remove-Item Env:\GH_TOKEN -ErrorAction SilentlyContinue
        }
    }
}

# メイン処理
try {
# 設定ファイルを読み込む
    $config = Get-Configuration -ConfigPath $ConfigPath
    
    # 設定から値を取得
    $SubscriptionId = $config.Azure.SubscriptionId
    $ResourceGroup = $config.Azure.ResourceGroup
    $StaticWebAppName = $config.Azure.StaticWebAppName
    $ServicePrincipalName = $config.ServicePrincipal.Name
    $GitHubRepo = Get-GitHubRepositoryFromGit -StartPath $scriptDir
    $discussionEnabled = $null
    $discussionCategoryId = ""
    $discussionTitle = ""
    $discussionBodyTemplate = ""
    $invitationExpiresInHours = $null

    $discussionConfig = $config.Discussion
    if ($discussionConfig -is [System.Collections.IDictionary]) {
        if ($discussionConfig.ContainsKey("Enabled")) {
            try {
                $discussionEnabled = [System.Convert]::ToBoolean($discussionConfig["Enabled"])
            }
            catch {
                Write-Log "config.json の discussion.enabled を boolean に変換できません: $($discussionConfig["Enabled"])" -Level WARNING
            }
        }
        if ($discussionConfig.ContainsKey("CategoryId")) {
            $discussionCategoryId = $discussionConfig["CategoryId"]
        }
        if ($discussionConfig.ContainsKey("Title")) {
            $discussionTitle = $discussionConfig["Title"]
        }
        if ($discussionConfig.ContainsKey("BodyTemplate")) {
            $discussionBodyTemplate = $discussionConfig["BodyTemplate"]
        }
    }

    $invitationConfig = $config.InvitationSettings
    if ($invitationConfig -is [System.Collections.IDictionary] -and $invitationConfig.ContainsKey("ExpiresInHours")) {
        try {
            $invitationExpiresInHours = [int]$invitationConfig["ExpiresInHours"]
        }
        catch {
            Write-Log "config.json の invitationSettings.expiresInHours を整数に変換できません: $($invitationConfig["ExpiresInHours"])" -Level WARNING
            $invitationExpiresInHours = $null
        }
    }

    try {
        $resolvedConfigPath = (Resolve-Path -Path $ConfigPath -ErrorAction Stop).Path
    }
    catch {
        $resolvedConfigPath = $ConfigPath
    }
    
    Write-Log "========================================" -Level INFO
    Write-Log "GitHub Secretsセットアップスクリプト" -Level INFO
    Write-Log "========================================" -Level INFO
    Write-Log "ConfigPath: $resolvedConfigPath" -Level INFO
    Write-Log "SubscriptionId: $SubscriptionId" -Level INFO
    Write-Log "ResourceGroup: $ResourceGroup" -Level INFO
    Write-Log "StaticWebAppName: $StaticWebAppName" -Level INFO
    Write-Log "GitHubRepo: $GitHubRepo (detected from git)" -Level INFO
    Write-Log "ServicePrincipalName: $ServicePrincipalName" -Level INFO
    Write-Log "========================================" -Level INFO

    # 前提条件の確認
    if (-not (Test-Prerequisites -SkipGitHub)) {
        exit 1
    }

    # サブスクリプションの設定
    Write-Log "Azureサブスクリプションを設定中..."
    az account set --subscription $SubscriptionId 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Log "サブスクリプションの設定に失敗しました" -Level ERROR
        exit 1
    }
    Write-Log "サブスクリプション設定: OK" -Level SUCCESS

    # Static Web Appの存在確認
    Write-Log "Static Web Appの存在を確認中..."
    $swa = az staticwebapp show --name $StaticWebAppName --resource-group $ResourceGroup 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Log "Static Web Appが見つかりません: $StaticWebAppName" -Level ERROR
        exit 1
    }
    Write-Log "Static Web App: OK" -Level SUCCESS

    Write-Log "========================================" -Level INFO

    # 1. Azure Service Principalの作成
    $credentials = New-AzureServicePrincipal -Name $ServicePrincipalName `
                                              -SubscriptionId $SubscriptionId `
                                              -ResourceGroup $ResourceGroup

    # AZURE_CREDENTIALS JSONを作成
    $azureCredentialsJson = $credentials | ConvertTo-Json -Compress

    Write-Log "========================================" -Level INFO

    # 2. GitHub認証の確認と取得
    $githubToken = $null

    # まずgh CLIの認証状態を確認
    if (Test-GitHubCLIAuth -Repo $GitHubRepo) {
        Write-Log "GitHub CLIの既存認証を使用します" -Level SUCCESS
    }
    else {
        # gh CLIが未認証の場合は、トークンを入力してもらう
        $githubToken = Get-GitHubToken
        
        if (-not (Test-GitHubTokenAccess -Token $githubToken -Repo $GitHubRepo)) {
            Write-Log "GitHub Tokenの検証に失敗しました" -Level ERROR
            exit 1
        }
    }

    Write-Log "========================================" -Level INFO

    # 3. GitHubシークレットの設定
    Write-Log "GitHubシークレットを設定中..." -Level INFO

    $successCount = 0
    $failureCount = 0

    $secretDefinitions = @(
        @{ Name = "AZURE_CREDENTIALS"; Value = $azureCredentialsJson; Required = $true; Description = "Azure Service Principal認証情報" },
        @{ Name = "AZURE_STATIC_WEB_APP_NAME"; Value = $StaticWebAppName; Required = $true; Description = "Static Web App 名" },
        @{ Name = "AZURE_RESOURCE_GROUP"; Value = $ResourceGroup; Required = $true; Description = "リソースグループ名" }
    )

    if (-not [string]::IsNullOrWhiteSpace($SubscriptionId)) {
        $secretDefinitions += @{ Name = "AZURE_SUBSCRIPTION_ID"; Value = $SubscriptionId; Required = $false; Description = "サブスクリプション ID" }
    }

    if ($null -ne $discussionEnabled) {
        $secretDefinitions += @{
            Name = "SWA_DISCUSSION_ENABLED"
            Value = $discussionEnabled.ToString().ToLowerInvariant()
            Required = $false
            Description = "Discussion 投稿の有効/無効"
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($discussionCategoryId)) {
        $secretDefinitions += @{ Name = "SWA_DISCUSSION_CATEGORY_ID"; Value = $discussionCategoryId; Required = $false; Description = "Discussion カテゴリ ID" }
    }

    if (-not [string]::IsNullOrWhiteSpace($discussionTitle)) {
        $secretDefinitions += @{ Name = "SWA_DISCUSSION_TITLE"; Value = $discussionTitle; Required = $false; Description = "Discussion タイトル" }
    }

    if (-not [string]::IsNullOrWhiteSpace($discussionBodyTemplate)) {
        $secretDefinitions += @{ Name = "SWA_DISCUSSION_BODY_TEMPLATE"; Value = $discussionBodyTemplate; Required = $false; Description = "Discussion 本文テンプレート" }
    }

    if ($invitationExpiresInHours -gt 0) {
        $secretDefinitions += @{
            Name = "SWA_INVITATION_EXPIRES_HOURS"
            Value = $invitationExpiresInHours.ToString()
            Required = $false
            Description = "招待リンク有効期限 (時間)"
        }
    }

    $createdSecrets = @()
    $skippedSecrets = @()

    foreach ($secret in $secretDefinitions) {
        $value = $secret.Value
        $name = $secret.Name
        $required = [bool]$secret.Required

        if ($null -eq $value -or ([string]::IsNullOrWhiteSpace($value) -and $value -ne "0")) {
            if ($required) {
                Write-Log "$name の値が空のためシークレットを設定できません" -Level ERROR
                $failureCount++
            }
            else {
                Write-Log "$name の値が空のためシークレット設定をスキップします" -Level WARNING
                $skippedSecrets += $name
            }
            continue
        }

        if (Set-GitHubSecret -Repo $GitHubRepo -SecretName $name -SecretValue $value -Token $githubToken) {
            $successCount++
            $createdSecrets += $name
        }
        else {
            $failureCount++
        }
    }

    Write-Log "========================================" -Level INFO
    Write-Log "セットアップ完了" -Level SUCCESS
    Write-Log "成功: $successCount 件" -Level SUCCESS
    Write-Log "失敗: $failureCount 件" -Level $(if ($failureCount -gt 0) { "ERROR" } else { "INFO" })
    Write-Log "========================================" -Level INFO

    if ($failureCount -eq 0) {
        Write-Log "" -Level INFO
        Write-Log "次のステップ:" -Level INFO
        Write-Log "1. GitHubリポジトリの Settings > Secrets and variables > Actions でシークレットを確認" -Level INFO
        Write-Log "2. GitHub Actionsワークフローを実行してテスト" -Level INFO
        Write-Log "" -Level INFO
        if ($createdSecrets.Count -gt 0) {
            Write-Log "作成されたシークレット:" -Level INFO
            foreach ($secretName in $createdSecrets) {
                Write-Log ("  - {0}" -f $secretName) -Level INFO
            }
        }
        if ($skippedSecrets.Count -gt 0) {
            Write-Log "" -Level WARNING
            Write-Log "値が空だったためスキップしたシークレット:" -Level WARNING
            foreach ($secretName in $skippedSecrets) {
                Write-Log ("  - {0}" -f $secretName) -Level WARNING
            }
        }
        Write-Log "" -Level INFO
        Write-Log "注意: ワークフローはGITHUB_TOKENを自動使用するため、GH_TOKENは不要です" -Level INFO
    }
    else {
        Write-Log "" -Level WARNING
        Write-Log "一部のシークレットの設定に失敗しました" -Level WARNING
        Write-Log "手動で設定するか、スクリプトを再実行してください" -Level WARNING
        exit 1
    }
}
catch {
    Write-Log "予期しないエラーが発生しました: $_" -Level ERROR
    Write-Log "スタックトレース: $($_.ScriptStackTrace)" -Level ERROR
    exit 1
}
