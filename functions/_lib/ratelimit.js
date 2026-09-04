/* ===================== 基础限流（进程内存版，不占 D1 配额、不用付费服务） =====================
   ponytail: Map 存活于单个 Workers isolate 内——按实例生效、实例回收/多实例部署后各自独立计数，
   防不了分布式精确限流，但足以钝化单 IP 的密码爆破/恢复码枚举。真遇到攻击量级再升级到
   D1 计数表或 DO；现在不值得为它建表。 */
const buckets = new Map(); // key -> { start, count }

function getBucket(key, windowMs) {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now - b.start > windowMs) {
        b = { start: now, count: 0 };
        buckets.set(key, b);
        if (buckets.size > 10000) {
            for (const [k, v] of buckets) { if (now - v.start > windowMs) buckets.delete(k); }
        }
    }
    return b;
}

// 是否已被限流（不消耗次数，只判断）
export function isRateLimited(key, max, windowMs) {
    return getBucket(key, windowMs).count >= max;
}

// 记一次失败尝试
export function recordHit(key, windowMs) {
    getBucket(key, windowMs).count++;
}

// 成功后清除该 key 的失败计数（一次正确登录不应影响该 IP 的其他正常使用）
export function resetKey(key) {
    buckets.delete(key);
}

// Cloudflare 会注入真实客户端 IP
export function clientIp(request) {
    return request.headers.get('CF-Connecting-IP') || 'unknown';
}
