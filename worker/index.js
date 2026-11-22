import SOURCE from './source.lua';

class E extends Error { constructor(m, s = 400) { super(m); this.s = s } }
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store' } });
const H = (b, s = 200) => new Response(b, { status: s, headers: { 'content-type': 'text/html;charset=utf-8', 'content-security-policy': "default-src 'none'; img-src * data:; style-src 'unsafe-inline'", 'x-content-type-options': 'nosniff' } });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ID = /^[a-z0-9]{8,32}$/;
const MAX_BODY = 3 * 1024 * 1024, MAX_CH = 1.5 * 1024 * 1024, MAX_ASSET = 8 * 1024 * 1024;

// Sanitasi sisi server (lapis kedua; klien sudah menyanitasi dengan DOMParser)
const clean = h => String(h)
  .replace(/<(script|style|iframe|object|embed|form|template)\b[\s\S]*?(<\/\1\s*>|$)/gi, '')
  .replace(/<\/?(script|iframe|object|embed|link|meta|base|form)\b[^>]*>/gi, '')
  .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  .replace(/(href|src)\s*=\s*(["'])\s*(javascript|vbscript):[^"']*\2/gi, '$1=$2$2');

async function authed(req, env) {
  const k = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_KEY || !k) return false;
  const e = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', e.encode(k)), crypto.subtle.digest('SHA-256', e.encode(env.ADMIN_KEY))]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let d = 0; for (let i = 0; i < 32; i++) d |= x[i] ^ y[i];
  return d === 0;
}
async function readBody(req, max) {
  if (+req.headers.get('content-length') > max) throw new E('Request terlalu besar', 413);
  const b = await req.arrayBuffer();
  if (b.byteLength > max) throw new E('Request terlalu besar', 413);
  return b;
}
const getIdx = async env => { const o = await env.BUCKET.get('index.json'); return o ? await o.json() : [] };
const putIdx = (env, a) => env.BUCKET.put('index.json', JSON.stringify(a), { httpMetadata: { contentType: 'application/json' } });
const getMeta = async (env, id) => { const o = await env.BUCKET.get(`novels/${id}/meta.json`); return o ? await o.json() : null };
const pageOf = (list, p, size) => { p = Math.max(1, +p || 1); size = Math.min(1000, Math.max(1, +size || 20)); return { items: list.slice((p - 1) * size, p * size), total: list.length, page: p, size } };
const matchQ = (list, q) => { q = (q || '').trim().toLowerCase(); return q ? list.filter(b => (b.title + ' ' + b.author).toLowerCase().includes(q)) : list };

export default {
  async fetch(req, env) {
    try { return await route(req, env) }
    catch (e) { return J({ error: e instanceof E ? e.message : 'Internal error' }, e.s || 500) }
  }
};

async function route(req, env) {
  const u = new URL(req.url), p = u.pathname, o = u.origin, m = req.method;
  if (p === '/source.lua') return new Response(SOURCE.replaceAll('__BASE_URL__', o), { headers: { 'content-type': 'text/plain;charset=utf-8', 'cache-control': 'no-store' } });
  if (p.startsWith('/api/admin/')) {
    if (!(await authed(req, env))) return J({ error: 'Unauthorized' }, 401);
    return admin(req, env, p.slice(11), m);
  }
  if (m !== 'GET' && m !== 'HEAD') return env.ASSETS.fetch(req);
  let x;
  if (p === '/api/novels') return J(pageOf(await getIdx(env), u.searchParams.get('page'), u.searchParams.get('size')));
  if (p === '/api/search') return J(pageOf(matchQ(await getIdx(env), u.searchParams.get('keyword')), u.searchParams.get('page'), u.searchParams.get('size')));
  if ((x = p.match(/^\/api\/novel\/([a-z0-9]+)(?:\/(chapters)|\/chapter\/(\d+))?$/))) {
    const meta = await getMeta(env, x[1]); if (!meta) return J({ error: 'Novel tidak ditemukan' }, 404);
    if (x[2]) return J({ id: meta.id, chapters: meta.chapters });
    if (x[3]) { const c = meta.chapters.find(c => c.n === +x[3]); const ob = c && await env.BUCKET.get(`novels/${meta.id}/ch/${c.n}.html`); if (!ob) return J({ error: 'Chapter tidak ditemukan' }, 404); return J({ n: c.n, title: c.title, html: (await ob.text()).replaceAll('src="/asset/', `src="${o}/asset/`) }) }
    const { chapters, ...rest } = meta; return J({ ...rest, chapterCount: chapters.length });
  }
  if ((x = p.match(/^\/category\/all\/(?:(\d+)\.html)?$/))) return listHtml(pageOf(await getIdx(env), x[1] || 1, 20).items, o);
  if (p === '/s/search') return listHtml(pageOf(matchQ(await getIdx(env), u.searchParams.get('searchkey')), u.searchParams.get('page'), 20).items, o);
  if ((x = p.match(/^\/book\/([a-z0-9]+)\/(?:(\d+)\.html)?$/))) {
    const meta = await getMeta(env, x[1]); if (!meta) return H('Not found', 404);
    if (!x[2]) {
      const mt = (k, v) => `<meta property="${k}" content="${esc(v)}">`;
      return H(`<!doctype html><meta charset="utf-8"><title>${esc(meta.title)}</title>${mt('og:novel:book_name', meta.title)}${mt('og:novel:author', meta.author)}${mt('og:description', meta.description || '')}${mt('og:novel:category', 'EPUB')}${meta.hasCover ? mt('og:image', `${o}/asset/${meta.id}/cover`) : ''}<div class="hide">${meta.chapters.map(c => `<a href="${o}/book/${meta.id}/${c.n}.html">${esc(c.title)}</a>`).join('')}</div>`);
    }
    const c = meta.chapters.find(c => c.n === +x[2]); const ob = c && await env.BUCKET.get(`novels/${meta.id}/ch/${c.n}.html`);
    if (!ob) return H('Not found', 404);
    return H(`<!doctype html><meta charset="utf-8"><title>${esc(c.title)}</title><h1>${esc(c.title)}</h1><div id="chaptercontent">${(await ob.text()).replaceAll('src="/asset/', `src="${o}/asset/`)}</div>`);
  }
  if ((x = p.match(/^\/asset\/([a-z0-9]+)\/([\w.-]{1,80})$/))) {
    const ob = await env.BUCKET.get(`novels/${x[1]}/asset/${x[2]}`); if (!ob) return new Response('Not found', { status: 404 });
    return new Response(ob.body, { headers: { 'content-type': ob.httpMetadata?.contentType || 'application/octet-stream', 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox' } });
  }
  return env.ASSETS.fetch(req);
}

function listHtml(items, o) {
  return H(`<!doctype html><meta charset="utf-8"><div class="librarylist"><ul>${items.map(b => `<li>${b.hasCover ? `<a href="${o}/book/${b.id}/"><img src="${o}/asset/${b.id}/cover"></a>` : `<a href="${o}/book/${b.id}/">&#128214;</a>`}<span class="novelname">${esc(b.title)}</span><div class="info"><span>Novel</span><span>Author: ${esc(b.author)}</span></div><p class="intro">${esc(b.description || '')}</p></li>`).join('')}</ul></div>`);
}

async function admin(req, env, p, m) {
  let x;
  if (p === 'ping' && m === 'GET') return J({ ok: true });
  if ((x = p.match(/^novel\/([a-z0-9]{8,32})(?:\/(chapters|commit)|\/asset\/([\w.-]{1,80}))?$/)) && ID.test(x[1])) {
    const id = x[1];
    if (m === 'DELETE' && !x[2] && !x[3]) return unpublish(env, id);
    if (m === 'POST' && x[2] === 'chapters') return putChapters(req, env, id);
    if (m === 'POST' && x[2] === 'commit') return commit(req, env, id);
    if (m === 'PUT' && x[3]) return putAsset(req, env, id, x[3]);
  }
  return J({ error: 'Not found' }, 404);
}

async function putChapters(req, env, id) {
  let d; try { d = JSON.parse(new TextDecoder().decode(await readBody(req, MAX_BODY))) } catch (e) { if (e instanceof E) throw e; throw new E('JSON tidak valid') }
  const a = d?.chapters; if (!Array.isArray(a) || !a.length || a.length > 60) throw new E('chapters harus array 1–60 item');
  for (const c of a) if (!Number.isInteger(c.n) || c.n < 1 || c.n > 20000 || typeof c.html !== 'string' || c.html.length > MAX_CH) throw new E(`Chapter tidak valid (n=${c?.n}); maks 1,5 MB per chapter`);
  await Promise.all(a.map(c => env.BUCKET.put(`novels/${id}/ch/${c.n}.html`, clean(c.html), { httpMetadata: { contentType: 'text/html;charset=utf-8' } })));
  return J({ ok: true, saved: a.length });
}

async function putAsset(req, env, id, name) {
  const t = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^image\/(jpeg|png|gif|webp|svg\+xml)$/.test(t)) throw new E('Tipe aset tidak didukung (hanya gambar)', 415);
  const b = await readBody(req, MAX_ASSET);
  await env.BUCKET.put(`novels/${id}/asset/${name}`, b, { httpMetadata: { contentType: t } });
  return J({ ok: true });
}

async function listKeys(env, prefix) {
  const keys = []; let cursor;
  do { const r = await env.BUCKET.list({ prefix, cursor }); keys.push(...r.objects.map(o => o.key)); cursor = r.truncated ? r.cursor : undefined } while (cursor);
  return keys;
}

async function commit(req, env, id) {
  let d; try { d = JSON.parse(new TextDecoder().decode(await readBody(req, MAX_BODY))) } catch (e) { if (e instanceof E) throw e; throw new E('JSON tidak valid') }
  const title = String(d.title || '').trim().slice(0, 300), author = String(d.author || '').trim().slice(0, 300) || 'Unknown';
  if (!title) throw new E('Judul wajib diisi');
  const chs = d.chapters; if (!Array.isArray(chs) || !chs.length || chs.length > 20000) throw new E('Daftar chapter tidak valid');
  const chapters = chs.map((c, i) => ({ n: i + 1, title: String(c?.title || `Chapter ${i + 1}`).trim().slice(0, 300) }));
  const total = chapters.length;
  for (const n of [1, total]) if (!(await env.BUCKET.head(`novels/${id}/ch/${n}.html`))) throw new E(`Chapter ${n} belum terunggah; publikasi dibatalkan`, 409);
  const stale = (await listKeys(env, `novels/${id}/ch/`)).filter(k => +k.match(/(\d+)\.html$/)?.[1] > total);
  for (let i = 0; i < stale.length; i += 1000) await env.BUCKET.delete(stale.slice(i, i + 1000));
  const hasCover = !!d.hasCover && !!(await env.BUCKET.head(`novels/${id}/asset/cover`));
  const description = String(d.description || '').slice(0, 2000), updatedAt = Date.now();
  await env.BUCKET.put(`novels/${id}/meta.json`, JSON.stringify({ id, title, author, description, hasCover, updatedAt, chapters }), { httpMetadata: { contentType: 'application/json' } });
  const idx = (await getIdx(env)).filter(b => b.id !== id);
  idx.unshift({ id, title, author, description: description.slice(0, 160), chapterCount: total, hasCover, updatedAt });
  await putIdx(env, idx);
  return J({ ok: true, id, chapterCount: total });
}

async function unpublish(env, id) {
  const keys = await listKeys(env, `novels/${id}/`);
  for (let i = 0; i < keys.length; i += 1000) await env.BUCKET.delete(keys.slice(i, i + 1000));
  await putIdx(env, (await getIdx(env)).filter(b => b.id !== id));
  return J({ ok: true, deleted: keys.length });
}
