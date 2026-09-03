/* ===================== 加密工具（纯 Web Crypto API，Cloudflare Pages Functions 原生支持，无需安装任何包） ===================== */

// PBKDF2 迭代次数：Workers 免费版每次请求有 CPU 时间上限（目前公开信息约为 10ms/次调用）。
// 100000 次迭代在多数情况下能跑完，但如果你在 Cloudflare 控制台看到注册/登录接口报 CPU 超限错误，
// 把这个数字调低（比如 50000）重新部署即可——安全性会略有下降，但仍远好于明文/简单哈希存储密码。
const PBKDF2_ITERATIONS = 100000;

function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}
function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

// 生成随机盐并对密码做 PBKDF2-SHA256 派生。saltB64 传入则复用（用于校验），不传则生成新盐（用于注册/改密）。
export async function hashPassword(password, saltB64) {
    const enc = new TextEncoder();
    const salt = saltB64 ? base64ToBytes(saltB64) : crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        keyMaterial, 256
    );
    return { hash: bytesToBase64(new Uint8Array(bits)), salt: bytesToBase64(salt) };
}

// 定长比较，避免通过响应耗时差异推断哈希是否正确（timing attack）。
export function timingSafeEqual(aB64, bB64) {
    const a = base64ToBytes(aB64), b = base64ToBytes(bB64);
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
}

export async function verifyPassword(password, storedHashB64, storedSaltB64) {
    const { hash } = await hashPassword(password, storedSaltB64);
    return timingSafeEqual(hash, storedHashB64);
}

// 一次性恢复码：20 个字符，排除易混淆字符（0/O、1/I/L），分 4 组便于抄写，如 "A7K9F-3MXQP-...".
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function generateRecoveryCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    let raw = '';
    for (let i = 0; i < bytes.length; i++) raw += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
    return raw.match(/.{1,5}/g).join('-'); // -> XXXXX-XXXXX-XXXXX-XXXXX
}

// 恢复码校验前统一去掉用户可能手抖多打的空格/大小写差异，再复用同一套哈希函数。
export function normalizeRecoveryCode(code) {
    return (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
