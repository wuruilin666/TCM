/* POST /api/progress/sync-guest
   body: { items: [{ caseId, isCompleted, isWrong, syndrome, disease, basis }, ...] }
   由前端在"注册成功"或"登录成功后检测到本机有未绑定的游客数据"时调用一次，
   把 localStorage 里的游客记录批量写入当前登录用户名下。
   只有已登录（能验证出 uid）才允许写，防止匿名接口被滥用刷库。 */
import { readSession } from '../../_lib/session.js';

const SAFE_CASE_ID = /^[a-z]+-\d{3}$/;
const MAX_ITEMS = 200; // 正常情况下题库不会有这么多题，做个防御性上限，避免异常请求把配额打爆

export async function onRequestPost({ request, env }) {
    const session = await readSession(request, env.SESSION_SECRET);
    if (!session) return json({ error: '未登录' }, 401);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: '请求格式有误' }, 400); }
    const items = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
    if (items.length === 0) return json({ ok: true, synced: 0 }, 200);

    const now = Math.floor(Date.now() / 1000);
    const stmts = [];
    for (const it of items) {
        if (!SAFE_CASE_ID.test(it.caseId || '')) continue;
        stmts.push(env.DB.prepare(`
            INSERT INTO user_progress (user_id, case_id, is_completed, is_wrong, submitted_syndrome, submitted_disease, submitted_basis, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, case_id) DO UPDATE SET
                is_completed       = MAX(user_progress.is_completed, excluded.is_completed),
                is_wrong           = excluded.is_wrong,
                submitted_syndrome = COALESCE(excluded.submitted_syndrome, user_progress.submitted_syndrome),
                submitted_disease  = COALESCE(excluded.submitted_disease, user_progress.submitted_disease),
                submitted_basis    = COALESCE(excluded.submitted_basis, user_progress.submitted_basis),
                updated_at         = excluded.updated_at
        `).bind(
            session.uid, it.caseId, it.isCompleted ? 1 : 0, it.isWrong ? 1 : 0,
            (it.syndrome || '').slice(0, 200), (it.disease || '').slice(0, 200), (it.basis || '').slice(0, 1000), now
        ));
    }
    if (stmts.length === 0) return json({ ok: true, synced: 0 }, 200);

    await env.DB.batch(stmts); // batch：一次网络往返写完所有行，同时也算作一次事务
    return json({ ok: true, synced: stmts.length }, 200);
}

function json(obj, status) {
    return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
