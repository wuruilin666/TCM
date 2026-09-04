/* POST /api/auth/register  { username, password, passwordConfirm } */
import { hashPassword, generateRecoveryCode, normalizeRecoveryCode } from '../../_lib/crypto.js';
import { createSessionCookie } from '../../_lib/session.js';

// 与 js/auth.js 里的 USERNAME_RE 完全一致：3-20位，中文（Unicode属性匹配）、英文、数字、下划线
const USERNAME_RE = /^[\p{Script=Han}A-Za-z0-9_]{3,20}$/u;

export async function onRequestPost({ request, env }) {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: '请求格式有误' }, 400); }
    const username = (body.username || '').trim();
    const password = body.password || '';
    const passwordConfirm = body.passwordConfirm || '';

    if (!USERNAME_RE.test(username)) {
        return json({ error: '用户名需为3-20位中文、英文、数字或下划线，且注册后不可修改，请想清楚再提交' }, 400);
    }
    if (password.length < 8) {
        return json({ error: '密码至少需要8位' }, 400);
    }
    if (password.length > 128) {
        return json({ error: '密码长度不能超过128位' }, 400);
    }
    // 前端已经做过两次输入一致性校验，这里再校验一遍，防止绕过前端直接调接口。
    if (password !== passwordConfirm) {
        return json({ error: '两次输入的密码不一致' }, 400);
    }

    const { hash: passwordHash, salt: passwordSalt } = await hashPassword(password);
    const rawRecoveryCode = generateRecoveryCode();               // 展示给用户的、带"-"分隔的版本
    const normalizedCode = normalizeRecoveryCode(rawRecoveryCode); // 去掉"-"后用于哈希的版本
    const { hash: recoveryHash, salt: recoverySalt } = await hashPassword(normalizedCode);

    try {
        // 用户名唯一性完全依赖 UNIQUE 约束在这里插入失败来最终裁决，不做"先查是否存在"。
        const result = await env.DB.prepare(
            `INSERT INTO users (username, password_hash, password_salt, recovery_code_hash, recovery_code_salt, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(username, passwordHash, passwordSalt, recoveryHash, recoverySalt, Math.floor(Date.now() / 1000)).run();

        const userId = result.meta.last_row_id;
        const cookie = await createSessionCookie({ uid: userId, username }, env.SESSION_SECRET);

        return new Response(JSON.stringify({
            ok: true,
            username,
            recoveryCode: rawRecoveryCode // 只有这一次会返回明文恢复码，前端必须提示用户立刻保存
        }), { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie } });

    } catch (e) {
        if (String(e.message || '').includes('UNIQUE constraint failed')) {
            return json({ error: '该用户名已被占用，换一个试试' }, 409);
        }
        console.error('注册失败:', e);
        return json({ error: '注册失败，请稍后重试' }, 500);
    }
}

function json(obj, status) {
    return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
