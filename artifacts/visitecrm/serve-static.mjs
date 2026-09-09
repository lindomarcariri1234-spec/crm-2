import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, 'dist', 'public');
const INDEX_FILE = path.join(ROOT, 'index.html');
const PORT = parseInt(process.env.PORT || '19951', 10);
const EXPECTED_STOREFRONT_TITLE = 'VisiteCRM — CRM para Agências de Viagem';

function assertStorefrontBuild() {
  let html;
  try {
    html = fs.readFileSync(INDEX_FILE, 'utf8');
  } catch (error) {
    throw new Error(`[storefront] Published index.html is unavailable at ${INDEX_FILE}: ${error.message}`);
  }
  if (!html.includes(EXPECTED_STOREFRONT_TITLE)) {
    throw new Error(
      `[storefront] Published index.html is missing the expected title marker: "${EXPECTED_STOREFRONT_TITLE}"`,
    );
  }
}

assertStorefrontBuild();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
};

const server = http.createServer((req, res) => {
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  let filePath = path.join(ROOT, urlPath);

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch {
    filePath = path.join(ROOT, 'index.html');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      const fallback = path.join(ROOT, 'index.html');
      fs.readFile(fallback, (err2, html) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
        }
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Static file server listening on port ${PORT}`);
});
