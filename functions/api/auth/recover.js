/* POST /api/auth/recover  { username, recoveryCode, newPassword, newPasswordConfirm }
   用恢复码重置密码；成功后会作废旧恢复码、发一个新的恢复码给用户（同样只显示这一次）。
   这样即使恢复码曾经泄露，用过一次之后旧码也不再有效。 */
import { hashPassword, verifyPassword, generateRecoveryCode, normalizeRecoveryCode } from '../../_lib/crypto.js';
import { isRateLimited, recordHit, clientIp } from '../../_lib/ratelimit.js';

// 恢复码本质是账号恢复凭据：同一 IP 连续失败 5 次锁定 10 分钟，钝化恢复码枚举。
const RL_MAX = 5, RL_WINDOW_MS = 10 * 60 * 1000;

export async function onRequestPost({ request, env }) {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: '请求格式有误' }, 400); }
    const username = (body.username || '').trim();
    const recoveryCodeInput = normalizeRecoveryCode(body.recoveryCode || '');
    const newPassword = body.newPassword || '';
    const newPasswordConfirm = body.newPasswordConfirm || '';

    const rlKey = 'recover:' + clientIp(request);
    if (isRateLimited(rlKey, RL_MAX, RL_WINDOW_MS)) {
        return json({ error: '尝试次数过多，请稍后再试。' }, 429);
    }

    if (!username || !recoveryCodeInput) { recordHit(rlKey, RL_WINDOW_MS); return json({ error: '请填写用户名和恢复码' }, 400); }
    if (newPassword.length < 8) return json({ error: '密码至少需要8位' }, 400);
    if (newPassword.length > 128) return json({ error: '密码长度不能超过128位' }, 400);
    if (newPassword !== newPasswordConfirm) return json({ error: '两次输入的新密码不一致' }, 400);

    const row = await env.DB.prepare(
        'SELECT id, recovery_code_hash, recovery_code_salt FROM users WHERE username = ?'
    ).bind(username).first();

    // 同样地，用户名不存在和恢复码错误给同一句提示，不透露具体是哪个错。
    if (!row) { recordHit(rlKey, RL_WINDOW_MS); return json({ error: '用户名或恢复码不正确' }, 401); }
    const codeOk = await verifyPassword(recoveryCodeInput, row.recovery_code_hash, row.recovery_code_salt);
    if (!codeOk) { recordHit(rlKey, RL_WINDOW_MS); return json({ error: '用户名或恢复码不正确' }, 401); }

    const { hash: passwordHash, salt: passwordSalt } = await hashPassword(newPassword);
    const rawNewCode = generateRecoveryCode();
    const { hash: newCodeHash, salt: newCodeSalt } = await hashPassword(normalizeRecoveryCode(rawNewCode));

    await env.DB.prepare(
        `UPDATE users SET password_hash = ?, password_salt = ?, recovery_code_hash = ?, recovery_code_salt = ? WHERE id = ?`
    ).bind(passwordHash, passwordSalt, newCodeHash, newCodeSalt, row.id).run();

    return json({ ok: true, newRecoveryCode: rawNewCode }, 200);
}

function json(obj, status) {
    return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
