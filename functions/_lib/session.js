/* ===================== 登录态：无状态签名 Cookie（不占用 D1 读写配额） ===================== */
// 会话信息直接编码进 Cookie 并用 HMAC 签名，服务端验证签名即可，不需要为每次请求查一次"会话表"。
// 代价：退出登录只能清除客户端 Cookie，无法在到期前强制吊销已签发的旧 Cookie——
// 对这种没有支付/隐私强诉求的学习工具是可以接受的取舍，但要知道这个限制。
//
// 部署前必须设置一个密钥（否则任何人都能伪造登录态）：
//   npx wrangler pages secret put SESSION_SECRET
// 随便生成一串足够长的随机字符串作为密钥即可，例如：
//   node -e "console.log(crypto.randomBytes(32).toString('hex'))"

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 3600; // 30 天

function b64urlEncode(bytes) {
    let binary = ''; for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function hmacKey(secret) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function createSessionCookie(payloadObj, secret) {
    const payload = { ...payloadObj, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS };
    const payloadB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
    const key = await hmacKey(secret);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
    const sigB64 = b64urlEncode(new Uint8Array(sig));
    const token = `${payloadB64}.${sigB64}`;
    return `tcm_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function clearSessionCookie() {
    return 'tcm_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
}

// 从 Request 里取出并校验会话；无效/过期/未登录一律返回 null，调用方按"未登录"处理。
export async function readSession(request, secret) {
    const cookieHeader = request.headers.get('Cookie') || '';
    const match = cookieHeader.match(/(?:^|;\s*)tcm_session=([^;]+)/);
    if (!match) return null;
    const [payloadB64, sigB64] = match[1].split('.');
    if (!payloadB64 || !sigB64) return null;
    try {
        const key = await hmacKey(secret);
        const valid = await crypto.subtle.verify('HMAC', key, b64urlDecode(sigB64), new TextEncoder().encode(payloadB64));
        if (!valid) return null;
        const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
        if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
        return payload; // { uid, username, exp }
    } catch (e) { return null; }
}
