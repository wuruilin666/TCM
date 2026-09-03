/* GET  /api/progress          —— 返回当前用户全部进度行（用于"我的错题"/统计渲染）
   POST /api/progress          —— upsert 一行；只应在"提交答案"或"查看解析"这两个真正定局的时刻调用，
                                    不要在探查四诊等中间过程调用，否则会不必要地消耗 D1 每日写入配额。
   body: { caseId, isCompleted?, isWrong?, syndrome?, disease?, basis? }
   —— 只传本次要更新的字段，未传的字段在 upsert 时保留原值（COALESCE）。 */
import { readSession } from '../../_lib/session.js';

const SAFE_CASE_ID = /^[a-z]+-\d{3}$/; // 与前端 data.js 的 isSafeCaseId 保持一致

export async function onRequestGet({ request, env }) {
    const session = await readSession(request, env.SESSION_SECRET);
    if (!session) return json({ error: '未登录' }, 401);

    const { results } = await env.DB.prepare(
        `SELECT case_id, is_completed, is_wrong, submitted_syndrome, submitted_disease, submitted_basis, updated_at
         FROM user_progress WHERE user_id = ?`
    ).bind(session.uid).all();

    return json({ progress: results || [] }, 200);
}

export async function onRequestPost({ request, env }) {
    const session = await readSession(request, env.SESSION_SECRET);
    if (!session) return json({ error: '未登录' }, 401);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: '请求格式有误' }, 400); }
    const caseId = body.caseId;
    if (!SAFE_CASE_ID.test(caseId || '')) return json({ error: '病例ID不合法' }, 400);

    const isCompleted = body.isCompleted === undefined ? null : (body.isCompleted ? 1 : 0);
    const isWrong = body.isWrong === undefined ? null : (body.isWrong ? 1 : 0);
    const syndrome = typeof body.syndrome === 'string' ? body.syndrome.slice(0, 200) : null;
    const disease = typeof body.disease === 'string' ? body.disease.slice(0, 200) : null;
    const basis = typeof body.basis === 'string' ? body.basis.slice(0, 1000) : null;

    // 注意：INSERT VALUES 里的 COALESCE(?,0) 只是为了"新建一行时给个默认值"，
    // 不能直接在 UPDATE 分支里复用 excluded.xxx——因为 excluded 里已经被上面那层 COALESCE 填成了 0，
    // 会导致"这次调用没传 isCompleted"被误判成"把 isCompleted 显式改成 0"，反而覆盖掉之前的完成状态。
    // 所以 UPDATE 分支单独再绑定一遍"原始值"（可能是 null）来做 COALESCE 判断。
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(`
        INSERT INTO user_progress (user_id, case_id, is_completed, is_wrong, submitted_syndrome, submitted_disease, submitted_basis, updated_at)
        VALUES (?, ?, COALESCE(?, 0), COALESCE(?, 0), ?, ?, ?, ?)
        ON CONFLICT(user_id, case_id) DO UPDATE SET
            is_completed       = COALESCE(?, user_progress.is_completed),
            is_wrong           = COALESCE(?, user_progress.is_wrong),
            submitted_syndrome = COALESCE(?, user_progress.submitted_syndrome),
            submitted_disease  = COALESCE(?, user_progress.submitted_disease),
            submitted_basis    = COALESCE(?, user_progress.submitted_basis),
            updated_at         = ?
    `).bind(
        session.uid, caseId, isCompleted, isWrong, syndrome, disease, basis, now,
        isCompleted, isWrong, syndrome, disease, basis, now
    ).run();

    return json({ ok: true }, 200);
}

function json(obj, status) {
    return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
