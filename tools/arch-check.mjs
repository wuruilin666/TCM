/* 静态依赖检查：验证模块图无断链、无环、无越界依赖。
 * 运行： node tools/arch-check.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JS_DIR = join(ROOT, 'js');

function walk(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) out.push(...walk(p));
        else if (name.endsWith('.js')) out.push(p);
    }
    return out;
}

const files = walk(JS_DIR);
const graph = new Map();
const importRe = /from\s+['"](\.[^'"]+)['"]/g;

for (const f of files) {
    const src = readFileSync(f, 'utf-8');
    const deps = [];
    let m;
    while ((m = importRe.exec(src))) {
        const target = resolve(dirname(f), m[1]);
        deps.push(target);
    }
    graph.set(f, deps);
}

let problems = 0;
const rel = p => relative(ROOT, p).replace(/\\/g, '/');

console.log('=== 1. 断链检查 ===');
for (const [f, deps] of graph) {
    for (const d of deps) {
        if (!files.includes(d)) { console.log(`  ❌ ${rel(f)} → ${rel(d)} 不存在`); problems++; }
    }
}
if (!problems) console.log('  ✅ 所有 import 均可解析');

console.log('\n=== 2. 循环依赖检查 ===');
const WHITE = 0, GRAY = 1, BLACK = 2;
const color = new Map(files.map(f => [f, WHITE]));
const cycles = [];
function dfs(f, stack) {
    color.set(f, GRAY); stack.push(f);
    for (const d of graph.get(f) || []) {
        if (color.get(d) === GRAY) {
            const i = stack.indexOf(d);
            cycles.push([...stack.slice(i), d].map(rel).join(' → '));
        } else if (color.get(d) === WHITE) dfs(d, stack);
    }
    stack.pop(); color.set(f, BLACK);
}
for (const f of files) if (color.get(f) === WHITE) dfs(f, []);
if (cycles.length) { cycles.forEach(c => { console.log('  ❌ ' + c); problems++; }); }
else console.log('  ✅ 无循环依赖');

console.log('\n=== 3. 依赖方向检查 ===');
// 层级：layer(module) 越小越底层。高层可以依赖低层，低层不得依赖高层。
const LAYER = {
    'js/app.js': 0,
    'js/case-bank.js': 1,
    'js/game.js': 2,
    'js/inquiry.js': 2,
    'js/inspection.js': 2,
    'js/storage/backup-service.js': 3,
    'js/storage/backup-code.js': 4,
    'js/storage/progress-storage.js': 4,
    'js/data.js': 4,
    'js/html-utils.js': 5,
    'js/core/answer-evaluator.js': 5,
    'js/core/tongue-judge.js': 5,
    'js/inquiry-matcher.js': 5
};
let dirProblems = 0;
for (const [f, deps] of graph) {
    const lf = LAYER[rel(f)];
    if (lf === undefined) continue;
    for (const d of deps) {
        const ld = LAYER[rel(d)];
        if (ld === undefined) continue;
        // 同级允许（同层横向协作），但低层依赖高层禁止
        if (ld < lf) {
            console.log(`  ❌ 反向依赖：${rel(f)} (L${lf}) → ${rel(d)} (L${ld})`);
            dirProblems++;
        }
    }
}
if (!dirProblems) console.log('  ✅ 无反向依赖');

console.log('\n=== 4. 禁用 API 越界检查 ===');
// 记录每个模块允许使用的敏感 API
const FORBIDDEN = [
    { file: 'js/core/answer-evaluator.js', re: /document\.|window\.|localStorage|fetch\(|alert\(|confirm\(/, why: 'Domain 必须纯净' },
    { file: 'js/core/tongue-judge.js', re: /document\.|window\.|localStorage|fetch\(|alert\(|confirm\(/, why: 'Domain 必须纯净' },
    { file: 'js/inquiry-matcher.js', re: /document\.|window\.|localStorage|fetch\(|alert\(|confirm\(/, why: 'Domain 必须纯净' },
    { file: 'js/storage/progress-storage.js', re: /document\.|window\.|alert\(|confirm\(/, why: 'Progress Storage 不负责 UI' },
    { file: 'js/storage/backup-code.js', re: /document\.|localStorage|alert\(|confirm\(/, why: 'Backup Code 不负责 UI / Storage' },
    { file: 'js/game.js', re: /localStorage|fetch\(/, why: 'Game 不得直接访问存储 / 网络' },
    { file: 'js/case-bank.js', re: /localStorage/, why: 'Case Bank 不得绕过 Progress Storage' },
    { file: 'js/data.js', re: /document\.|localStorage|alert\(/, why: '病例数据模块不负责 DOM / 存储' }
];
// 逐行扫描，跳过注释行（行注释、块注释、JSDoc 续行）
function codeLines(src) {
    let inBlock = false;
    return src.split('\n').map(line => {
        const t = line.trim();
        if (inBlock) { if (t.includes('*/')) inBlock = false; return ''; }
        if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; return ''; }
        if (t.startsWith('//') || t.startsWith('*')) return '';
        return line;
    });
}

let apiProblems = 0;
for (const rule of FORBIDDEN) {
    const f = join(ROOT, rule.file);
    if (!files.includes(f)) continue;
    codeLines(readFileSync(f, 'utf-8')).forEach((line, i) => {
        if (!line) return;
        if (rule.re.test(line)) {
            console.log(`  ❌ ${rule.file}:${i + 1} 违反「${rule.why}」→ ${line.trim().slice(0, 90)}`);
            apiProblems++;
        }
    });
}
if (!apiProblems) console.log('  ✅ 无越界 API 调用');

console.log('\n=== 5. 未使用的 import 检查 ===');
let unused = 0;
for (const f of files) {
    const src = readFileSync(f, 'utf-8');
    const body = src.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?/gm, '');
    for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
        for (const raw of m[1].split(',')) {
            const name = raw.trim().split(/\s+as\s+/).pop().trim();
            if (!name) continue;
            if (!new RegExp(`\\b${name}\\b`).test(body)) {
                console.log(`  ⚠️  ${rel(f)} 导入但未使用：${name}`);
                unused++;
            }
        }
    }
}
if (!unused) console.log('  ✅ 无未使用 import');

console.log('\n=== 结果 ===');
console.log(problems + dirProblems + apiProblems === 0
    ? `✅ 通过（未使用 import 警告 ${unused} 条）`
    : `❌ 发现 ${problems + dirProblems + apiProblems} 个问题`);
process.exit(problems + dirProblems + apiProblems === 0 ? 0 : 1);
