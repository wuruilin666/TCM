/* ===================== Service Worker（PWA 离线 / 更新） =====================
 * 设计原则（与业务代码完全解耦，不修改任何现有业务逻辑）：
 *
 *   1. 分层缓存，不做「无脑全量缓存」：
 *      - 应用本体（HTML/CSS/JS/字体/图标/manifest）→ 版本化缓存，随版本整体更新
 *      - 病例 JSON（data/cases/*）→ Network First：联网拿最新，离线回退旧缓存
 *      - 舌象图片（tongue/*）→ 运行时 Cache First：首次访问才缓存，不预缓存
 *
 *   2. 程序更新与病例更新相互独立：
 *      - 发布程序：只需修改下面的 CACHE_VERSION，浏览器发现新 sw.js 后自动安装
 *      - 发布病例：只改 JSON 即可，联网时用户直接拿到新病例，与 SW 版本无关
 *
 *   3. 绝不打断正在做题的页面 —— 走浏览器自然生命周期，不用 skipWaiting / clients.claim：
 *      新 SW 安装后进入 waiting，旧 SW 继续控制当前页面（整套 v1 资源保持一致）；
 *      等所有旧客户端关闭后，新 SW 才在 activate 中接管并清理旧缓存，
 *      用户下一次打开时整套使用新版本。
 *
 * 发布新版本时只需修改 CACHE_VERSION（例如 tcm-v2026.10.01）。
 * ========================================================================== */

const CACHE_VERSION = 'tcm-v2026.09.28-fix1';

// 版本化缓存：应用本体。升版本即换命名空间，旧缓存由 activate 清理。
const APP_CACHE = CACHE_VERSION + '-app';
// 稳定缓存：与程序版本无关，跨版本保留，避免每次发版都重新下载病例与图片。
const CASES_CACHE = 'tcm-cases-data';
const TONGUE_CACHE = 'tcm-tongue-img';
const KEEP_CACHES = [APP_CACHE, CASES_CACHE, TONGUE_CACHE];

// 应用本体预缓存清单（相对路径，随 sw.js 所在路径解析；站点部署在域名根目录即为 /xxx）。
// 舌象图片不在此列：按需求只在运行时逐张缓存。
const CORE_ASSETS = [
    './',
    './css/main.css',
    './assets/fonts/NotoSerifSC-VF.woff2',
    './manifest.webmanifest',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-512-maskable.png',
    './icons/apple-touch-icon.png',
    './js/app.js',
    './js/case-bank.js',
    './js/data.js',
    './js/game.js',
    './js/html-utils.js',
    './js/inquiry.js',
    './js/inquiry-matcher.js',
    './js/inspection.js',
    './js/core/answer-evaluator.js',
    './js/core/tongue-judge.js',
    './js/storage/backup-code.js',
    './js/storage/backup-service.js',
    './js/storage/progress-storage.js'
];

// 调试日志默认关闭；页面可通过 postMessage { type: 'SET_DEBUG', value: true } 打开
// （注册脚本在 ?debug=1 时自动开启）。
let debug = false;
function log() {
    if (debug) console.log.apply(console, ['[PWA]'].concat([].slice.call(arguments)));
}

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(APP_CACHE);
        // addAll 要求全部资源 2xx：核心资源缺失时让安装失败（浏览器会丢弃此 SW），
        // 不静默带着残缺缓存上线；网站仍按普通网页正常访问。
        await cache.addAll(CORE_ASSETS);
        log('预缓存完成', CACHE_VERSION);
    })());
    // 不调用 skipWaiting()：有旧 SW 控制页面时，新版本安装完进入 waiting，
    // 直到所有旧客户端关闭后才自然激活，保证当前病例会话整套资源版本一致。
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names
            // 只清理本应用的旧缓存（tcm- 前缀），保留当前版本与两个稳定缓存。
            .filter(name => name.indexOf('tcm-') === 0 && KEEP_CACHES.indexOf(name) === -1)
            .map(name => {
                log('清理旧缓存', name);
                return caches.delete(name);
            })
        );
        // 不调用 clients.claim()：新 SW 只控制激活之后打开的页面，
        // 不接管任何仍在运行的旧客户端。
        log('已激活', CACHE_VERSION);
    })());
});

self.addEventListener('message', event => {
    const data = event.data || {};
    if (data.type === 'SET_DEBUG') debug = data.value === true;
    if (data.type === 'GET_VERSION' && event.source) {
        event.source.postMessage({ type: 'PWA_VERSION', version: CACHE_VERSION });
    }
});

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return; // 跨域（如表单提交）直接放行
    if (url.pathname === '/sw.js') return;           // SW 自身走浏览器重新验证（见 _headers）

    // 1) 页面导航（HTML）：Network First，离线回退缓存入口。
    if (req.mode === 'navigate') {
        event.respondWith(networkFirstHtml(req));
        return;
    }

    // 2) 病例 JSON：Network First + 离线旧缓存（病例更新与程序版本无关）。
    if (url.pathname.indexOf('/data/cases/') === 0) {
        event.respondWith(networkFirstCases(req));
        return;
    }

    // 3) 舌象图片：运行时 Cache First，未缓存且离线时交给页面现有的图片失败逻辑。
    if (url.pathname.indexOf('/tongue/') === 0) {
        event.respondWith(cacheFirstTongue(req));
        return;
    }

    // 4) 应用本体静态资源（js/css/assets/icons/manifest）：版本缓存优先。
    if (isAppAsset(url.pathname)) {
        event.respondWith(cacheFirstApp(req));
    }
});

function isAppAsset(pathname) {
    return pathname.indexOf('/js/') === 0
        || pathname.indexOf('/css/') === 0
        || pathname.indexOf('/assets/') === 0
        || pathname.indexOf('/icons/') === 0
        || pathname === '/manifest.webmanifest';
}

// HTML：始终优先网络（保证发布后能拿到新页面），失败再用缓存保证离线可开。
async function networkFirstHtml(req) {
    try {
        const fresh = await fetch(req);
        if (fresh.ok) {
            const cache = await caches.open(APP_CACHE);
            cache.put('./', fresh.clone());
        }
        return fresh;
    } catch (e) {
        const cached = await caches.match('./', { cacheName: APP_CACHE, ignoreSearch: true });
        if (cached) {
            log('离线回退首页缓存');
            return cached;
        }
        throw e;
    }
}

// 病例 JSON：联网用最新并顺手更新缓存；离线时返回旧缓存，没有旧缓存则网络错误（由 boot 呈现失败提示）。
async function networkFirstCases(req) {
    try {
        const fresh = await fetch(req);
        if (fresh.ok) {
            const cache = await caches.open(CASES_CACHE);
            cache.put(req, fresh.clone());
        }
        return fresh;
    } catch (e) {
        const cached = await caches.match(req, { cacheName: CASES_CACHE });
        if (cached) {
            log('离线回退病例缓存', req.url);
            return cached;
        }
        return Response.error();
    }
}

// 舌象图片：缓存优先（静态图片，不随程序版本变化）；首次访问走网络并缓存。
// 缓存与网络都失败时返回网络错误，触发 inspection.js 既有的 onerror「图片加载失败」占位逻辑。
async function cacheFirstTongue(req) {
    const cached = await caches.match(req, { cacheName: TONGUE_CACHE });
    if (cached) return cached;
    const fresh = await fetch(req);
    if (fresh.ok) {
        const cache = await caches.open(TONGUE_CACHE);
        cache.put(req, fresh.clone());
    }
    return fresh;
}

// 应用本体：优先版本缓存（新命名空间在 install 时已预缓存新版），
// 万一缓存未命中（例如发版后新增的文件）回退网络并补缓存。
async function cacheFirstApp(req) {
    const cached = await caches.match(req, { cacheName: APP_CACHE });
    if (cached) return cached;
    const fresh = await fetch(req);
    if (fresh.ok) {
        const cache = await caches.open(APP_CACHE);
        cache.put(req, fresh.clone());
    }
    return fresh;
}
