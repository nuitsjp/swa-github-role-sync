// Azure Static Web Apps 認証情報を取得して表示
async function getUserInfo() {
    try {
        // キャッシュバスティング用のタイムスタンプを追加
        const timestamp = new Date().getTime();
        const response = await fetch(`/.auth/me?_=${timestamp}`, {
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
        const payload = await response.json();
        const { clientPrincipal } = payload;

        const authStatusDiv = document.getElementById('auth-status');
        const loginBtn = document.getElementById('login-btn');
        const logoutBtn = document.getElementById('logout-btn');

        if (clientPrincipal) {
            // ユーザーがログインしている場合
            const hasCollaboratorRole = clientPrincipal.userRoles.includes('github-collaborator');
            const roleWarning = hasCollaboratorRole ? '' : '<p class="auth-warning">⚠️ github-collaboratorロールが付与されていません。ページをリロードしてください。</p>';
            
            authStatusDiv.innerHTML = `
                <p><strong>認証状態:</strong> <span class="user-info">ログイン済み</span></p>
                <p><strong>ユーザー名:</strong> ${clientPrincipal.userDetails}</p>
                <p><strong>プロバイダー:</strong> ${clientPrincipal.identityProvider}</p>
                <p><strong>ユーザーID:</strong> ${clientPrincipal.userId}</p>
                <p><strong>ロール:</strong> ${clientPrincipal.userRoles.join(', ')}</p>
                ${roleWarning}
            `;

            logoutBtn.style.display = 'inline-block';
            loginBtn.style.display = 'none';
        } else {
            // ユーザーがログインしていない場合
            authStatusDiv.innerHTML = `
                <p class="auth-warning">現在ログインしていません</p>
                <p>このアプリケーションにアクセスするには、GitHubでログインする必要があります。</p>
            `;

            loginBtn.style.display = 'inline-block';
            logoutBtn.style.display = 'none';
        }
    } catch (error) {
        console.error('認証情報の取得に失敗しました:', error);
        const authStatusDiv = document.getElementById('auth-status');
        authStatusDiv.innerHTML = `
            <p class="auth-warning">認証情報の取得に失敗しました</p>
            <p>エラー: ${error.message}</p>
        `;
    }
}

// ログインボタンのクリックイベント
document.getElementById('login-btn').addEventListener('click', () => {
    window.location.href = '/.auth/login/github';
});

// ログアウトボタンのクリックイベント
document.getElementById('logout-btn').addEventListener('click', () => {
    window.location.href = '/.auth/logout';
});

// ページ読み込み時に認証情報を取得
document.addEventListener('DOMContentLoaded', getUserInfo);
