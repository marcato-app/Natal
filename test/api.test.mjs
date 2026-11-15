// Testes do Worker (API + roteamento) contra SQLite real (node:sqlite),
// carregado com as mesmas migrações que vão pro D1.
//
//   node test/api.test.mjs

import worker, { setRelogio } from '../src/index.js';
import { TIPOS } from '../assets/js/regras.js';
import { bancoLocal, makeD1 } from '../scripts/d1-local.mjs';

const db = bancoLocal();

const assetHits = [];
const env = {
  DB: makeD1(db),
  ASSETS: { fetch: async (req) => { assetHits.push(new URL(req.url).pathname); return new Response('<html>jogo</html>', { headers: { 'Content-Type': 'text/html' } }); } },
};

let relogio = 1_800_000_000_000;
setRelogio(() => relogio);

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('ok    ' + label); }
  else { fail++; console.log('FAIL  ' + label + (detail !== undefined ? '  — ' + JSON.stringify(detail) : '')); }
}
async function call(method, path, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await worker.fetch(new Request('https://natal.test' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

// páginas
{
  const r = await call('GET', '/');
  check('/ vem dos assets', r.status === 200 && assetHits.includes('/'));
  check('/api desconhecida = 404', (await call('GET', '/api/nada')).status === 404);
}

// jogador novo
const novo = await call('POST', '/api/jogador');
const token = novo.data.token;
check('cria jogador com token', novo.status === 201 && /^[0-9a-f]{64}$/.test(token));
check('devolve a vila inicial', novo.data.vila.predios.length >= 3 && novo.data.vila.duendes.length === 3);
check('token não fica salvo em texto puro', !JSON.stringify(db.prepare('SELECT * FROM jogadores').all()).includes(token));

// autenticação
check('GET /api/vila sem token = 401', (await call('GET', '/api/vila')).status === 401);
check('token errado = 401', (await call('GET', '/api/vila', { token: 'f'.repeat(64) })).status === 401);
check('ações sem token = 401', (await call('POST', '/api/acoes', { body: { acoes: [{ tipo: 'contratar' }] } })).status === 401);

// produção acontece com o jogo fechado
{
  relogio += TIPOS.fabrica.prod.ciclo * 1000 * 2;
  const r = await call('GET', '/api/vila', { token });
  const fab = r.data.vila.predios.find(p => p.tipo === 'fabrica');
  check('vila avança no tempo do servidor', r.status === 200 && fab.prog >= 2, fab);
  check('devolve o relógio do servidor', r.data.agora === relogio);
}

// ações
{
  const fabId = novo.data.vila.predios.find(p => p.tipo === 'fabrica').id;
  const r = await call('POST', '/api/acoes', { token, body: { acoes: [
    { tipo: 'coletar', id: fabId },
    { tipo: 'construir', predio: 'padaria', x: 2, z: 12 },
    { tipo: 'construir', predio: 'padaria', x: 2, z: 12 },   // mesmo lugar: recusa
    { tipo: 'contratar' },
  ] } });
  check('aplica a fila de ações', r.status === 200 && r.data.resultados.length === 4);
  check('cada ação tem seu resultado', r.data.resultados.map(x => x.ok).join() === 'true,true,false,true', r.data.resultados);
  check('ação recusada traz o motivo', r.data.resultados[2].erro === 'Não cabe aqui');
  const salva = JSON.parse(db.prepare('SELECT estado, versao FROM vilas').get().estado);
  check('vila gravada no banco', salva.predios.some(p => p.tipo === 'padaria') && salva.duendes.length === 4);
  check('versão sobe a cada gravação', db.prepare('SELECT versao FROM vilas').get().versao === 2);
  const depois = await call('GET', '/api/vila', { token });
  check('GET devolve o que foi gravado', JSON.stringify(depois.data.vila.predios) === JSON.stringify(r.data.vila.predios));
}

// validação
check('lista vazia = 400', (await call('POST', '/api/acoes', { token, body: { acoes: [] } })).status === 400);
check('sem corpo = 400', (await call('POST', '/api/acoes', { token })).status === 400);
check('mais de 50 ações = 400', (await call('POST', '/api/acoes', { token, body: { acoes: Array(51).fill({ tipo: 'contratar' }) } })).status === 400);
{
  const r = await call('POST', '/api/acoes', { token, body: { acoes: [{ tipo: 'construir', predio: 'padaria', x: 'a', z: 1 }, 'lixo', { tipo: '__proto__' }] } });
  check('ações malformadas são recusadas sem quebrar', r.status === 200 && r.data.resultados.every(x => !x.ok));
}

// cada jogador tem a sua vila
{
  const outro = await call('POST', '/api/jogador');
  const r = await call('GET', '/api/vila', { token: outro.data.token });
  check('outro jogador começa do zero', r.data.vila.predios.every(p => p.tipo !== 'padaria'));
}

// conta e amigos
{
  const ana = await call('POST', '/api/jogador'), bia = await call('POST', '/api/jogador');
  const ta = ana.data.token, tb = bia.data.token;
  const eu = await call('GET', '/api/eu', { token: ta });
  check('jogador tem código de amigo de 6 letras', /^[A-Z0-9]{6}$/.test(eu.data.codigo));
  check('nome curto é recusado', (await call('PUT', '/api/eu', { token: ta, body: { nome: 'A' } })).status === 400);
  check('salva o nome', (await call('PUT', '/api/eu', { token: ta, body: { nome: 'Ana <script>' } })).data.nome === 'Ana script');
  await call('PUT', '/api/eu', { token: tb, body: { nome: 'Bia' } });
  const cb = (await call('GET', '/api/eu', { token: tb })).data.codigo;
  check('código errado não acha ninguém', (await call('POST', '/api/amigos', { token: ta, body: { codigo: 'ZZZZZZ' } })).status === 404);
  check('não adiciona a si mesmo', (await call('POST', '/api/amigos', { token: ta, body: { codigo: eu.data.codigo } })).status === 400);
  const add = await call('POST', '/api/amigos', { token: ta, body: { codigo: cb.toLowerCase() } });
  check('adiciona amigo pelo código (sem ligar pra maiúscula)', add.status === 201 && add.data.nome === 'Bia');
  const listaB = await call('GET', '/api/amigos', { token: tb });
  check('amizade vale nos dois sentidos', listaB.data.amigos.length === 1 && listaB.data.amigos[0].nome.startsWith('Ana'));
  const idB = add.data.id, idA = listaB.data.amigos[0].id;
  const rk = await call('GET', '/api/ranking', { token: ta });
  check('ranking traz eu e o amigo', rk.status === 200 && rk.data.ranking.length === 2 && rk.data.ranking.filter(x => x.eu).length === 1 && rk.data.evento.nome, rk.data);
  check('ranking pede login', (await call('GET', '/api/ranking')).status === 401);
  check('visita a vila do amigo', (await call('GET', `/api/amigos/${idB}/vila`, { token: ta })).data.vila.predios.length > 3);
  const estranho = await call('POST', '/api/jogador');
  check('não visita quem não é amigo', (await call('GET', `/api/amigos/${idB}/vila`, { token: estranho.data.token })).status === 404);
  check('manda presente', (await call('POST', `/api/amigos/${idB}/presente`, { token: ta })).status === 200);
  check('só um presente por dia pro mesmo amigo', (await call('POST', `/api/amigos/${idB}/presente`, { token: ta })).status === 409);
  check('amigo vê o presente pendente', (await call('GET', '/api/eu', { token: tb })).data.presentesPendentes === 1);
  const m0 = (await call('GET', '/api/vila', { token: tb })).data.vila.moedas;
  const res = await call('POST', '/api/presentes/resgatar', { token: tb });
  check('resgata presente e ganha moedas', res.data.quantos === 1 && res.data.vila.moedas - m0 === 30);
  check('não resgata de novo', (await call('POST', '/api/presentes/resgatar', { token: tb })).status === 400);
  // ajuda: adianta a produção da fábrica do amigo e dá moedas pra quem ajuda
  const vb = (await call('GET', '/api/vila', { token: tb })).data.vila, fabB = vb.predios.find(p => p.tipo === 'fabrica');
  const ma = (await call('GET', '/api/vila', { token: ta })).data.vila.moedas;
  const aj = await call('POST', `/api/amigos/${idB}/ajuda`, { token: ta, body: { predio: fabB.id } });
  check('ajuda adianta a produção do amigo', aj.status === 200 && aj.data.como === 'producao' && aj.data.vilaAmigo.predios.find(p => p.id === fabB.id).prog >= fabB.prog + 0.5 - 1e-9);
  check('quem ajuda ganha moedas', aj.data.vila.moedas - ma === 15);
  check('só uma ajuda por dia pro mesmo amigo', (await call('POST', `/api/amigos/${idB}/ajuda`, { token: ta, body: { predio: fabB.id } })).status === 409);
  check('dono não se ajuda pela fila de ações', !(await call('POST', '/api/acoes', { token: tb, body: { acoes: [{ tipo: 'ajuda', id: fabB.id }] } })).data.resultados[0].ok);
  // recuperação
  const rec = await call('POST', '/api/eu/recuperacao', { token: ta });
  check('gera código de recuperação XXXX-XXXX-XXXX', /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(rec.data.codigo));
  const outroAparelho = await call('POST', '/api/recuperar', { body: { codigo: rec.data.codigo.toLowerCase().replace(/-/g, ' ') } });
  check('abre a mesma vila em outro aparelho', outroAparelho.status === 200 && /^[0-9a-f]{64}$/.test(outroAparelho.data.token));
  check('token novo funciona', (await call('GET', '/api/eu', { token: outroAparelho.data.token })).data.id === idA);
  check('o aparelho antigo continua funcionando', (await call('GET', '/api/eu', { token: ta })).data.id === idA);
  check('código errado não abre nada', (await call('POST', '/api/recuperar', { body: { codigo: 'AAAA-AAAA-AAAA' } })).status === 404);
}

// CORS só pro app
{
  const pre = await worker.fetch(new Request('https://natal.test/api/acoes', { method: 'OPTIONS', headers: { Origin: 'capacitor://localhost' } }), env);
  check('preflight do app iOS ok', pre.status === 204 && pre.headers.get('Access-Control-Allow-Origin') === 'capacitor://localhost' && pre.headers.get('Access-Control-Allow-Headers').includes('Authorization'));
  const r = await worker.fetch(new Request('https://natal.test/api/vila', { headers: { Origin: 'https://localhost', Authorization: 'Bearer ' + token } }), env);
  check('resposta pro app Android traz CORS', r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === 'https://localhost');
  const x = await worker.fetch(new Request('https://natal.test/api/vila', { headers: { Origin: 'https://site-estranho.com', Authorization: 'Bearer ' + token } }), env);
  check('outro site não recebe CORS', !x.headers.get('Access-Control-Allow-Origin'));
}

console.log(`\n${pass} ok, ${fail} falharam`);
if (fail) process.exit(1);
