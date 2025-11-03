<#
.SYNOPSIS
    Azure Static Web AppとGitHubリポジトリのユーザーを同期するスクリプト

.DESCRIPTION
    GitHubリポジトリでpush権限を持つユーザーを取得し、Azure Static Web Appの認証済みユーザーと同期します。
    GitHubにあってAzureにないユーザーは追加し、Azureにのみ存在するユーザーは削除します。

.PARAMETER AppName
    Azure Static Web App名

.PARAMETER ResourceGroup
    Azureリソースグループ名

.PARAMETER GitHubRepo
    GitHubリポジトリ（形式: owner/repo）

.PARAMETER DryRun
    変更を適用せずに実行結果をプレビューします

.EXAMPLE
    .\sync-swa-users.ps1 -AppName "my-static-web-app" -ResourceGroup "my-resource-group" -GitHubRepo "owner/repo"

.EXAMPLE
    .\sync-swa-users.ps1 -AppName "my-static-web-app" -ResourceGroup "my-resource-group" -GitHubRepo "owner/repo" -DryRun

.NOTES
    必要な権限:
    - GitHub: リポジトリの読み取り権限
    - Azure: Static Web Appの共同作成者ロール以上
    
    事前準備:
    - Azure CLI (az) のインストールと認証 (az login)
    - GitHub CLI (gh) のインストールと認証 (gh auth login)
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$AppName,
    
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroup,
    
    [Parameter(Mandatory=$true)]
    [string]$GitHubRepo,
    
    [Parameter(Mandatory=$false)]
    [switch]$DryRun
)

# エラー発生時に停止
$ErrorActionPreference = "Stop"

# ログ関数
function Write-Log {
    param(
        [string]$Message,
        [ValidateSet("INFO", "SUCCESS", "WARNING", "ERROR")]
        [string]$Level = "INFO"
    )
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $color = switch ($Level) {
        "INFO"    { "White" }
        "SUCCESS" { "Green" }
        "WARNING" { "Yellow" }
        "ERROR"   { "Red" }
    }
    
    Write-Host "[$timestamp] [$Level] $Message" -ForegroundColor $color
}

# Azure CLIの存在確認
function Test-AzureCLI {
    try {
        $null = az --version 2>&1
        return $true
    }
    catch {
        return $false
    }
}

# GitHub CLIの存在確認
function Test-GitHubCLI {
    try {
        $null = gh --version 2>&1
        return $true
    }
    catch {
        return $false
    }
}

# GitHubリポジトリのコラボレーター取得（push権限以上）
function Get-GitHubCollaborators {
    param([string]$Repo)
    
    Write-Log "GitHubリポジトリのコラボレーター一覧を取得中: $Repo"
    
    try {
        # GitHub APIでコラボレーター一覧を取得（最大3回リトライ）
        $retries = 3
        $collaborators = $null
        
        for ($i = 1; $i -le $retries; $i++) {
            try {
                # GitHub CLIを使用してコラボレーター一覧を取得
                $result = gh api "repos/$Repo/collaborators" --jq '.[] | select(.permissions.push == true or .permissions.admin == true or .permissions.maintain == true) | .login' 2>&1
                
                if ($LASTEXITCODE -eq 0) {
                    $collaborators = $result | Where-Object { $_ -ne "" }
                    break
                }
                else {
                    if ($i -lt $retries) {
                        Write-Log "GitHub API呼び出しに失敗しました。リトライします... ($i/$retries)" -Level WARNING
                        Start-Sleep -Seconds 2
                    }
                    else {
                        throw "GitHub API呼び出しに失敗しました: $result"
                    }
                }
            }
            catch {
                if ($i -eq $retries) {
                    throw
                }
            }
        }
        
        if ($null -eq $collaborators -or $collaborators.Count -eq 0) {
            Write-Log "push権限を持つコラボレーターが見つかりませんでした" -Level WARNING
            return @()
        }
        
        Write-Log "push権限を持つコラボレーター数: $($collaborators.Count)" -Level SUCCESS
        return $collaborators
    }
    catch {
        Write-Log "GitHubコラボレーターの取得に失敗しました: $_" -Level ERROR
        throw
    }
}

# Azure Static Web Appのユーザー一覧を取得
function Get-AzureStaticWebAppUsers {
    param(
        [string]$AppName,
        [string]$ResourceGroup
    )
    
    Write-Log "Azure Static Web Appのユーザー一覧を取得中: $AppName"
    
    try {
        # Azure CLIでユーザー一覧を取得
        $retries = 3
        $users = $null
        
        for ($i = 1; $i -le $retries; $i++) {
            try {
                $output = az staticwebapp users list --name $AppName --resource-group $ResourceGroup --authentication-provider github 2>&1
                
                if ($LASTEXITCODE -eq 0) {
                    # JSONパースを試行
                    try {
                        $result = $output | ConvertFrom-Json
                        # authenticatedロールを持つユーザーを抽出
                        $users = $result | Where-Object { $_.roles -contains "authenticated" } | Select-Object -ExpandProperty userId
                        break
                    }
                    catch {
                        throw "Azure APIレスポンスのJSON解析に失敗しました: $output"
                    }
                }
                else {
                    if ($i -lt $retries) {
                        Write-Log "Azure API呼び出しに失敗しました。リトライします... ($i/$retries)" -Level WARNING
                        Start-Sleep -Seconds 2
                    }
                    else {
                        throw "Azure API呼び出しに失敗しました: $output"
                    }
                }
            }
            catch {
                if ($i -eq $retries) {
                    throw
                }
            }
        }
        
        if ($null -eq $users) {
            $users = @()
        }
        
        Write-Log "現在のAzureユーザー数: $($users.Count)" -Level SUCCESS
        return $users
    }
    catch {
        Write-Log "Azureユーザーの取得に失敗しました: $_" -Level ERROR
        throw
    }
}

# ユーザーをAzure Static Web Appに招待
function Add-AzureStaticWebAppUser {
    param(
        [string]$AppName,
        [string]$ResourceGroup,
        [string]$UserName,
        [int]$InvitationExpiresInHours = 168  # 7日間
    )
    
    Write-Log "ユーザーを招待中: $UserName"
    
    try {
        $result = az staticwebapp users invite `
            --name $AppName `
            --resource-group $ResourceGroup `
            --authentication-provider github `
            --user-details $UserName `
            --roles authenticated `
            --invitation-expiration-in-hours $InvitationExpiresInHours `
            2>&1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Log "ユーザーの招待に成功しました: $UserName" -Level SUCCESS
            return $true
        }
        else {
            Write-Log "ユーザーの招待に失敗しました: $UserName - $result" -Level ERROR
            return $false
        }
    }
    catch {
        Write-Log "ユーザーの招待中にエラーが発生しました: $UserName - $_" -Level ERROR
        return $false
    }
}

# ユーザーをAzure Static Web Appから削除（anonymousロールに変更）
function Remove-AzureStaticWebAppUser {
    param(
        [string]$AppName,
        [string]$ResourceGroup,
        [string]$UserName
    )
    
    Write-Log "ユーザーを削除中: $UserName"
    
    try {
        # ユーザーをanonymousロールに更新することで実質的に削除
        $result = az staticwebapp users update `
            --name $AppName `
            --resource-group $ResourceGroup `
            --authentication-provider github `
            --user-details $UserName `
            --roles anonymous `
            2>&1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Log "ユーザーの削除に成功しました: $UserName" -Level SUCCESS
            return $true
        }
        else {
            Write-Log "ユーザーの削除に失敗しました: $UserName - $result" -Level ERROR
            return $false
        }
    }
    catch {
        Write-Log "ユーザーの削除中にエラーが発生しました: $UserName - $_" -Level ERROR
        return $false
    }
}

# メイン処理
try {
    Write-Log "========================================" -Level INFO
    Write-Log "Azure Static Web App ユーザー同期スクリプト" -Level INFO
    Write-Log "========================================" -Level INFO
    Write-Log "AppName: $AppName" -Level INFO
    Write-Log "ResourceGroup: $ResourceGroup" -Level INFO
    Write-Log "GitHubRepo: $GitHubRepo" -Level INFO
    if ($DryRun) {
        Write-Log "実行モード: ドライラン（変更は適用されません）" -Level WARNING
    }
    Write-Log "========================================" -Level INFO
    
    # 前提条件の確認
    Write-Log "前提条件を確認中..." -Level INFO
    
    if (-not (Test-AzureCLI)) {
        Write-Log "Azure CLI (az) がインストールされていません" -Level ERROR
        Write-Log "https://docs.microsoft.com/cli/azure/install-azure-cli からインストールしてください" -Level ERROR
        exit 1
    }
    Write-Log "Azure CLI: OK" -Level SUCCESS
    
    if (-not (Test-GitHubCLI)) {
        Write-Log "GitHub CLI (gh) がインストールされていません" -Level ERROR
        Write-Log "https://cli.github.com/ からインストールしてください" -Level ERROR
        exit 1
    }
    Write-Log "GitHub CLI: OK" -Level SUCCESS
    
    # Azure認証状態の確認
    $azAccount = az account show 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Log "Azureにログインしていません。'az login' を実行してください" -Level ERROR
        exit 1
    }
    Write-Log "Azure認証: OK" -Level SUCCESS
    
    # GitHub認証状態の確認
    $ghAuth = gh auth status 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Log "GitHubにログインしていません。'gh auth login' を実行してください" -Level ERROR
        exit 1
    }
    Write-Log "GitHub認証: OK" -Level SUCCESS
    
    Write-Log "========================================" -Level INFO
    
    # 1. GitHubコラボレーターを取得
    $githubUsers = Get-GitHubCollaborators -Repo $GitHubRepo
    
    # 2. Azureユーザーを取得
    $azureUsers = Get-AzureStaticWebAppUsers -AppName $AppName -ResourceGroup $ResourceGroup
    
    # 3. 差分を計算
    Write-Log "========================================" -Level INFO
    Write-Log "差分を計算中..." -Level INFO
    
    $usersToAdd = $githubUsers | Where-Object { $_ -notin $azureUsers }
    $usersToRemove = $azureUsers | Where-Object { $_ -notin $githubUsers }
    
    Write-Log "追加対象ユーザー数: $($usersToAdd.Count)" -Level INFO
    if ($usersToAdd.Count -gt 0) {
        $usersToAdd | ForEach-Object { Write-Log "  - $_" -Level INFO }
    }
    
    Write-Log "削除対象ユーザー数: $($usersToRemove.Count)" -Level INFO
    if ($usersToRemove.Count -gt 0) {
        $usersToRemove | ForEach-Object { Write-Log "  - $_" -Level INFO }
    }
    
    if ($usersToAdd.Count -eq 0 -and $usersToRemove.Count -eq 0) {
        Write-Log "同期が必要なユーザーはありません" -Level SUCCESS
        Write-Log "========================================" -Level INFO
        exit 0
    }
    
    Write-Log "========================================" -Level INFO
    
    if ($DryRun) {
        Write-Log "ドライランモードのため、変更は適用されません" -Level WARNING
        Write-Log "========================================" -Level INFO
        exit 0
    }
    
    # 4. ユーザー同期
    $successCount = 0
    $failureCount = 0
    
    # 新規ユーザーを追加
    if ($usersToAdd.Count -gt 0) {
        Write-Log "ユーザーを追加中..." -Level INFO
        foreach ($user in $usersToAdd) {
            if (Add-AzureStaticWebAppUser -AppName $AppName -ResourceGroup $ResourceGroup -UserName $user) {
                $successCount++
            }
            else {
                $failureCount++
            }
        }
    }
    
    # 不要なユーザーを削除
    if ($usersToRemove.Count -gt 0) {
        Write-Log "ユーザーを削除中..." -Level INFO
        foreach ($user in $usersToRemove) {
            if (Remove-AzureStaticWebAppUser -AppName $AppName -ResourceGroup $ResourceGroup -UserName $user) {
                $successCount++
            }
            else {
                $failureCount++
            }
        }
    }
    
    # 結果サマリー
    Write-Log "========================================" -Level INFO
    Write-Log "同期完了" -Level SUCCESS
    Write-Log "成功: $successCount 件" -Level SUCCESS
    Write-Log "失敗: $failureCount 件" -Level $(if ($failureCount -gt 0) { "ERROR" } else { "INFO" })
    Write-Log "========================================" -Level INFO
    
    if ($failureCount -gt 0) {
        exit 1
    }
}
catch {
    Write-Log "予期しないエラーが発生しました: $_" -Level ERROR
    Write-Log "スタックトレース: $($_.ScriptStackTrace)" -Level ERROR
    exit 1
}
