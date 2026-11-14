import { novaVila, aplicar, avancar, MAX_ACOES } from '../assets/js/regras.js';

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(init.headers || {}) },
  });
}
const badRequest = (message) => json({ error: message }, { status: 400 });
const unauthorized = () => json({ error: 'Não autenticado' }, { status: 401 });
const notFound = () => json({ error: 'Não encontrado' }, { status: 404 });

function genId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function randomToken() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

// O relógio do servidor é a referência; testes trocam por um falso.
let relogio = () => Date.now();
export function setRelogio(fn) { relogio = fn || (() => Date.now()); }

async function jogadorDoToken(request, env) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer ([0-9a-f]{64})$/);
  if (!m) return null;
  return env.DB.prepare('SELECT id, nome FROM jogadores WHERE token_hash = ?').bind(await sha256(m[1])).first();
}

/* ------------------------------ rotas ------------------------------ */

const routes = [];
function route(method, pattern, handler) {
  routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
}
function matchRoute(method, pathname) {
  const pathParts = pathname.split('/').filter(Boolean);
  for (const r of routes) {
    if (r.method !== method || r.parts.length !== pathParts.length) continue;
    const params = {};
    if (r.parts.every((p, i) => p.startsWith(':') ? (params[p.slice(1)] = decodeURIComponent(pathParts[i]), true) : p === pathParts[i])) {
      return { handler: r.handler, params };
    }
  }
  return null;
}

// Cria um jogador anônimo com a vila inicial. O token só aparece nesta resposta.
route('POST', '/api/jogador', async (request, env) => {
  const agora = relogio();
  const id = genId('j');
  const token = randomToken();
  const vila = novaVila(agora);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO jogadores (id, token_hash, criado_em, visto_em) VALUES (?, ?, ?, ?)').bind(id, await sha256(token), agora, agora),
    env.DB.prepare('INSERT INTO vilas (jogador_id, estado, versao, atualizado_em) VALUES (?, ?, 1, ?)').bind(id, JSON.stringify(vila), agora),
  ]);
  return json({ id, token, vila, agora }, { status: 201 });
});

route('GET', '/api/vila', async (request, env) => {
  const j = await jogadorDoToken(request, env);
  if (!j) return unauthorized();
  const row = await env.DB.prepare('SELECT estado FROM vilas WHERE jogador_id = ?').bind(j.id).first();
  if (!row) return notFound();
  const agora = relogio();
  const vila = JSON.parse(row.estado);
  avancar(vila, agora);
  await env.DB.prepare('UPDATE jogadores SET visto_em = ? WHERE id = ?').bind(agora, j.id).run();
  return json({ vila, agora });
});

// Recebe uma fila de ações, aplica uma a uma com o relógio do servidor e grava.
// Ação recusada não derruba as outras: cada uma volta com { ok, erro }.
route('POST', '/api/acoes', async (request, env) => {
  const j = await jogadorDoToken(request, env);
  if (!j) return unauthorized();
  const body = await readJson(request);
  const acoes = body && body.acoes;
  if (!Array.isArray(acoes) || acoes.length === 0) return badRequest('Envie uma lista de ações');
  if (acoes.length > MAX_ACOES) return badRequest(`No máximo ${MAX_ACOES} ações por vez`);

  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const row = await env.DB.prepare('SELECT estado, versao FROM vilas WHERE jogador_id = ?').bind(j.id).first();
    if (!row) return notFound();
    const agora = relogio();
    const vila = JSON.parse(row.estado);
    const resultados = acoes.map(a => aplicar(vila, a, agora));
    avancar(vila, agora);
    const res = await env.DB.prepare('UPDATE vilas SET estado = ?, versao = versao + 1, atualizado_em = ? WHERE jogador_id = ? AND versao = ?')
      .bind(JSON.stringify(vila), agora, j.id, row.versao).run();
    if (res.meta.changes === 1) return json({ vila, agora, resultados });
  }
  return json({ error: 'Vila ocupada, tente de novo' }, { status: 409 });
});

/* ------------------------------ entrada ------------------------------ */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const match = matchRoute(request.method, url.pathname);
      if (!match) return notFound();
      try {
        return await match.handler(request, env, match.params);
      } catch (err) {
        console.error(err);
        return json({ error: 'Erro interno' }, { status: 500 });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
