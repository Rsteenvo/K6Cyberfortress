/**
 * k6 Cyber-Fortress — Zero-Dependency Local Server & InfluxDB 1.8 CORS Proxy
 * Usage:
 *   node server.js
 * Then open http://localhost:4173
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 4173;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  // 1. CORS-free Proxy Endpoint for InfluxDB 1.8 / Grafana Datasource Proxy
  if (req.method === 'POST' && req.url === '/api/influx') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const { targetUrl, headers } = JSON.parse(body || '{}');
        if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid targetUrl' }));
          return;
        }

        const upstream = await fetch(targetUrl, {
          method: 'GET',
          headers: headers || { Accept: 'application/json' }
        });

        const text = await upstream.text();
        res.writeHead(upstream.status, {
          'Content-Type': upstream.headers.get('content-type') || 'application/json'
        });
        res.end(text);
      } catch (err) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 2. Static File Server
  const cleanUrl = (req.url || '/').split('?')[0];
  const relPath = cleanUrl === '/' ? '/index.html' : cleanUrl;
  const safePath = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(__dirname, safePath);

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
      res.end(err.code === 'ENOENT' ? '404 Not Found' : '500 Internal Error');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`\n⚡ k6 Cyber-Fortress Cinema running at: http://localhost:${PORT}\n`);
});
