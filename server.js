/*
 * Simulador BPMN - servidor local
 * ---------------------------------------------------------------
 * Servidor HTTP estatico + API de arquivos .bpmn.
 * Escrito apenas com modulos nativos do Node.js (zero dependencias
 * externas), para que o .bat consiga subir o servico mesmo sem
 * acesso a internet / registry npm.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DIAGRAMS_DIR = path.join(ROOT, 'diagramas');

// ---------------------------------------------------------------- args
function readArg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}
const START_PORT = parseInt(readArg('--port', process.env.PORT || '4000'), 10);
const OPEN_BROWSER = process.argv.indexOf('--no-open') === -1;

if (!fs.existsSync(DIAGRAMS_DIR)) fs.mkdirSync(DIAGRAMS_DIR, { recursive: true });

// ---------------------------------------------------------------- mime
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.bpmn': 'application/xml; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff'
};

function send(res, status, body, headers) {
  const h = Object.assign({ 'Cache-Control': 'no-store' }, headers || {});
  res.writeHead(status, h);
  res.end(body);
}
function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': MIME['.json'] });
}

/** Impede path traversal: so aceita nomes simples de arquivo .bpmn */
function safeDiagramName(name) {
  if (typeof name !== 'string' || !name.trim()) return null;
  const raw = name.trim();
  const base = path.basename(raw);
  if (base !== raw) return null;
  if (base.charAt(0) === '.') return null;
  if (!/\.(bpmn|xml)$/i.test(base)) return null;
  if (/[<>:"/\\|?*]/.test(base)) return null;
  for (var ci = 0; ci < base.length; ci++) if (base.charCodeAt(ci) < 32) return null;
  return base;
}

function listDiagrams() {
  return fs
    .readdirSync(DIAGRAMS_DIR)
    .filter(function (f) { return /\.(bpmn|xml)$/i.test(f); })
    .map(function (f) {
      const st = fs.statSync(path.join(DIAGRAMS_DIR, f));
      return { nome: f, tamanho: st.size, modificadoEm: st.mtime.toISOString() };
    })
    .sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
}

function readBody(req, limitBytes) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let total = 0;
    req.on('data', function (c) {
      total += c.length;
      if (total > limitBytes) {
        reject(new Error('Corpo da requisicao muito grande'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------- api
async function handleApi(req, res, parsed) {
  const route = parsed.pathname;

  if (route === '/api/ping') {
    return sendJson(res, 200, { ok: true, versao: '1.0.0', pasta: DIAGRAMS_DIR });
  }

  if (route === '/api/diagramas' && req.method === 'GET') {
    return sendJson(res, 200, { arquivos: listDiagrams() });
  }

  if (route === '/api/diagrama') {
    if (req.method === 'GET') {
      const nome = safeDiagramName(parsed.query.nome);
      if (!nome) return sendJson(res, 400, { erro: 'Nome de arquivo invalido.' });
      const file = path.join(DIAGRAMS_DIR, nome);
      if (!fs.existsSync(file)) return sendJson(res, 404, { erro: 'Arquivo nao encontrado: ' + nome });
      return send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME['.bpmn'] });
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      let payload;
      try {
        payload = JSON.parse(await readBody(req, 20 * 1024 * 1024));
      } catch (e) {
        return sendJson(res, 400, { erro: 'JSON invalido: ' + e.message });
      }
      const nome = safeDiagramName(payload.nome);
      if (!nome) return sendJson(res, 400, { erro: 'Nome de arquivo invalido (use .bpmn).' });
      if (typeof payload.xml !== 'string' || payload.xml.indexOf('<') === -1) {
        return sendJson(res, 400, { erro: 'Conteudo XML ausente ou invalido.' });
      }
      const file = path.join(DIAGRAMS_DIR, nome);
      const existia = fs.existsSync(file);
      if (existia) {
        // backup simples antes de sobrescrever
        const bkDir = path.join(DIAGRAMS_DIR, '_backup');
        if (!fs.existsSync(bkDir)) fs.mkdirSync(bkDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.copyFileSync(file, path.join(bkDir, nome.replace(/\.(bpmn|xml)$/i, '') + '.' + stamp + '.bpmn'));
      }
      fs.writeFileSync(file, payload.xml, 'utf8');
      return sendJson(res, 200, { ok: true, nome: nome, sobrescrito: existia });
    }
  }

  return sendJson(res, 404, { erro: 'Rota de API desconhecida: ' + route });
}

// ---------------------------------------------------------------- static
function serveStatic(req, res, parsed) {
  let rel = decodeURIComponent(parsed.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (file.indexOf(PUBLIC_DIR) !== 0) return send(res, 403, 'Acesso negado');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, 'Nao encontrado: ' + rel, { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  send(res, 200, fs.readFileSync(file), { 'Content-Type': type });
}

// ---------------------------------------------------------------- server
const server = http.createServer(function (req, res) {
  const parsed = url.parse(req.url, true);
  Promise.resolve()
    .then(function () {
      if (parsed.pathname.indexOf('/api/') === 0) return handleApi(req, res, parsed);
      return serveStatic(req, res, parsed);
    })
    .catch(function (err) {
      console.error('[erro]', err);
      if (!res.headersSent) sendJson(res, 500, { erro: String(err && err.message ? err.message : err) });
    });
});

function openBrowser(addr) {
  if (!OPEN_BROWSER) return;
  const spawn = require('child_process').spawn;
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', addr], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [addr], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [addr], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (e) { /* silencioso */ }
}

function listen(port, tentativas) {
  server.once('error', function (err) {
    if (err.code === 'EADDRINUSE' && tentativas > 0) {
      console.log('  porta ' + port + ' ocupada, tentando ' + (port + 1) + '...');
      listen(port + 1, tentativas - 1);
    } else {
      console.error('Falha ao iniciar o servidor:', err.message);
      process.exit(1);
    }
  });
  server.listen(port, '127.0.0.1', function () {
    const addr = 'http://localhost:' + port;
    console.log('');
    console.log('  ============================================');
    console.log('   SIMULADOR BPMN 2.0  -  servidor no ar');
    console.log('  ============================================');
    console.log('   Interface : ' + addr);
    console.log('   Diagramas : ' + DIAGRAMS_DIR);
    console.log('   Encerrar  : CTRL+C nesta janela');
    console.log('');
    openBrowser(addr);
  });
}

listen(START_PORT, 20);
