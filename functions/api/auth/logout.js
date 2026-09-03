/* POST /api/auth/logout —— 仅清除客户端 Cookie（见 session.js 顶部关于"无法强制吊销"的说明） */
import { clearSessionCookie } from '../../_lib/session.js';

export async function onRequestPost() {
    return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearSessionCookie() }
    });
}
