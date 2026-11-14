// O jogo no navegador: carrega a vila, desenha (cena.js), trata toques e painéis, e
// manda as ações pro servidor. Cada ação é aplicada aqui na hora com as mesmas
// regras do Worker (regras.js); o servidor confere e devolve a vila oficial.

import {
  TIPOS, CATEGORIAS, CUSTO_DUENDE, ESTOQUE_MAX,
  novaVila, aplicar, avancar, cabe, predio, duendesEm, moradia, prontos, podePagar,
  nivelDe, progressoNivel, alegriaAoConstruir,
} from './regras.js';
import { criarCena } from './cena.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.floor(n).toLocaleString('pt-BR');
const ICONE = { moedas: 'i-moedas', doces: 'i-doces', alegria: 'i-alegria' };
const svg = (id, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
const NOME_RECURSO = { moedas: 'moedas', doces: 'doces', alegria: 'alegria' };

/* ------------------------------ estado e servidor ------------------------------ */

const LS_TOKEN = 'natal.token', LS_VILA = 'natal.vila', LS_FILA = 'natal.fila';
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sem armazenamento: segue sem cache */ } },
};

let estado = null;        // a vila como o jogador vê agora
let offset = 0;           // relógio do servidor - relógio local
let online = false;       // false = sem servidor (arquivo aberto direto, ou fora do ar)
let fila = [];            // ações ainda não confirmadas pelo servidor
let enviando = false;
const agora = () => Date.now() + offset;

async function api(method, path, body) {
  const token = ls.get(LS_TOKEN);
  const r = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  return r.json();
}

function receber(res) {
  offset = res.agora - Date.now();
  estado = res.vila;
  for (const a of fila) aplicar(estado, a, agora());
  guardar();
}
function guardar() {
  ls.set(LS_VILA, JSON.stringify(estado));
  ls.set(LS_FILA, JSON.stringify(fila));
}

async function carregar() {
  try { fila = JSON.parse(ls.get(LS_FILA) || '[]'); } catch { fila = []; }
  try {
    if (ls.get(LS_TOKEN)) {
      try { receber(await api('GET', '/api/vila')); online = true; return; }
      catch (e) { if (e.status !== 401 && e.status !== 404) throw e; }
    }
    const res = await api('POST', '/api/jogador');
    ls.set(LS_TOKEN, res.token);
    fila = [];
    receber(res); online = true;
  } catch {
    // Sem servidor: joga com a cópia local e tenta mandar a fila depois.
    online = false;
    try { estado = JSON.parse(ls.get(LS_VILA)); } catch { estado = null; }
    if (!estado || !estado.predios) { estado = novaVila(Date.now()); fila = []; }
    guardar();
  }
}

let timerEnvio = null;
function agendarEnvio(ms = 800) { clearTimeout(timerEnvio); timerEnvio = setTimeout(enviar, ms); }
async function enviar() {
  if (enviando || !fila.length || !ls.get(LS_TOKEN)) return;
  enviando = true;
  const lote = fila.slice(0, 50);
  try {
    const res = await api('POST', '/api/acoes', { acoes: lote });
    fila = fila.slice(lote.length);
    const recusadas = res.resultados.filter(r => !r.ok);
    receber(res);
    online = true;
    if (recusadas.length) toast(recusadas[0].erro);
    desenhar();
  } catch (e) {
    online = false;
    if (e.status === 401) { fila = []; ls.set(LS_TOKEN, ''); }
  } finally {
    enviando = false;
    if (fila.length) agendarEnvio(online ? 300 : 8000);
  }
}

// Executa uma ação: aplica na hora e põe na fila pro servidor.
function agir(acao) {
  const nivelAntes = nivelDe(estado.alegria);
  const r = aplicar(estado, acao, agora());
  if (!r.ok) { toast(r.erro); return r; }
  fila.push(acao);
  guardar();
  agendarEnvio();
  const nivelDepois = nivelDe(estado.alegria);
  if (nivelDepois > nivelAntes) subiuNivel(nivelDepois);
  desenhar();
  return r;
}

/* ------------------------------ interface ------------------------------ */

let cena, thumbs = {};
let selecionado = null;           // id do prédio com painel aberto
let painel = null;                // 'construir' | 'predio' | 'duendes' | 'amigos' | null
let colocando = null;             // { tipo, x, z, r, moverId? }
let abaConstrucao = 'casas';
let vendaPendente = false;

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2600);
}

function subiuNivel(n) {
  const novos = Object.values(TIPOS).filter(t => t.cat && t.nivel === n).map(t => t.nome);
  toast(`Nível ${n}!` + (novos.length ? ` Liberou: ${novos.join(', ')}` : ''));
}

function custoHtml(custo) {
  return Object.entries(custo).map(([r, q]) => `<span class="${(estado[r] || 0) < q ? 'falta' : ''}">${svg(ICONE[r])}${fmt(q)}</span>`).join('');
}

let ultimos = {};
function desenharHud() {
  const pn = progressoNivel(estado.alegria);
  $('nivel').textContent = pn.nivel;
  if (pn.proximo == null) { $('xp-barra').style.width = '100%'; $('xp-texto').textContent = `${fmt(estado.alegria)} alegria · nível máximo`; }
  else {
    $('xp-barra').style.width = `${Math.min(100, (estado.alegria - pn.atual) / (pn.proximo - pn.atual) * 100)}%`;
    $('xp-texto').textContent = `${fmt(estado.alegria)} / ${fmt(pn.proximo)} alegria`;
  }
  for (const r of ['moedas', 'doces', 'alegria']) {
    const el = $('r-' + r), v = Math.floor(estado[r]);
    if (ultimos[r] !== undefined && v > ultimos[r]) { el.parentElement.classList.remove('pulse'); void el.offsetWidth; el.parentElement.classList.add('pulse'); }
    ultimos[r] = v; el.textContent = fmt(v);
  }
  $('nav-duendes').textContent = `Duendes ${estado.duendes.length}/${moradia(estado)}`;
}

function desenhar() {
  cena.sincronizar(estado);
  desenharHud();
  if (painel === 'predio') desenharPredio();
  if (painel === 'duendes') desenharDuendes();
  if (painel === 'construir') desenharCards();
  sincBaloes();
}

/* ---------- painéis ---------- */

function abrir(qual) {
  if (colocando) return;
  painel = qual;
  for (const p of ['construir', 'predio', 'duendes', 'amigos']) $('sheet-' + p).hidden = p !== qual;
  $('nav').hidden = !!qual;
  if (qual !== 'predio') { selecionado = null; cena.setSelecionado(null); }
  if (qual === 'construir') { desenharAbas(); desenharCards(); }
  if (qual === 'duendes') desenharDuendes();
  if (qual === 'predio') { vendaPendente = false; desenharPredio.chave = null; desenharPredio(); }
}
function fechar() { abrir(null); }

document.addEventListener('click', (e) => {
  const ab = e.target.closest('[data-abrir]'); if (ab) { abrir(ab.dataset.abrir); return; }
  if (e.target.closest('[data-fechar]')) fechar();
});

// Construir
function desenharAbas() {
  $('tabs').innerHTML = CATEGORIAS.map(c => `<button type="button" data-aba="${c.id}" aria-pressed="${c.id === abaConstrucao}">${c.nome}</button>`).join('');
}
$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-aba]'); if (!b) return;
  abaConstrucao = b.dataset.aba; desenharAbas(); desenharCards();
});
function desenharCards() {
  const nivel = nivelDe(estado.alegria);
  $('cards').innerHTML = Object.entries(TIPOS).filter(([, t]) => t.cat === abaConstrucao).map(([k, t]) => {
    const travado = nivel < t.nivel;
    return `<button type="button" class="card ${travado ? 'locked' : ''}" data-tipo="${k}" ${travado ? 'aria-disabled="true"' : ''}>
      <img src="${thumbs[k] || ''}" alt="">
      ${travado ? `<span class="lock">${svg('i-cadeado')}Nível ${t.nivel}</span>` : ''}
      <b>${t.nome}</b>
      <span class="cost">${travado ? 'Bloqueado' : custoHtml(t.custo)}</span>
    </button>`;
  }).join('');
}
$('cards').addEventListener('click', (e) => {
  const c = e.target.closest('[data-tipo]'); if (!c) return;
  const tipo = c.dataset.tipo, t = TIPOS[tipo];
  if (nivelDe(estado.alegria) < t.nivel) { toast(`${t.nome} libera no nível ${t.nivel}`); return; }
  if (!podePagar(estado, t.custo)) { toast('Recursos insuficientes'); return; }
  comecarColocar({ tipo });
});

// Painel do prédio
function tempoTexto(seg) {
  seg = Math.max(0, Math.ceil(seg));
  const m = Math.floor(seg / 60), s = seg % 60;
  return m ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}
function desenharPredio() {
  const p = predio(estado, selecionado);
  if (!p) { fechar(); return; }
  const t = TIPOS[p.tipo];
  $('pd-thumb').src = thumbs[p.tipo] || '';
  $('pd-nome').textContent = t.nome;
  let corpo = '';
  if (t.prod) {
    const pr = t.prod, n = Math.min(duendesEm(estado, p.id), pr.vagas), k = prontos(p);
    const frac = (p.prog || 0) - k, cheio = k >= ESTOQUE_MAX;
    const falta = n ? (1 - frac) * pr.ciclo * pr.vagas / n : Infinity;
    const chave = JSON.stringify([p.id, p.r, k, n, cheio, estado.duendes.map(d => d.predio), vendaPendente]);
    if (chave === desenharPredio.chave && $('pd-timer')) {
      $('pd-timer').textContent = cheio || !n ? '' : tempoTexto(falta);
      $('pd-bar').style.width = `${cheio ? 100 : frac * 100}%`;
      return;
    }
    desenharPredio.chave = chave;
    $('pd-sub').textContent = `Produz ${pr.qtd} ${NOME_RECURSO[pr.recurso]} a cada ${tempoTexto(pr.ciclo)} com ${pr.vagas} duendes`;
    corpo += `<div class="prod">
      <div class="row"><b>${cheio ? 'Estoque cheio, colete!' : n ? `Próxima entrega: +${pr.qtd} ${NOME_RECURSO[pr.recurso]}` : 'Parado: sem duendes'}</b><span class="timer" id="pd-timer">${cheio || !n ? '' : tempoTexto(falta)}</span></div>
      <div class="bar"><i id="pd-bar" style="width:${cheio ? 100 : frac * 100}%"></i></div>
      <div class="row"><span class="sub">${n ? `${n} de ${pr.vagas} duendes · ${Math.round(n / pr.vagas * 100)}% da velocidade` : 'Coloque um duende pra começar'}</span>
      <span class="stock" aria-label="${k} de ${ESTOQUE_MAX} prontos">${Array.from({ length: ESTOQUE_MAX }, (_, i) => `<i class="${i < k ? 'on' : ''}">${i < k ? svg(ICONE[pr.recurso]) : ''}</i>`).join('')}</span></div>
    </div>`;
    const aqui = estado.duendes.filter(d => d.predio === p.id), livres = estado.duendes.filter(d => !d.predio);
    corpo += `<div class="slots">`;
    for (let i = 0; i < pr.vagas; i++) {
      const d = aqui[i];
      if (d) corpo += `<button type="button" class="slot" data-tirar="${d.id}" aria-label="Tirar ${d.nome} daqui">${svg('i-elfo')}${d.nome}<small>trabalhando</small>${svg('i-x', 'tirar')}</button>`;
      else if (livres.length) corpo += `<button type="button" class="slot empty" data-colocar="${livres[0].id}">+ Colocar<small>${livres[0].nome} está livre</small></button>`;
      else corpo += `<button type="button" class="slot empty" data-abrir="duendes">+ Duende<small>nenhum livre</small></button>`;
    }
    corpo += `</div>`;
  } else if (t.moradia) {
    const chave = JSON.stringify([p.id, p.r, estado.duendes.length, moradia(estado), vendaPendente]);
    if (chave === desenharPredio.chave) return;
    desenharPredio.chave = chave;
    $('pd-sub').textContent = `Moradia pra ${t.moradia} duendes`;
    corpo += `<p class="info">A vila tem lugar pra ${moradia(estado)} duendes e hoje tem ${estado.duendes.length}. Mais casas, mais duendes.</p>`;
  } else {
    const chave = JSON.stringify([p.id, p.r, vendaPendente]);
    if (chave === desenharPredio.chave) return;
    desenharPredio.chave = chave;
  }
  if (t.prod || t.moradia) { /* já preenchido acima */ }
  else if (p.tipo === 'praca') {
    $('pd-sub').textContent = 'O coração da vila';
    corpo += `<p class="info">Duendes sem trabalho passeiam por aqui.</p>`;
  } else {
    $('pd-sub').textContent = `Decoração · deu +${alegriaAoConstruir(p.tipo)} alegria`;
  }
  $('pd-corpo').innerHTML = corpo;

  const acoes = [];
  if (t.prod && prontos(p) >= 1) acoes.push(`<button type="button" class="cta gold" data-acao="coletar">Coletar +${prontos(p) * t.prod.qtd} ${svg(ICONE[t.prod.recurso])}</button>`);
  acoes.push(`<button type="button" class="act" data-acao="mover">${svg('i-mover')}Mover</button>`);
  acoes.push(`<button type="button" class="act" data-acao="girar">${svg('i-girar')}Girar</button>`);
  if (t.vendavel !== false) {
    const dev = Object.entries(t.custo).map(([r, q]) => `+${fmt(q / 2)} ${NOME_RECURSO[r]}`).join(' ');
    acoes.push(vendaPendente
      ? `<button type="button" class="act confirm" data-acao="vender-ok">Confirmar venda</button>`
      : `<button type="button" class="act danger" data-acao="vender">Vender ${dev}</button>`);
  }
  $('pd-acoes').innerHTML = acoes.join('');
  $('pd-acoes').firstElementChild?.classList.contains('cta') && ($('pd-acoes').firstElementChild.style.gridColumn = '1 / -1');
}
$('pd-corpo').addEventListener('click', (e) => {
  const tirar = e.target.closest('[data-tirar]'); if (tirar) { agir({ tipo: 'alocar', duende: tirar.dataset.tirar, predio: null }); return; }
  const col = e.target.closest('[data-colocar]'); if (col) agir({ tipo: 'alocar', duende: col.dataset.colocar, predio: selecionado });
});
$('pd-acoes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-acao]'); if (!b) return;
  const p = predio(estado, selecionado); if (!p) return;
  switch (b.dataset.acao) {
    case 'coletar': coletar(p.id); break;
    case 'mover': comecarColocar({ tipo: p.tipo, moverId: p.id, x: p.x, z: p.z, r: p.r }); break;
    case 'girar': agir({ tipo: 'mover', id: p.id, x: p.x, z: p.z, r: (p.r + 1) & 3 }); break;
    case 'vender': vendaPendente = true; desenharPredio(); break;
    case 'vender-ok': { const r = agir({ tipo: 'vender', id: p.id }); if (r.ok) { toast(`Vendido! ${Object.entries(r.ganho).map(([k, v]) => `+${fmt(v)} ${k}`).join(' ')}`); fechar(); } break; }
  }
});

// Duendes
function desenharDuendes() {
  const cap = moradia(estado), n = estado.duendes.length;
  $('dd-info').textContent = `${n} de ${cap} duendes. Duende livre passeia pela praça; coloque ele num prédio pelo painel do prédio.`;
  $('dd-lista').innerHTML = estado.duendes.map(d => {
    const p = d.predio && predio(estado, d.predio);
    return `<li><span class="av">${svg('i-elfo')}</span><span class="grow"><b>${d.nome}</b><br><span class="onde">${p ? 'Trabalhando: ' + TIPOS[p.tipo].nome : 'Livre'}</span></span>
      ${p ? `<button type="button" class="act" data-ver="${p.id}">Ver</button>` : ''}</li>`;
  }).join('');
  const btn = $('dd-contratar');
  if (n >= cap) { btn.disabled = true; btn.innerHTML = 'Construa uma casa pra mais duendes'; }
  else { btn.disabled = !podePagar(estado, CUSTO_DUENDE); btn.innerHTML = `Contratar duende · ${svg('i-doces')} ${CUSTO_DUENDE.doces}`; }
}
$('dd-lista').addEventListener('click', (e) => { const b = e.target.closest('[data-ver]'); if (b) selecionar(b.dataset.ver); });
$('dd-contratar').addEventListener('click', () => {
  const r = agir({ tipo: 'contratar' });
  if (r.ok) toast(`${estado.duendes.find(d => d.id === r.id).nome} chegou na vila!`);
});

function selecionar(id) {
  if (colocando) return;
  selecionado = id;
  abrir('predio');
  cena.setSelecionado(id);
}

/* ---------- coletar e balões ---------- */

function coletar(id) {
  const b = baloes.get(id), pos = b ? b.getBoundingClientRect() : null;
  const r = agir({ tipo: 'coletar', id });
  if (!r.ok) return;
  if (pos) {
    Object.entries(r.ganho).forEach(([rec, q], i) => {
      const el = document.createElement('div'); el.className = 'voa';
      el.innerHTML = `${svg(ICONE[rec])}+${fmt(q)}`;
      el.style.left = (pos.left + pos.width / 2) + 'px'; el.style.top = (pos.top - i * 26) + 'px';
      document.body.appendChild(el); setTimeout(() => el.remove(), 1300);
    });
  }
}

const baloes = new Map();
function sincBaloes() {
  const vivos = new Set();
  for (const p of estado.predios) {
    const pr = TIPOS[p.tipo].prod; if (!pr) continue;
    const k = prontos(p), n = duendesEm(estado, p.id);
    let html = null, cls = 'balao';
    if (k >= 1) html = `${svg(ICONE[pr.recurso])}+${fmt(k * pr.qtd)}`;
    else if (!n) { html = `${svg('i-sono')}sem duendes`; cls += ' parado'; }
    if (!html) continue;
    vivos.add(p.id);
    let el = baloes.get(p.id);
    if (!el) {
      el = document.createElement('button'); el.type = 'button';
      el.addEventListener('click', () => { if (!colocando) coletar(p.id); });
      $('baloes').appendChild(el); baloes.set(p.id, el);
    }
    if (el.innerHTML !== html) el.innerHTML = html;
    el.className = cls;
    el.setAttribute('aria-label', k >= 1 ? `Coletar ${fmt(k * pr.qtd)} ${NOME_RECURSO[pr.recurso]} de ${TIPOS[p.tipo].nome}` : `${TIPOS[p.tipo].nome} sem duendes`);
  }
  for (const [id, el] of baloes) if (!vivos.has(id)) { el.remove(); baloes.delete(id); }
}
function posicionarBaloes() {
  for (const [id, el] of baloes) {
    const top = cena.topoDe(id);
    const s = top && cena.projetar(top);
    const esconder = !s || !s.visivel || (colocando && colocando.moverId === id);
    el.style.visibility = esconder ? 'hidden' : 'visible';
    if (s) el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, calc(-100% - 8px))`;
  }
}

/* ---------- construir / mover ---------- */

function lugarLivre(tipo, perto) {
  const tam = TIPOS[tipo].tam;
  let melhor = null, md = Infinity;
  for (let x = 0; x <= 18 - tam; x++) for (let z = 0; z <= 18 - tam; z++) {
    if (!cabe(estado, x, z, tam)) continue;
    const d = (x + tam / 2 - perto.x) ** 2 + (z + tam / 2 - perto.z) ** 2;
    if (d < md) { md = d; melhor = { x, z }; }
  }
  return melhor;
}

function comecarColocar({ tipo, moverId = null, x, z, r = 0 }) {
  fechar();
  if (x === undefined) {
    const meio = cena.loteEm(innerWidth / 2, innerHeight * 0.58) || { fx: 9, fz: 13 };
    const l = lugarLivre(tipo, { x: meio.fx, z: meio.fz });
    if (!l) { toast('Não tem mais espaço na vila'); return; }
    ({ x, z } = l);
  }
  colocando = { tipo, moverId, x, z, r };
  $('nav').hidden = true; $('place').hidden = false;
  $('place-nome').textContent = (moverId ? 'Movendo: ' : '') + TIPOS[tipo].nome;
  cena.setGrade(true);
  if (moverId) cena.esconder(moverId);
  atualizarFantasma();
}
function atualizarFantasma() {
  const c = colocando, ok = cabe(estado, c.x, c.z, TIPOS[c.tipo].tam, c.moverId);
  cena.setFantasma(c.tipo, c.x, c.z, c.r, ok);
  $('place-ok').disabled = !ok;
}
function terminarColocar() {
  colocando = null;
  cena.setFantasma(null); cena.setGrade(false); cena.esconder(null);
  $('place').hidden = true; $('nav').hidden = false;
}
$('place-girar').addEventListener('click', () => { colocando.r = (colocando.r + 1) & 3; atualizarFantasma(); });
$('place-cancelar').addEventListener('click', terminarColocar);
$('place-ok').addEventListener('click', () => {
  const c = colocando;
  const r = c.moverId ? agir({ tipo: 'mover', id: c.moverId, x: c.x, z: c.z, r: c.r }) : agir({ tipo: 'construir', predio: c.tipo, x: c.x, z: c.z, r: c.r });
  if (!r.ok) return;
  terminarColocar();
  if (!c.moverId) {
    const t = TIPOS[c.tipo];
    toast(t.prod ? `${t.nome} construída! Coloque duendes nela.` : `${t.nome} construída! +${r.ganho.alegria} alegria`);
    if (t.prod) selecionar(r.id);
  }
});
function moverFantasmaPara(cx, cy) {
  const l = cena.loteEm(cx, cy); if (!l) return;
  const tam = TIPOS[colocando.tipo].tam;
  const x = Math.max(0, Math.min(18 - tam, Math.round(l.fx - tam / 2)));
  const z = Math.max(0, Math.min(18 - tam, Math.round(l.fz - tam / 2)));
  if (x !== colocando.x || z !== colocando.z) { colocando.x = x; colocando.z = z; atualizarFantasma(); }
}

/* ---------- toques na cena ---------- */

function ligarToques(canvas) {
  let down = null, arrastando = false;
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (colocando) {
      const l = cena.loteEm(e.clientX, e.clientY), tam = TIPOS[colocando.tipo].tam;
      if (l && l.fx >= colocando.x - 0.5 && l.fx <= colocando.x + tam + 0.5 && l.fz >= colocando.z - 0.5 && l.fz <= colocando.z + tam + 0.5) {
        arrastando = true; cena.controls.enabled = false;
      }
    }
  }, { capture: true });
  canvas.addEventListener('pointermove', (e) => { if (arrastando) moverFantasmaPara(e.clientX, e.clientY); });
  const up = (e) => {
    if (arrastando) { arrastando = false; cena.controls.enabled = true; down = null; return; }
    if (!down) return;
    const tap = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && performance.now() - down.t < 500;
    down = null;
    if (!tap) return;
    if (colocando) { moverFantasmaPara(e.clientX, e.clientY); return; }
    const id = cena.predioEm(e.clientX, e.clientY);
    if (id) {
      const p = predio(estado, id), pr = p && TIPOS[p.tipo].prod;
      if (pr && prontos(p) >= 1 && painel !== 'predio') coletar(id);
      else selecionar(id);
    } else if (painel) fechar();
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', () => { arrastando = false; cena.controls.enabled = true; down = null; });
}

/* ------------------------------ início ------------------------------ */

async function iniciar() {
  try {
    await carregar();
    cena = await criarCena($('cena'));
  } catch (err) {
    console.error(err);
    $('carregando').innerHTML = '<p>Não deu pra abrir a vila neste navegador (precisa de WebGL). Tente outro navegador ou ative a aceleração de hardware.</p>';
    return;
  }
  thumbs = cena.miniaturas(Object.keys(TIPOS));
  ligarToques($('cena'));
  desenhar();
  cena.aoQuadro(posicionarBaloes);
  $('carregando').classList.add('fora');
  if (!online) toast('Jogando sem conexão: o progresso fica salvo neste aparelho.');
  if (fila.length) agendarEnvio(500);

  // o tempo passa: produção anda e os balões aparecem
  setInterval(() => {
    avancar(estado, agora());
    desenharHud();
    sincBaloes();
    if (painel === 'predio') desenharPredio();
  }, 500);
  // de tempos em tempos busca a vila oficial (ex: aberta em outro aparelho)
  setInterval(async () => {
    if (!ls.get(LS_TOKEN) || fila.length || enviando) { if (fila.length) agendarEnvio(0); return; }
    try { receber(await api('GET', '/api/vila')); online = true; desenhar(); } catch { online = false; }
  }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') enviar(); });
}
iniciar();
