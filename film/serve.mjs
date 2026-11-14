// Serves the demo film and the site from one origin, so the film can drive the site's pages (scroll them, find a line
// of text to aim the camera at, keep them in light theme).
//   node film/serve.mjs            → http://localhost:3200/film/
//   /film/*  → this folder (with HTTP ranges, so the <audio> can seek)
//   else     → proxied to the running site (SITE, default http://localhost:3100; start it with NEXT_PUBLIC_CC_OFFLINE=1)
// No dependencies. Read-only: it never writes anything.
import http from 'node:http';
import net from 'node:net';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 3200);
const SITE = new URL(process.env.SITE ?? 'http://localhost:3100');
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm', '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

function serveFile(req, res, rel) {
  const file = normalize(join(ROOT, rel || 'index.html'));
  if (!file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) return void res.writeHead(403).end();
  let st;
  try {
    st = statSync(file);
  } catch {
    return void res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
  if (st.isDirectory()) return serveFile(req, res, join(rel, 'index.html'));
  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const head = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (m) {
    const start = m[1] ? Number(m[1]) : st.size - Number(m[2]);
    const end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
    if (start > end || start >= st.size) return void res.writeHead(416, { 'content-range': `bytes */${st.size}` }).end();
    res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
    return void (req.method === 'HEAD' ? res.end() : createReadStream(file, { start, end }).pipe(res));
  }
  res.writeHead(200, { ...head, 'content-length': st.size });
  req.method === 'HEAD' ? res.end() : createReadStream(file).pipe(res);
}

// the site sees itself (Host, Origin); frame-blocking headers are dropped so it can sit in the film's iframes
function siteHeaders(h) {
  const out = { ...h, host: SITE.host };
  if (out.origin) out.origin = SITE.origin;
  if (out.referer) out.referer = out.referer.replace(/^https?:\/\/[^/]+/, SITE.origin);
  return out;
}

const server = http.createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/film') return void res.writeHead(302, { location: '/film/' }).end(); // '/' is the site's home page
  if (path.startsWith('/film/')) return serveFile(req, res, decodeURIComponent(path.slice('/film/'.length)));
  const up = http.request({ host: SITE.hostname, port: SITE.port, method: req.method, path: req.url, headers: siteHeaders(req.headers) }, (r) => {
    const h = { ...r.headers };
    delete h['x-frame-options'];
    if (h['content-security-policy']) h['content-security-policy'] = String(h['content-security-policy']).replace(/frame-ancestors[^;]*;?/g, '');
    res.writeHead(r.statusCode ?? 502, h);
    r.pipe(res);
  });
  up.on('error', (e) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`site not reachable at ${SITE.origin}: ${e.message}`);
  });
  req.pipe(up);
});

// websockets (the dev server's hot reload) pass straight through
server.on('upgrade', (req, sock, head) => {
  const up = net.connect(Number(SITE.port), SITE.hostname, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [k, v] of Object.entries(siteHeaders(req.headers))) for (const x of [].concat(v)) lines.push(`${k}: ${x}`);
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head?.length) up.write(head);
    sock.pipe(up).pipe(sock);
  });
  up.on('error', () => sock.destroy());
  sock.on('error', () => up.destroy());
});

server.listen(PORT, () => console.log(`film: http://localhost:${PORT}/film/  (site proxied from ${SITE.origin})`));
