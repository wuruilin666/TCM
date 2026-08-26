import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const dataDir = join(root, 'data');
const uploadDir = join(root, 'uploads');
const submissionDir = join(root, 'submissions');
const PORT = Number(process.env.PORT || 8000);
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const rateBuckets = new Map();
const errorEvents = [];

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const send = (res, status, payload, headers = {}) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }).end(JSON.stringify(payload));

function setSecurityHeaders(res) {
  // Scripts are fully external. Inline styles remain a documented migration exception until template styles move to CSS classes.
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}
function clientKey(req) { return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim(); }
function allow(req, limit = 30, windowMs = 60_000) {
  const now = Date.now(), key = clientKey(req), record = rateBuckets.get(key) || { start: now, count: 0 };
  if (now - record.start >= windowMs) { record.start = now; record.count = 0; }
  record.count += 1; rateBuckets.set(key, record);
  return record.count <= limit;
}
async function readJson(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY_BYTES) throw new Error('REQUEST_TOO_LARGE'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function caseIndex() { return JSON.parse(await readFile(join(dataDir, 'case-index.json'), 'utf8')); }
async function casesForDifficulty(difficulty) { return JSON.parse(await readFile(join(dataDir, 'cases', `${difficulty}.json`), 'utf8')).cases; }
function validDifficulty(value) { return ['basic', 'intermediate', 'advanced'].includes(value); }
function validText(value, max = 4000) { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
function dataUrlToImage(value) {
  if (!value) return null;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) throw new Error('INVALID_IMAGE');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 10 * 1024 * 1024) throw new Error('IMAGE_TOO_LARGE');
  const signatures = { 'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]), 'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/webp': Buffer.from('RIFF') };
  if (!bytes.subarray(0, signatures[match[1]].length).equals(signatures[match[1]]) || (match[1] === 'image/webp' && bytes.subarray(8, 12).toString() !== 'WEBP')) throw new Error('INVALID_IMAGE');
  return { type: match[1], bytes: stripMetadata(match[1], bytes) };
}
function stripMetadata(type, bytes) {
  if (type === 'image/jpeg') {
    const chunks = [bytes.subarray(0, 2)]; let offset = 2;
    while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1];
      if (marker === 0xda) { chunks.push(bytes.subarray(offset)); break; } // scan data follows SOS
      if (marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { chunks.push(bytes.subarray(offset, offset + 2)); offset += 2; continue; }
      const size = bytes.readUInt16BE(offset + 2); if (size < 2 || offset + 2 + size > bytes.length) throw new Error('INVALID_IMAGE');
      if (!((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe)) chunks.push(bytes.subarray(offset, offset + 2 + size));
      offset += 2 + size;
    }
    return Buffer.concat(chunks);
  }
  if (type === 'image/png') {
    const chunks = [bytes.subarray(0, 8)]; let offset = 8;
    while (offset + 12 <= bytes.length) { const size = bytes.readUInt32BE(offset), end = offset + 12 + size; if (end > bytes.length) throw new Error('INVALID_IMAGE'); const name = bytes.subarray(offset + 4, offset + 8).toString(); if (!['eXIf', 'tEXt', 'zTXt', 'iTXt'].includes(name)) chunks.push(bytes.subarray(offset, end)); offset = end; }
    return Buffer.concat(chunks);
  }
  // RIFF WebP stores EXIF/XMP as top-level chunks.
  const chunks = [bytes.subarray(0, 12)]; let offset = 12;
  while (offset + 8 <= bytes.length) { const size = bytes.readUInt32LE(offset + 4), padded = size + (size % 2), end = offset + 8 + padded; if (end > bytes.length) throw new Error('INVALID_IMAGE'); const name = bytes.subarray(offset, offset + 4).toString(); if (!['EXIF', 'XMP '].includes(name)) chunks.push(bytes.subarray(offset, end)); offset = end; }
  const out = Buffer.concat(chunks); out.writeUInt32LE(out.length - 8, 4); return out;
}
function validateSubmission(body) {
  const required = ['case_source', 'chief_complaint', 'past_history', 'inspection', 'auscultation', 'inquiry', 'pulse', 'analysis', 'syndrome', 'disease', 'western_diagnosis'];
  if (!body || !required.every(k => validText(body[k])) || !validDifficulty(body.difficulty) || body.privacy_consent !== true) throw new Error('INVALID_SUBMISSION');
}
async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/cases') {
    const index = (await caseIndex()).cases, query = (url.searchParams.get('q') || '').trim().toLowerCase();
    const difficulty = url.searchParams.get('difficulty'), category = url.searchParams.get('category');
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 20)));
    const filtered = index.filter(c => (!difficulty || c.difficulty === difficulty) && (!category || c.category === category) && (!query || c.chiefComplaint.toLowerCase().includes(query)));
    return send(res, 200, { items: filtered.slice(offset, offset + limit), total: filtered.length, nextOffset: offset + limit < filtered.length ? offset + limit : null }, { 'Cache-Control': 'public, max-age=60' });
  }
  if (req.method === 'GET' && /^\/api\/cases\/[a-z]+-\d{3}$/.test(url.pathname)) {
    const id = url.pathname.split('/').pop(), difficulty = id.split('-')[0] === 'adv' ? 'advanced' : id.split('-')[0] === 'inter' ? 'intermediate' : 'basic';
    const item = (await casesForDifficulty(difficulty)).find(c => c.id === id);
    return item ? send(res, 200, item, { 'Cache-Control': 'public, max-age=300' }) : send(res, 404, { error: 'NOT_FOUND' });
  }
  if (req.method === 'POST' && url.pathname === '/api/submissions') {
    if (!allow(req, 5)) return send(res, 429, { error: 'RATE_LIMITED' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return send(res, 403, { error: 'INVALID_ORIGIN' });
    const body = await readJson(req); validateSubmission(body);
    const image = dataUrlToImage(body.image); delete body.image;
    const id = randomUUID(), record = { id, submittedAt: new Date().toISOString(), status: 'pending_review', ...body };
    await mkdir(submissionDir, { recursive: true }); await mkdir(uploadDir, { recursive: true });
    if (image) { const extension = image.type === 'image/jpeg' ? '.jpg' : image.type === 'image/png' ? '.png' : '.webp'; record.image = `uploads/${id}${extension}`; await writeFile(join(root, record.image), image.bytes, { flag: 'wx' }); }
    await writeFile(join(submissionDir, `${id}.json`), JSON.stringify(record, null, 2), { flag: 'wx' });
    return send(res, 201, { ok: true, id });
  }
  if (req.method === 'POST' && url.pathname === '/api/client-errors') {
    if (!allow(req, 60)) return send(res, 429, { error: 'RATE_LIMITED' });
    const body = await readJson(req); errorEvents.push({ at: new Date().toISOString(), message: String(body?.message || '').slice(0, 500), kind: String(body?.kind || 'client').slice(0, 80) });
    if (errorEvents.length > 1000) errorEvents.shift(); return send(res, 202, { ok: true });
  }
  return send(res, 404, { error: 'NOT_FOUND' });
}
async function serveStatic(res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const file = normalize(join(publicDir, requested));
  if (!file.startsWith(publicDir)) return send(res, 403, { error: 'FORBIDDEN' });
  try { const bytes = await readFile(file); res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=86400' }); res.end(bytes); }
  catch { send(res, 404, { error: 'NOT_FOUND' }); }
}
createServer(async (req, res) => {
  setSecurityHeaders(res); const url = new URL(req.url, `http://${req.headers.host}`);
  try { if (url.pathname.startsWith('/api/')) await handleApi(req, res, url); else await serveStatic(res, url.pathname); }
  catch (error) { console.error(error); send(res, error.message === 'REQUEST_TOO_LARGE' ? 413 : 400, { error: error.message || 'BAD_REQUEST' }); }
}).listen(PORT, () => console.log(`TCM app listening on http://localhost:${PORT}`));
