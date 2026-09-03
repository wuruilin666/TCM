/* GET /api/auth/me —— 只验证 Cookie 签名，不查数据库，不占用 D1 读配额 */
import { readSession } from '../../_lib/session.js';

export async function onRequestGet({ request, env }) {
    const session = await readSession(request, env.SESSION_SECRET);
    return new Response(JSON.stringify({ loggedIn: !!session, username: session ? session.username : null }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
    });
}
