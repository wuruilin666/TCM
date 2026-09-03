/* ===================== 账号系统（前端） ===================== */
// 依赖 storage.js 里现有的 getCompletedCases/getWrongCases 读取游客本地数据。
// 本模块自己往 <body> 里插入所需的弹窗 HTML，index.html 只需要：
//   1. <script type="module" src="js/auth.js"></script>
//   2. 在任意位置放一个按钮调用 window.openAuthEntry()，作为登录/注册/我的账号 的入口
//      （具体放在导航栏"我的"里、还是先放一个临时按钮，你可以按你的页面布局自己决定）

import { getCompletedCases, getWrongCases, safeSetStorage, safeGetStorage, refreshProgressFromCloud } from './storage.js';

export const authState = { loggedIn: false, username: null, sessionExpired: false, expiredShown: false };

const REGISTER_PROMPT_LAST_COUNT_KEY = 'tcm_register_prompt_last_count';
const PENDING_SYNC_KEY = 'tcm_pending_sync';      // 浏览器级：是否还有学习记录未确认写入云端（只存状态，不存任何凭据）
const GUEST_CLAIMED_KEY = 'tcm_guest_claimed';    // 设备级：本机游客数据是否已被某个账号真正绑定上传过（防公共电脑串号）

/* ---------- pending sync 状态 ---------- */
function getPendingSync() { const v = safeGetStorage(PENDING_SYNC_KEY, null); return (v && v.pending) ? v : null; }
function markPendingSync() {
    if (getPendingSync()) return;
    safeSetStorage(PENDING_SYNC_KEY, { pending: true, since: new Date().toISOString() });
}
function clearPendingSync() {
    if (getPendingSync()) safeSetStorage(PENDING_SYNC_KEY, { pending: false });
}
function hasLocalRecords() { return getCompletedCases().length > 0 || getWrongCases().length > 0; }

/* ---------- 账号系统统一校验规则（前端与 functions/api/auth/*.js 保持一致） ---------- */
// 中文用 Unicode 属性匹配，比硬编码 \u4e00-\u9fa5 覆盖面更准（Workers/V8 现代浏览器均支持 u 标志）
export const USERNAME_RE = /^[\p{Script=Han}A-Za-z0-9_]{3,20}$/u;
const PASSWORD_MIN = 8, PASSWORD_MAX = 128;

// 游客数据绑定状态按当前登录账号隔离，避免学校/公共电脑等共享设备上数据串号。
function getGuestBoundKey() { return 'tcm_guest_bound_' + (authState.username || 'guest'); }

/* ---------- 页面加载时检查登录态（只验证签名 Cookie，不查数据库） ---------- */
export async function initAuth() {
    try {
        const resp = await fetch('/api/auth/me');
        const data = await resp.json();
        authState.loggedIn = !!data.loggedIn;
        authState.username = data.username || null;
        authState.sessionExpired = false;
    } catch (e) {
        // 网络异常：无法确认登录态。按未登录处理但不弹任何提示，
        // 用户继续学习时数据照常进 localStorage，登录后靠 pending sync 补同步。
        authState.loggedIn = false;
    }
    renderAuthEntry();
}

/* ---------- Session 过期处理：明确提示，不静默降级 ---------- */
function handleAuthExpired() {
    if (authState.expiredShown) return;
    authState.expiredShown = true;
    authState.sessionExpired = true;
    authState.loggedIn = false;
    authState.username = null;
    renderAuthEntry();
    markPendingSync(); // 之后本地产生的/未确认的记录都会在重新登录后补同步
    ensureModalsInDom();
    document.getElementById('authExpiredModal').style.display = 'flex';
}

/* ---------- 按钮加载态：防止登录/注册/恢复过程中重复点击 ---------- */
function setBtnLoading(btn, loadingText) {
    if (!btn || btn.disabled) return null;
    btn.dataset.origText = btn.textContent;
    btn.textContent = loadingText;
    btn.disabled = true;
    return () => { btn.textContent = btn.dataset.origText; btn.disabled = false; };
}

function renderAuthEntry() {
    const el = document.getElementById('authEntry');
    if (!el) return; // 具体入口按钮由你自己放在页面哪里，没放的话这里跳过不报错
    el.textContent = authState.loggedIn ? `👤 ${authState.username}` : '登录 / 注册';
}

/* ===================== 弹窗 HTML（自动插入，不需要手动改 index.html） ===================== */
function ensureModalsInDom() {
    if (document.getElementById('authRegisterModal')) return;
    document.body.insertAdjacentHTML('beforeend', `
<div class="modal-overlay" id="authRegisterModal" style="display:none;">
  <div class="modal">
    <button class="modal-close" onclick="closeAuthModal('authRegisterModal')">✕</button>
    <h3>📝 注册账号</h3>
    <p style="color:var(--text-muted);font-size:0.9em;">用户名注册后不可修改，且不支持邮箱/手机找回密码，请务必牢记密码，并在注册成功后妥善保存系统生成的恢复码。</p>
    <div class="auth-form">
      <input type="text" id="regUsername" placeholder="用户名（3-20位）" maxlength="20" autocomplete="username">
      <div class="auth-hint">支持中文、英文、数字和下划线，注册后不可修改</div>
      <input type="password" id="regPassword" placeholder="密码（8-128位）" maxlength="128" autocomplete="new-password">
      <input type="password" id="regPasswordConfirm" placeholder="再次输入密码" maxlength="128" autocomplete="new-password">
      <div id="regError" class="auth-error"></div>
      <button class="btn btn--primary" onclick="submitRegister()">注册</button>
      <p style="font-size:0.9em;">已有账号？<a href="#" onclick="switchAuthModal('authRegisterModal','authLoginModal');return false;">去登录</a></p>
    </div>
  </div>
</div>

<div class="modal-overlay" id="authLoginModal" style="display:none;">
  <div class="modal">
    <button class="modal-close" onclick="closeAuthModal('authLoginModal')">✕</button>
    <h3>🔑 登录</h3>
    <div class="auth-form">
      <input type="text" id="loginUsername" placeholder="用户名" autocomplete="username">
      <input type="password" id="loginPassword" placeholder="密码" autocomplete="current-password">
      <div id="loginError" class="auth-error"></div>
      <button class="btn btn--primary" onclick="submitLogin()">登录</button>
      <p style="font-size:0.9em;">
        <a href="#" onclick="switchAuthModal('authLoginModal','authRegisterModal');return false;">还没有账号</a>
        ・
        <a href="#" onclick="switchAuthModal('authLoginModal','authRecoverModal');return false;">忘记密码</a>
      </p>
    </div>
  </div>
</div>

<div class="modal-overlay" id="authRecoverModal" style="display:none;">
  <div class="modal">
    <button class="modal-close" onclick="closeAuthModal('authRecoverModal')">✕</button>
    <h3>🔓 用恢复码找回密码</h3>
    <p style="color:var(--text-muted);font-size:0.9em;">没有恢复码将无法找回，只能放弃该账号重新注册。</p>
    <div class="auth-form">
      <input type="text" id="recUsername" placeholder="用户名" autocomplete="username">
      <input type="text" id="recCode" placeholder="恢复码（形如 A7K9F-3MXQP-...）" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false">
      <input type="password" id="recNewPassword" placeholder="新密码（8-128位）" maxlength="128" autocomplete="new-password">
      <input type="password" id="recNewPasswordConfirm" placeholder="再次输入新密码" maxlength="128" autocomplete="new-password">
      <div id="recError" class="auth-error"></div>
      <button class="btn btn--primary" onclick="submitRecover()">重置密码</button>
    </div>
  </div>
</div>

<div class="modal-overlay" id="authRecoveryCodeModal" style="display:none;">
  <div class="modal">
    <h3>🗝️ 请立刻保存这个恢复码</h3>
    <p style="color:#c0392b;font-weight:bold;">恢复码用于忘记密码时重置密码。恢复码只显示一次，请务必妥善保存。如果密码和恢复码均遗失，网站无法为你找回账号。</p>
    <div id="recoveryCodeDisplay" style="font-size:1.3em;letter-spacing:1px;text-align:center;padding:14px;background:var(--bg-light,#f5f0e6);border-radius:8px;margin:10px 0;user-select:all;"></div>
    <p style="color:var(--text-muted);font-size:0.9em;">建议截图或抄写在纸上，不要只存在这台设备里——如果这台设备本身丢了或数据被清除，恢复码也会一起丢。</p>
    <label style="display:flex;align-items:center;gap:6px;margin-top:8px;">
      <input type="checkbox" id="recoveryCodeConfirmCheck"> 我已经保存好这个恢复码
    </label>
    <button class="btn btn--primary" id="recoveryCodeCloseBtn" style="margin-top:10px;width:100%;" disabled onclick="closeRecoveryCodeModal()">关闭</button>
  </div>
</div>

<div class="modal-overlay" id="authGuestReminderModal" style="display:none;">
  <div class="modal">
    <button class="modal-close" onclick="closeAuthModal('authGuestReminderModal')">✕</button>
    <h3>💡 要不要注册一个账号？</h3>
    <p>你已经以游客身份完成了几道病例——游客数据只存在这台设备的浏览器里，换设备、换浏览器或清除浏览器数据都会丢失。注册账号后，学习记录会同步保存到云端，可在其他设备登录后继续使用。请妥善保存密码和恢复码；目前没有手机号或邮箱找回密码功能。</p>
    <button class="btn btn--primary" style="width:100%;margin-top:6px;" onclick="closeAuthModal('authGuestReminderModal');openAuthEntry('register')">立即注册</button>
    <button class="btn btn--outline" style="width:100%;margin-top:8px;" onclick="closeAuthModal('authGuestReminderModal')">暂不需要</button>
  </div>
</div>

<div class="modal-overlay" id="authExpiredModal" style="display:none;">
  <div class="modal">
    <h3>⏰ 登录状态已过期</h3>
    <p>你的登录状态已过期。<b>学习记录仍会暂时保存在本设备，重新登录后会自动同步</b>，不会丢失。你也可以继续以游客方式浏览和学习。</p>
    <button class="btn btn--primary" style="width:100%;margin-top:8px;" onclick="closeAuthModal('authExpiredModal');openAuthEntry('login')">重新登录</button>
    <button class="btn btn--outline" style="width:100%;margin-top:8px;" onclick="closeAuthModal('authExpiredModal')">继续学习</button>
  </div>
</div>

<div class="modal-overlay" id="authSyncStatusModal" style="display:none;">
  <div class="modal" style="max-width:360px;text-align:center;">
    <h3>🔄 学习记录同步</h3>
    <p id="authSyncStatusText" style="font-size:1.02em;line-height:1.8;">正在同步学习记录…</p>
  </div>
</div>`);
}

/* ===================== 对外入口 ===================== */
window.openAuthEntry = function (which) {
    ensureModalsInDom();
    if (authState.loggedIn) { alert(`当前已登录：${authState.username}`); return; }
    const id = which === 'login' ? 'authLoginModal' : 'authRegisterModal';
    document.getElementById(id).style.display = 'flex';
};
window.closeAuthModal = function (id) { document.getElementById(id).style.display = 'none'; };
window.switchAuthModal = function (fromId, toId) {
    document.getElementById(fromId).style.display = 'none';
    document.getElementById(toId).style.display = 'flex';
};
window.closeRecoveryCodeModal = function () {
    document.getElementById('authRecoveryCodeModal').style.display = 'none';
    // 注册成功后：用户已确认保存恢复码 → 执行同步收尾 → 刷新页面进入已登录状态
    afterAuthSync();
};

document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'recoveryCodeConfirmCheck') {
        document.getElementById('recoveryCodeCloseBtn').disabled = !e.target.checked;
    }
});

function showRecoveryCode(code) {
    document.getElementById('recoveryCodeDisplay').textContent = code;
    document.getElementById('recoveryCodeConfirmCheck').checked = false;
    document.getElementById('recoveryCodeCloseBtn').disabled = true;
    document.getElementById('authRecoveryCodeModal').style.display = 'flex';
}

/* ===================== 注册 ===================== */
window.submitRegister = async function () {
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    const passwordConfirm = document.getElementById('regPasswordConfirm').value;
    const errEl = document.getElementById('regError');
    const btn = document.querySelector('#authRegisterModal .btn--primary');
    errEl.textContent = '';
    if (!USERNAME_RE.test(username)) { errEl.textContent = '用户名需为3-20位中文、英文、数字或下划线'; return; }
    if (password !== passwordConfirm) { errEl.textContent = '两次输入的密码不一致'; return; }
    if (password.length < PASSWORD_MIN) { errEl.textContent = '密码至少需要8位'; return; }
    if (password.length > PASSWORD_MAX) { errEl.textContent = '密码长度不能超过128位'; return; }

    const restoreBtn = setBtnLoading(btn, '注册中…'); // 请求期间按钮禁用并显示"注册中…"，防止重复提交
    try {
        const resp = await fetch('/api/auth/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, passwordConfirm })
        });
        const data = await resp.json();
        if (!resp.ok) { errEl.textContent = data.error || '注册失败'; restoreBtn && restoreBtn(); return; }

        authState.loggedIn = true; authState.username = data.username;
        authState.sessionExpired = false; authState.expiredShown = false;
        renderAuthEntry();
        closeAuthModal('authRegisterModal');
        showRecoveryCode(data.recoveryCode);
        // 同步与刷新推迟到用户确认保存恢复码之后（closeRecoveryCodeModal → afterAuthSync），
        // 恢复码必须先让用户看到，绝不能在显示前刷新页面。
    } catch (e) {
        errEl.textContent = '网络异常，请稍后重试';
        restoreBtn && restoreBtn();
    }
};

/* ===================== 登录 ===================== */
window.submitLogin = async function () {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    const btn = document.querySelector('#authLoginModal .btn--primary');
    errEl.textContent = '';

    const restoreBtn = setBtnLoading(btn, '登录中…');
    try {
        const resp = await fetch('/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await resp.json();
        if (!resp.ok) { errEl.textContent = data.error || '登录失败'; restoreBtn && restoreBtn(); return; }

        authState.loggedIn = true; authState.username = data.username;
        authState.sessionExpired = false; authState.expiredShown = false;
        renderAuthEntry();
        closeAuthModal('authLoginModal');
        await afterAuthSync(); // 待同步数据上传 → 拉取云端 → 刷新页面
    } catch (e) {
        // 网络异常 ≠ 登录失败/Session 过期：不清登录态、不弹过期提示，只提示重试。
        errEl.textContent = '网络异常，请稍后重试';
        restoreBtn && restoreBtn();
    }
};

/* ===================== 登录/注册成功后的统一收尾 ===================== */
// 顺序（严格保证，任何一步失败都不删本地数据）：
//   本地待同步数据 → 上传 D1 → 成功后清 pending 标记 → 重新读取 D1 → 刷新页面
let afterAuthSyncRunning = false;
async function afterAuthSync() {
    if (afterAuthSyncRunning) return;
    afterAuthSyncRunning = true;
    ensureModalsInDom();
    const modal = document.getElementById('authSyncStatusModal');
    const msgEl = document.getElementById('authSyncStatusText');
    const show = (text, color) => {
        msgEl.textContent = text;
        msgEl.style.color = color || 'var(--text-light)';
        modal.style.display = 'flex';
    };
    try {
        const boundKey = getGuestBoundKey();
        const needSync = hasPendingSync() || !safeGetStorage(boundKey, false);
        if (needSync) {
            show('正在同步学习记录…');
            const st = await maybeSyncGuestData(); // 处理首次游客绑定（含公共电脑防串号判断）
            if (st !== 'other' && hasPendingSync()) {
                // pending 数据属于当前账号（绑定路径已排除他人数据），此时才允许上传
                const ok = await uploadLocalItems();
                if (ok) {
                    clearPendingSync();
                    show('学习记录同步完成', '#2d6a4f');
                    await refreshProgressFromCloud();
                } else {
                    show('同步失败，学习记录已保存在本设备。请检查网络后重试。', '#c0392b');
                    setTimeout(() => location.reload(), 1800); // pending 保留，下次登录/恢复网络后再同步
                    return;
                }
            } else {
                const r = await refreshProgressFromCloud();
                if (r && r.status === 401) { handleAuthExpired(); return; } // 提示过期，不自动刷新打断用户
            }
        } else {
            const r = await refreshProgressFromCloud();
            if (r && r.status === 401) { handleAuthExpired(); return; }
        }
        setTimeout(() => location.reload(), 800); // 刷新后由 initAuth() 重新读取 Session，页面整体进入已登录状态
    } catch (e) {
        // 收尾过程任何异常都不影响本地数据，直接刷新进入登录态
        setTimeout(() => location.reload(), 800);
    } finally {
        afterAuthSyncRunning = false;
    }
}

/* ===================== 恢复码找回密码 ===================== */
window.submitRecover = async function () {
    const username = document.getElementById('recUsername').value.trim();
    const recoveryCode = document.getElementById('recCode').value.trim();
    const newPassword = document.getElementById('recNewPassword').value;
    const newPasswordConfirm = document.getElementById('recNewPasswordConfirm').value;
    const errEl = document.getElementById('recError');
    const btn = document.querySelector('#authRecoverModal .btn--primary');
    errEl.textContent = '';

    if (newPassword !== newPasswordConfirm) { errEl.textContent = '两次输入的新密码不一致'; return; }
    if (newPassword.length < PASSWORD_MIN) { errEl.textContent = '密码至少需要8位'; return; }
    if (newPassword.length > PASSWORD_MAX) { errEl.textContent = '密码长度不能超过128位'; return; }

    const restoreBtn = setBtnLoading(btn, '重置中…');
    try {
        const resp = await fetch('/api/auth/recover', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, recoveryCode, newPassword, newPasswordConfirm })
        });
        const data = await resp.json();
        if (!resp.ok) { errEl.textContent = data.error || '重置失败'; restoreBtn && restoreBtn(); return; }

        closeAuthModal('authRecoverModal');
        showRecoveryCode(data.newRecoveryCode); // 旧恢复码已作废，这是新的一次性恢复码
        alert('密码已重置，请用新密码重新登录。');
    } catch (e) {
        errEl.textContent = '网络异常，请稍后重试';
        restoreBtn && restoreBtn();
    }
};

window.logout = async function () {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) { /* 忽略网络错误，反正客户端状态照样清 */ }
    authState.loggedIn = false; authState.username = null;
    authState.sessionExpired = false; authState.expiredShown = false;
    renderAuthEntry();
    location.reload(); // 简单起见直接刷新，避免页面上残留"已登录"状态的界面碎片
};

/* ===================== 本地记录 → D1 的统一同步函数 ===================== */
// 把 localStorage 里的全部学习记录整理成 sync-guest 接口需要的批量格式。
// 只读不写：调用方在上传成功前绝不能清本地数据。
function buildSyncItems() {
    const completed = getCompletedCases();
    const wrongs = getWrongCases();
    const wrongMap = new Map(wrongs.map(w => [w.id, w]));
    const items = completed.map(caseId => {
        const w = wrongMap.get(caseId);
        return { caseId, isCompleted: true, isWrong: !!w, syndrome: w?.syndrome, disease: w?.disease, basis: w?.basis };
    });
    // 有些错题可能尚未点"显示答案"（不在 completed 里，但已经在 wrongs 里），也一并带上。
    for (const w of wrongs) {
        if (!completed.includes(w.id)) {
            items.push({ caseId: w.id, isCompleted: false, isWrong: true, syndrome: w.syndrome, disease: w.disease, basis: w.basis });
        }
    }
    return items;
}

// 批量上传本地记录到 sync-guest。返回 true=成功；401/网络异常/其他错误一律返回 false 且不碰本地数据。
async function uploadLocalItems() {
    const items = buildSyncItems();
    if (items.length === 0) return true;
    try {
        const resp = await fetch('/api/progress/sync-guest', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items })
        });
        if (resp.status === 401) { handleAuthExpired(); return false; } // Session 过期：明确提示而不是静默丢弃
        return resp.ok;
    } catch (e) {
        return false; // 网络异常：本地数据原样保留，标记 pending 后下次再试
    }
}

/* ===================== 游客数据 → 账号 绑定同步 ===================== */
// 返回值：'bound'=该账号已绑定过本机游客数据；'synced'=本次完成绑定上传；
//         'other'=本机游客数据属于之前其他账号（公共电脑防串号，跳过）；'failed'=上传失败。
// 注意区分两个概念：
//   tcm_guest_bound_用户名 = 这台设备的游客数据是否已完成过该账号的绑定（防串号）
//   tcm_pending_sync       = 当前浏览器是否还有数据尚未确认写入云端（补同步）
// 两者独立：guest_bound 为 true 不代表"之后本地产生的数据都已同步"——后者由 pending sync 负责。
async function maybeSyncGuestData() {
    const boundKey = getGuestBoundKey();
    if (safeGetStorage(boundKey, false)) return 'bound';

    const completed = getCompletedCases();
    const wrongs = getWrongCases();
    if (completed.length === 0 && wrongs.length === 0) {
        safeSetStorage(boundKey, true); // 没数据也标记一下，避免每次登录都重复判断
        return 'synced';
    }

    // 公共电脑：本机游客数据已经被之前的账号绑定上传过，就不能再传给新登录的账号。
    // pending sync 标记不动——那些数据下次由原账号登录时补同步。
    if (safeGetStorage(GUEST_CLAIMED_KEY, false)) {
        safeSetStorage(boundKey, true); // 标记"已处理过"，避免这台设备上每次登录都重复弹提示
        alert('本机存在属于之前使用账号的游客学习记录，为避免不同账号之间数据串号，这些记录不会同步到当前账号。');
        return 'other';
    }

    const items = buildSyncItems();
    const ok = await uploadLocalItems();
    if (ok) {
        safeSetStorage(boundKey, true);
        safeSetStorage(GUEST_CLAIMED_KEY, true);
        clearPendingSync(); // 游客数据已确认进入 D1
        alert(`已将本机 ${items.length} 条游客学习记录同步到你的账号。\n提醒：如果你之前在其他设备上也玩过游客模式，那部分记录不会自动带过来，只有这台设备上的记录会被同步。`);
        return 'synced';
    }
    return 'failed'; // 上传失败：什么都不标记，下次登录/恢复网络后再试
}

/* ===================== 供 app.js 调用：登录用户把本地进度批量同步到 D1 ===================== */
// 备份导入后调用。失败时标记 pending sync，绝不清本地数据。
export async function syncLocalProgressToCloud() {
    if (!authState.loggedIn) return;
    const ok = await uploadLocalItems();
    if (ok) {
        clearPendingSync();
        await refreshProgressFromCloud();
    } else {
        markPendingSync();
    }
}

/* ===================== 供 game.js 调用：写一行进度到 D1（仅登录用户） ===================== */
// 严格只在"提交答案"和"查看解析"这两个真正定局的时刻调用，探查四诊等中间过程不要调用这个函数。
export async function syncProgressToServer(caseId, payload) {
    if (!authState.loggedIn) {
        // Session 已过期被登出但用户仍在学习：本地照常保存，标记待同步，重新登录后自动补进 D1。
        if (authState.sessionExpired) markPendingSync();
        return; // 正常游客模式不产生任何 D1 写入
    }
    try {
        const resp = await fetch('/api/progress', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caseId, ...payload })
        });
        if (resp.status === 401) {
            handleAuthExpired(); // 明确告知"登录状态已过期"，本地数据不删、标记 pending
        } else if (!resp.ok) {
            markPendingSync(); // 服务端偶发错误：标记待同步
        }
    } catch (e) {
        // 网络异常 ≠ Session 过期：不弹过期提示、不清登录态，只标记待同步。
        markPendingSync();
    }
}

/* ===================== 供 game.js 调用：完成三道题后提醒注册（仅游客） ===================== */
export function maybeShowRegisterReminder() {
    if (authState.loggedIn) return;
    const count = getCompletedCases().length;
    if (count < 3) return;
    const lastShownAt = safeGetStorage(REGISTER_PROMPT_LAST_COUNT_KEY, 0);
    // 完成数达到3之后，每再多完成5道题重新提醒一次（3、8、13...），避免第一次被关掉后就再也不提醒，
    // 也避免每做一题就弹一次太烦人。这个间隔按需自己调整。
    if (lastShownAt !== 0 && count - lastShownAt < 5) return;
    ensureModalsInDom();
    document.getElementById('authGuestReminderModal').style.display = 'flex';
    safeSetStorage(REGISTER_PROMPT_LAST_COUNT_KEY, count);
}

ensureModalsInDom();
initAuth();
