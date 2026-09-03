/* POST /api/auth/login  { username, password } */
import { verifyPassword } from '../../_lib/crypto.js';
import { createSessionCookie } from '../../_lib/session.js';
import { isRateLimited, recordHit, resetKey, clientIp } from '../../_lib/ratelimit.js';

// 同一 IP 连续失败 5 次后锁定 10 分钟；只在失败时计数，成功登录立即清零，不影响正常用户。
const RL_MAX = 5, RL_WINDOW_MS = 10 * 60 * 1000;

export async function onRequestPost({ request, env }) {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: '请求格式有误' }, 400); }
    const username = (body.username || '').trim();
    const password = body.password || '';
    if (!username || !password) return json({ error: '请输入用户名和密码' }, 400);

    const rlKey = 'login:' + clientIp(request);
    if (isRateLimited(rlKey, RL_MAX, RL_WINDOW_MS)) {
        return json({ error: '尝试次数过多，请稍后再试。' }, 429);
    }

    const row = await env.DB.prepare(
        'SELECT id, username, password_hash, password_salt FROM users WHERE username = ?'
    ).bind(username).first();

    // 用户名不存在和密码错误返回同一句提示，避免让人借此探测哪些用户名已被注册。
    if (!row) { recordHit(rlKey, RL_WINDOW_MS); return json({ error: '用户名或密码错误' }, 401); }

    const ok = await verifyPassword(password, row.password_hash, row.password_salt);
    if (!ok) { recordHit(rlKey, RL_WINDOW_MS); return json({ error: '用户名或密码错误' }, 401); }

    resetKey(rlKey); // 登录成功，清掉该 IP 的失败计数

    const cookie = await createSessionCookie({ uid: row.id, username: row.username }, env.SESSION_SECRET);
    return new Response(JSON.stringify({ ok: true, username: row.username }), {
        status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie }
    });
}

function json(obj, status) {
    return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
