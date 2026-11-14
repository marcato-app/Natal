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

console.log(`\n${pass} ok, ${fail} falharam`);
if (fail) process.exit(1);
