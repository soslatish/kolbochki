// Static server for build/yandex-build.
//   /sdk.js            mock Yandex SDK (404 when the page URL has nosdk=1, like opening the file locally)
//   /index-test.html   the shipped index.html with the debug handle window.__kolb switched back on
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2]);
const PORT = Number(process.argv[3] || 8765);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.woff2': 'font/woff2' };

function send(res, type, body) {
  res.writeHead(200, { 'content-type': type });
  res.end(body);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/sdk.js') {
    if ((req.headers.referer || '').includes('nosdk=1')) { res.writeHead(404); return res.end(); }
    return send(res, TYPES['.js'], fs.readFileSync(path.join(__dirname, 'mock-sdk.js')));
  }
  if (url.pathname === '/index-test.html') {
    const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    return send(res, TYPES['.html'], page.replace('if (0) window.__kolb', 'window.__kolb'));
  }
  const file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  send(res, TYPES[path.extname(file)] || 'application/octet-stream', fs.readFileSync(file));
}).listen(PORT, '127.0.0.1'); // local only: do not expose the build to the network
