/* ===================== 望诊图片路径解析 / 渲染测试 =====================
 * 运行： node tests/inspection-images.test.mjs
 *
 * 覆盖：
 *   - 显式 inspectionImages 优先
 *   - 没有 inspectionImages 时回退 tongue/<caseId>.jpg
 *   - inspectionImages 为空数组时同样回退
 *   - 非法 case ID 不参与拼路径
 *   - 返回新数组（不把病例里的数组引用交出去）
 *   - 全量病例解析出的图片路径在仓库中真实存在
 *   - Session 装载接线（进入病例 / 下一例 / 题库进入都能拿到图片）
 *   - 「暂无舌象图片」与「图片加载失败」是两种状态
 * ==================================================================== */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// jsdom 从受管 Node 工作区按绝对路径加载（与 regression.test.mjs 同一来源）
const JSDOM_HOME = process.env.JSDOM_HOME || 'C:/Users/吴睿琳/.workbuddy/binaries/node/workspace/node_modules';
const { JSDOM } = await import(pathToFileURL(join(JSDOM_HOME, 'jsdom/lib/api.js')).href);

let pass = 0;
const failures = [];
function check(name, fn) {
    try { fn(); pass++; console.log('  ✅ ' + name); }
    catch (e) { failures.push(name + '  → ' + e.message); console.log('  ❌ ' + name + '  → ' + e.message); }
}

/* ---------------- 1. 路径解析（纯逻辑） ---------------- */
const data = await import(pathToFileURL(join(ROOT, 'js/data.js')).href);
const { getInspectionImages } = data;

console.log('\n=== 1. 图片路径解析 ===\n');

check('没有 inspectionImages 时回退 tongue/<caseId>.jpg', () => {
    assert.deepEqual(getInspectionImages({ id: 'basic-001' }), ['tongue/basic-001.jpg']);
});

check('有显式 inspectionImages 时优先使用（且支持多张）', () => {
    assert.deepEqual(
        getInspectionImages({ id: 'basic-001', inspectionImages: ['tongue/custom-1.jpg', 'tongue/custom-2.jpg'] }),
        ['tongue/custom-1.jpg', 'tongue/custom-2.jpg']
    );
});

check('inspectionImages 为空数组时回退', () => {
    assert.deepEqual(getInspectionImages({ id: 'basic-001', inspectionImages: [] }), ['tongue/basic-001.jpg']);
});

check('非法 case ID 不允许拼接路径', () => {
    for (const bad of ['../basic-001', 'basic-1', 'basic-001/../x', 'BASIC-001', '', null, undefined]) {
        assert.deepEqual(getInspectionImages({ id: bad }), [], `id=${String(bad)} 不应拼出路径`);
    }
});

check('非法 case ID 时也不误用显式配置以外的回退', () => {
    assert.deepEqual(getInspectionImages(null), []);
    assert.deepEqual(getInspectionImages({}), []);
});

check('返回新数组，不交出病例里的数组引用', () => {
    const images = ['tongue/basic-001.jpg'];
    const result = getInspectionImages({ id: 'basic-001', inspectionImages: images });
    assert.notStrictEqual(result, images);
    assert.deepEqual(result, images);
    result.push('tongue/injected.jpg');
    assert.deepEqual(images, ['tongue/basic-001.jpg'], '改动返回值不应影响原数组');
});

/* ---------------- 2. 与真实病例数据 / 仓库图片对照 ---------------- */
console.log('\n=== 2. 全部病例的图片路径可解析且在仓库中存在 ===\n');

const cases = ['basic', 'intermediate', 'advanced'].flatMap(f =>
    JSON.parse(readFileSync(join(ROOT, `data/cases/${f}.json`), 'utf-8')).cases);

check(`全部 ${cases.length} 例都能解析出图片路径`, () => {
    assert.equal(cases.length, 19);
    for (const c of cases) {
        assert.ok(getInspectionImages(c).length > 0, `${c.id} 解析出空图片列表`);
    }
});

check('解析出的每个图片文件都真实存在（未伪造图片）', () => {
    for (const c of cases) {
        for (const p of getInspectionImages(c)) {
            assert.ok(existsSync(join(ROOT, p)), `${c.id} → ${p} 不存在`);
        }
    }
});

check('只有 inter-006 有显式配置，且两张都保留', () => {
    const explicit = cases.filter(c => Array.isArray(c.inspectionImages));
    assert.deepEqual(explicit.map(c => c.id), ['inter-006']);
    assert.deepEqual(getInspectionImages(cases.find(c => c.id === 'inter-006')),
        ['tongue/inter-006.jpg', 'tongue/inter-0061.jpg']);
});

check('未配置的旧病例自动回退（抽查 basic-002 / adv-007）', () => {
    assert.deepEqual(getInspectionImages(cases.find(c => c.id === 'basic-002')), ['tongue/basic-002.jpg']);
    assert.deepEqual(getInspectionImages(cases.find(c => c.id === 'adv-007')), ['tongue/adv-007.jpg']);
});

/* ---------------- 3. Session 装载接线 + 渲染状态（jsdom） ---------------- */
console.log('\n=== 3. Session 装载与望诊渲染（jsdom） ===\n');

const dom = new JSDOM(readFileSync(join(ROOT, 'index.html'), 'utf-8'), { url: 'https://tcm.test/', pretendToBeVisual: true });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true });
globalThis.location = window.location;
globalThis.localStorage = window.localStorage;
// 预加载（preloadNextImage）用 new Image()，浏览器里是全局构造器，Node 里要显式挂上
globalThis.Image = window.Image;
globalThis.alert = () => {};
globalThis.confirm = () => true;
window.confirm = () => true;
window.scrollTo = () => {};
window.Element.prototype.scrollIntoView = function () {};

// 游戏页 DOM（#caseWorkspace / #clueArea 等）由 app.js 生成，病例源与进度服务也由它注册。
// 这里按 regression.test.mjs 的方式启动一次应用，好在真实页面结构上验证望诊链路。
globalThis.fetch = async (url) => {
    const text = readFileSync(join(ROOT, String(url)), 'utf-8');
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
};
const origLog = console.log, origDebug = console.debug;
console.debug = () => {};
console.log = () => {};
await import(pathToFileURL(join(ROOT, 'js/app.js')).href);
await new Promise(r => setTimeout(r, 200));
console.log = origLog;
console.debug = origDebug;

const game = await import(pathToFileURL(join(ROOT, 'js/game.js')).href);
const inspection = await import(pathToFileURL(join(ROOT, 'js/inspection.js')).href);

const img = document.getElementById('inspectionImg');
const counter = document.getElementById('inspectionCounter');
const askedImages = () => game.getSession().inspection.images;

check('选择难度进入病例后，Session 里已有该病例的图片', () => {
    game.startCasePractice('basic-001');
    assert.deepEqual(askedImages(), ['tongue/basic-001.jpg']);
});

check('下一例会换成新病例的图片', () => {
    game.nextCase();
    assert.deepEqual(askedImages(), ['tongue/basic-002.jpg']);
});

check('题库 / 错题入口（startCasePractice）同样装载图片', () => {
    game.startCasePractice('inter-006');
    assert.deepEqual(askedImages(), ['tongue/inter-006.jpg', 'tongue/inter-0061.jpg']);
});

check('打开望诊后 img 指向第一张，多图时显示 1 / 2 与翻页按钮', () => {
    inspection.openInspectionModal();
    assert.equal(img.getAttribute('src'), 'tongue/inter-006.jpg');
    assert.equal(counter.textContent, '1 / 2');
    assert.equal(document.getElementById('inspectPrev').style.display, 'flex');
    assert.equal(document.getElementById('inspectNext').style.display, 'flex');
});

check('上一张 / 下一张仍然可用', () => {
    inspection.inspectNext();
    assert.equal(img.getAttribute('src'), 'tongue/inter-0061.jpg');
    assert.equal(counter.textContent, '2 / 2');
    inspection.inspectPrev();
    assert.equal(img.getAttribute('src'), 'tongue/inter-006.jpg');
    assert.equal(counter.textContent, '1 / 2');
});

check('单图病例不显示翻页按钮', () => {
    game.startCasePractice('basic-001');
    inspection.openInspectionModal();
    assert.equal(img.getAttribute('src'), 'tongue/basic-001.jpg');
    assert.equal(document.getElementById('inspectPrev').style.display, 'none');
    assert.equal(document.getElementById('inspectNext').style.display, 'none');
});

check('没有图片路径时：不设置 src，且显示「暂无舌象图片」', () => {
    game.setInspectionImages([]);
    inspection.renderInspection();
    assert.equal(img.hasAttribute('src'), false, '不应残留 src');
    assert.equal(counter.textContent, '暂无舌象图片');
    assert.equal(document.getElementById('inspectPrev').style.display, 'none');
});

check('打开望诊时若没有图片，仍然是「暂无舌象图片」而不是加载失败', () => {
    game.setInspectionImages([]);
    inspection.openInspectionModal();
    assert.equal(img.hasAttribute('src'), false);
    assert.equal(counter.textContent, '暂无舌象图片');
});

check('有路径但加载失败：显示「图片加载失败」占位图，且不会二次触发 onerror', () => {
    game.startCasePractice('basic-001');
    game.setInspectionImages(['tongue/does-not-exist.jpg']);
    inspection.openInspectionModal();
    img.onerror.call(img);
    assert.equal(counter.textContent, '图片加载失败');
    assert.ok(String(img.getAttribute('src')).startsWith('data:image/svg+xml'), '应换成占位图');
    assert.equal(img.onerror, null, 'onerror 应被摘掉，避免死循环');
});

/* ---------------- 4. 图片事件绑定顺序 ---------------- */
console.log('\n=== 4. 望诊图片事件绑定顺序 ===\n');

// 探针：包一层 src setter，记录「设置 src 的那一刻 onload / onerror 是否已经挂上」。
// 顺序错了（先设 src 再绑事件）时，图片命中缓存会先解码完成，onload 就永远收不到。
const srcDesc = Object.getOwnPropertyDescriptor(window.HTMLImageElement.prototype, 'src');
let boundAtFirstSrcSet = null;
Object.defineProperty(window.HTMLImageElement.prototype, 'src', {
    configurable: srcDesc.configurable,
    enumerable: srcDesc.enumerable,
    get: srcDesc.get,
    set(v) {
        if (this.id === 'inspectionImg' && boundAtFirstSrcSet === null) {
            boundAtFirstSrcSet = {
                onload: typeof this.onload === 'function',
                onerror: typeof this.onerror === 'function'
            };
        }
        srcDesc.set.call(this, v);
    }
});

check('设置 img.src 之前，onload / onerror 必须已经绑定', () => {
    boundAtFirstSrcSet = null;
    game.startCasePractice('basic-001');
    inspection.openInspectionModal();
    assert.ok(boundAtFirstSrcSet, 'openInspectionModal 应当设置过 img.src');
    assert.equal(boundAtFirstSrcSet.onload, true, '设置 src 时 onload 尚未绑定');
    assert.equal(boundAtFirstSrcSet.onerror, true, '设置 src 时 onerror 尚未绑定');
});

check('图片解码完成后 onload 能把计数器从「图片加载中...」更新为正常文案', () => {
    assert.equal(counter.textContent, '图片加载中...', '前置：等待加载中');
    img.dispatchEvent(new window.Event('load'));
    assert.equal(img.style.display, 'block', 'onload 应让图片显示出来');
    assert.equal(counter.textContent, '', '单图病例加载完成后不显示计数');
});

/* ---------------- 结果 ---------------- */
console.log('\n=== 结果 ===');
console.log(`通过 ${pass}，失败 ${failures.length}`);
if (failures.length) {
    console.log('\n失败项：');
    failures.forEach(f => console.log(' - ' + f));
    process.exit(1);
}
