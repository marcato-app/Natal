import {
  novaVila, aplicar, avancar, MAX_ACOES, diaDe, nivelDe, meuEvento, eventoAtual,
  receberAjuda, darRecompensa, PRESENTE_AMIGO, RECOMPENSA_AJUDANTE,
} from '../assets/js/regras.js';

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
  const h = await sha256(m[1]);
  return env.DB.prepare(`SELECT id, nome, codigo FROM jogadores WHERE token_hash = ?1
    UNION ALL SELECT j.id, j.nome, j.codigo FROM sessoes s JOIN jogadores j ON j.id = s.jogador_id WHERE s.token_hash = ?1 LIMIT 1`).bind(h).first();
}

// Códigos legíveis (sem letras que confundem: 0/O, 1/I/L).
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function codigoAleatorio(n) {
  const b = new Uint8Array(n); crypto.getRandomValues(b);
  return [...b].map(x => ALFABETO[x % ALFABETO.length]).join('');
}
const normalizarCodigo = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Garante que o jogador tem código de amigo (contas antigas nascem sem).
async function garantirCodigo(env, j) {
  if (j.codigo) return j.codigo;
  for (let i = 0; i < 5; i++) {
    const c = codigoAleatorio(6);
    try { await env.DB.prepare('UPDATE jogadores SET codigo = ? WHERE id = ? AND codigo IS NULL').bind(c, j.id).run(); }
    catch { continue; } // colisão no índice único: tenta outro
    const row = await env.DB.prepare('SELECT codigo FROM jogadores WHERE id = ?').bind(j.id).first();
    if (row.codigo) return (j.codigo = row.codigo);
  }
  throw new Error('sem código');
}

// Lê, muda e grava uma vila com controle de versão (tenta de novo se outra gravação passou na frente).
async function mudarVila(env, jogadorId, fn) {
  for (let t = 0; t < 3; t++) {
    const row = await env.DB.prepare('SELECT estado, versao FROM vilas WHERE jogador_id = ?').bind(jogadorId).first();
    if (!row) return null;
    const vila = JSON.parse(row.estado), agora = relogio();
    const resultado = fn(vila, agora);
    if (resultado && resultado.ok === false) return { vila, resultado };
    const r = await env.DB.prepare('UPDATE vilas SET estado = ?, versao = versao + 1, atualizado_em = ? WHERE jogador_id = ? AND versao = ?')
      .bind(JSON.stringify(vila), agora, jogadorId, row.versao).run();
    if (r.meta.changes === 1) return { vila, resultado, agora };
  }
  throw new Error('vila ocupada');
}
const saoAmigos = (env, a, b) => env.DB.prepare('SELECT 1 FROM amizades WHERE a = ? AND b = ?').bind(a, b).first();

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
    env.DB.prepare('INSERT INTO jogadores (id, token_hash, codigo, criado_em, visto_em) VALUES (?, ?, ?, ?, ?)').bind(id, await sha256(token), codigoAleatorio(6), agora, agora),
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

/* ------------------------------ conta e amigos ------------------------------ */

route('GET', '/api/eu', async (request, env) => {
  const j = await jogadorDoToken(request, env);
  if (!j) return unauthorized();
  const codigo = await garantirCodigo(env, j);
  const pend = await env.DB.prepare('SELECT COUNT(*) AS n FROM presentes WHERE para = ? AND resgatado_em IS NULL').bind(j.id).first();
  return json({ id: j.id, nome: j.nome, codigo, presentesPendentes: pend.n });
});

route('PUT', '/api/eu', async (request, env) => {
  const j = await jogadorDoToken(request, env);
  if (!j) return unauthorized();
  const body = await readJson(request);
  const nome = String(body?.nome ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24);
  if (nome.length < 2) return badRequest('O nome precisa ter pelo menos 2 letras');
  await env.DB.prepare('UPDATE jogadores SET nome = ? WHERE id = ?').bind(nome, j.id).run();
  return json({ nome });
});

// Gera um novo código de recuperação (o anterior deixa de valer). Só aparece nesta resposta.
route('POST', '/api/eu/recuperacao', async (request, env) => {
  const j = await jogadorDoToken(request, env);
  if (!j) return unauthorized();
  const cru = codigoAleatorio(12), codigo = cru.match(/.{4}/g).join('-');
  await env.DB.prepare('UPDATE jogadores SET recuperacao_hash = ? WHERE id = ?').bind(await sha256('rec:' + cru), j.id).run();
  return json({ codigo });
});

// Abre a vila em outro aparelho: troca o código de recuperação por um token novo.
route('POST', '/api/recuperar', async (request, env) => {
  const body = await readJson(request);
  const cru = normalizarCodigo(body?.codigo);
  if (cru.length !== 12) return badRequest('Código inválido');
  const j = await env.DB.prepare('SELECT id FROM jogadores WHERE recuperacao_hash = ?').bind(await sha256('rec:' + cru)).first();
  if (!j) return json({ error: 'Código não encontrado' }, { status: 404 });
  const token = randomToken();
  await env.DB.prepare('INSERT INTO sessoes (token_hash, jogador_id, criado_em) VALUES (?, ?, ?)').bind(await sha256(token), j.id, relogio()).run();
  const row = await env.DB.prepare('SELECT estado FROM vilas WHERE jogador_id = ?').bind(j.id).first();
  const vila = JSON.parse(row.estado), agora = relogio();
  avancar(vila, agora);
  return json({ token, vila, agora });
});

route('GET', '/api/amigos', async (request, env) => {
  const j = await jogadorDoToken(request, env);
  if (!j) return unauthorized();
  const dia = diaDe(relogio());
  const { results } = await env.DB.prepare(`
    SELECT p.id, p.nome, p.codigo, p.visto_em, v.estado,
      EXISTS(SELECT 1 FROM presentes WHERE de = ?1 AND para = p.id AND dia = ?2) AS presenteou,
      EXISTS(SELECT 1 FROM ajudas WHERE de = ?1 AND para = p.id AND dia = ?2) AS ajudou
    FROM amizades a JOIN jogadores p ON p.id = a.b JOIN vilas v ON v.jogador_id = p.id
    WHERE a.a = ?1 ORDER BY p.visto_em DESC LIMIT 200`).bind(j.id, dia).all();
  return json({ amigos: results.map(r => ({ id: r.id, nome: r.nome || 'Vizinho', codigo: r.codigo, vistoEm: r.visto_em, nivel: nivelDe(JSON.parse(r.estado).alegria), podePresentear: !r.presenteou, podeAjudar: !r.ajudou })) });
});

// Ranking: eu + amigos, pelos pontos do evento da semana (e alegria total pra desempate).
route('GET', '/api/ranking', async (request, env) => {
  const j = await jogadorDoToken(request, env);
  if (!j) return unauthorized();
  const agora = relogio();
  const { results } = await env.DB.prepare(`
    SELECT p.id, p.nome, v.estado FROM jogadores p JOIN vilas v ON v.jogador_id = p.id
    WHERE p.id = ?1 OR p.id IN (SELECT b FROM amizades WHERE a = ?1) LIMIT 201`).bind(j.id).all();
  const lista = results.map(r => {
    const vila = JSON.parse(r.estado);
    return { id: r.id, nome: r.nome || 'Vizinho', eu: r.id === j.id, nivel: nivelDe(vila.alegria), alegria: Math.floor(vila.alegria), pontos: meuEvento(vila, agora).pontos };
  }).sort((a, b) => b.pontos - a.pontos || b.alegria - a.alegria);
  const ev = eventoAtual(agora);
  return json({ evento: { nome: ev.nome, fim: ev.fim }, ranking: lista });
});

route('POST', '/api/amigos', async (request, env) => {
  const j = await jogadorDoToken(request, env);
  if (!j) return unauthorized();
  const body = await readJson(request);
  const codigo = normalizarCodigo(body?.codigo);
  const outro = codigo && await env.DB.prepare('SELECT id, nome FROM jogadores WHERE codigo = ?').bind(codigo).first();
  if (!outro) return json({ error: 'Não achei ninguém com esse código' }, { status: 404 });
  if (outro.id === j.id) return badRequest('Esse é o seu próprio código');
  const agora = relogio();
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO amizades (a, b, criado_em) VALUES (?, ?, ?)').bind(j.id, outro.id, agora),
    env.DB.prepare('INSERT OR IGNORE INTO amizades (a, b, criado_em) VALUES (?, ?, ?)').bind(outro.id, j.id, agora),
  ]);
  return json({ id: outro.id, nome: outro.nome || 'Vizinho' }, { status: 201 });
});

route('GET', '/api/amigos/:id/vila', async (request, env, { id }) => {
  const j = await jogadorDoToken(request, env);
  if (!j) return unauthorized();
  if (!await saoAmigos(env, j.id, id)) return notFound();
  const row = await env.DB.prepare('SELECT v.estado, p.nome FROM vilas v JOIN jogadores p ON p.id = v.jogador_id WHERE v.jogador_id = ?').bind(id).first();
  const vila = JSON.parse(row.estado), agora = relogio();
  avancar(vila, agora);
  return json({ nome: row.nome || 'Vizinho', vila, agora });
});

route('POST', '/api/amigos/:id/presente', async (request, env, { id }) => {
  const j = await jogadorDoToken(request, env);
  if (!j) return unauthorized();
  if (!await saoAmigos(env, j.id, id)) return notFound();
  const agora = relogio();
  const r = await env.DB.prepare('INSERT OR IGNORE INTO presentes (de, para, dia, criado_em) VALUES (?, ?, ?, ?)').bind(j.id, id, diaDe(agora), agora).run();
  if (r.meta.changes !== 1) return json({ error: 'Você já mandou presente pra esse amigo hoje' }, { status: 409 });
  return json({ ok: true });
});

route('POST', '/api/amigos/:id/ajuda', async (request, env, { id }) => {
  const j = await jogadorDoToken(request, env);
  if (!j) return unauthorized();
  if (!await saoAmigos(env, j.id, id)) return notFound();
  const body = await readJson(request);
  const predio = String(body?.predio || '');
  const agora = relogio(), dia = diaDe(agora);
  if (await env.DB.prepare('SELECT 1 FROM ajudas WHERE de = ? AND para = ? AND dia = ?').bind(j.id, id, dia).first()) {
    return json({ error: 'Você já ajudou esse amigo hoje' }, { status: 409 });
  }
  const feito = await mudarVila(env, id, (vila, t) => receberAjuda(vila, predio, t));
  if (!feito || feito.resultado.ok === false) return badRequest(feito ? feito.resultado.erro : 'Vila não encontrada');
  await env.DB.prepare('INSERT OR IGNORE INTO ajudas (de, para, dia, predio, criado_em) VALUES (?, ?, ?, ?, ?)').bind(j.id, id, dia, predio, agora).run();
  const minha = await mudarVila(env, j.id, (vila, t) => darRecompensa(vila, RECOMPENSA_AJUDANTE, t));
  return json({ ok: true, como: feito.resultado.como, vilaAmigo: feito.vila, recompensa: RECOMPENSA_AJUDANTE, vila: minha.vila, agora: minha.agora });
});

route('GET', '/api/presentes', async (request, env) => {
  const j = await jogadorDoToken(request, env);
  if (!j) return unauthorized();
  const { results } = await env.DB.prepare('SELECT p.nome, pr.dia FROM presentes pr JOIN jogadores p ON p.id = pr.de WHERE pr.para = ? AND pr.resgatado_em IS NULL ORDER BY pr.criado_em LIMIT 50').bind(j.id).all();
  return json({ presentes: results.map(r => ({ de: r.nome || 'Vizinho', dia: r.dia })), premio: PRESENTE_AMIGO });
});

route('POST', '/api/presentes/resgatar', async (request, env) => {
  const j = await jogadorDoToken(request, env);
  if (!j) return unauthorized();
  const agora = relogio();
  const r = await env.DB.prepare('UPDATE presentes SET resgatado_em = ? WHERE para = ? AND resgatado_em IS NULL').bind(agora, j.id).run();
  const n = r.meta.changes;
  if (!n) return badRequest('Nenhum presente pra abrir');
  const premio = Object.fromEntries(Object.entries(PRESENTE_AMIGO).map(([k, q]) => [k, q * n]));
  const feito = await mudarVila(env, j.id, (vila, t) => darRecompensa(vila, premio, t));
  return json({ ok: true, quantos: n, ganho: premio, vila: feito.vila, agora: feito.agora });
});

/* ------------------------------ entrada ------------------------------ */

// O app (Capacitor) roda a página em capacitor://localhost (iOS) ou https://localhost
// (Android) e chama a API deste domínio: só essas origens recebem CORS.
const ORIGENS_APP = new Set(['capacitor://localhost', 'https://localhost', 'http://localhost']);
function comCors(res, origem) {
  if (!ORIGENS_APP.has(origem)) return res;
  const out = new Response(res.body, res);
  out.headers.set('Access-Control-Allow-Origin', origem);
  out.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  out.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  out.headers.set('Access-Control-Max-Age', '86400');
  out.headers.append('Vary', 'Origin');
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const origem = request.headers.get('Origin') || '';
      if (request.method === 'OPTIONS') return comCors(new Response(null, { status: 204 }), origem);
      const match = matchRoute(request.method, url.pathname);
      if (!match) return comCors(notFound(), origem);
      try {
        return comCors(await match.handler(request, env, match.params), origem);
      } catch (err) {
        console.error(err);
        return comCors(json({ error: 'Erro interno' }, { status: 500 }), origem);
      }
    }
    // modelos 3D (.glb) ficam no R2: são grandes demais pro pacote do Worker
    if (env.MODELOS && request.method === 'GET' && url.pathname.startsWith('/assets/modelos/')) {
      const obj = await env.MODELOS.get(url.pathname.slice('/assets/modelos/'.length));
      if (obj) return new Response(obj.body, { headers: { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'public, max-age=86400', ETag: obj.httpEtag } });
    }
    return env.ASSETS.fetch(request);
  },
};
