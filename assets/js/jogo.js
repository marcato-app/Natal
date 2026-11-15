// O jogo no navegador: carrega a vila, desenha (cena.js), trata toques e painéis, e
// manda as ações pro servidor. Cada ação é aplicada aqui na hora com as mesmas
// regras do Worker (regras.js); o servidor confere e devolve a vila oficial.

import {
  TIPOS, CATEGORIAS, CUSTO_DUENDE, ESTOQUE_MAX, ITENS,
  novaVila, aplicar, avancar, cabe, predio, duendesEm, moradia, moradiaDe, prontos, podePagar,
  nivelItem, bloqueioItem, aluguelDe, ALUGUEL_CICLO, PRESENTE_DOCES,
  ANUNCIO_ESTRELAS, ANUNCIO_ADIANTA, ANUNCIOS_POR_DIA, anunciosHoje,
  TERRENOS, MAPA_MIN, MAPA_MAX, terrenoLivre,
  presenteDeHoje, missoesAtivas, PRESENTE_DIARIO, ADVENTO, diaDe,
  emConstrucao, obrasDeConstrutor, construtores, custoAcelerar, TEMPO_ENFEITE, CUSTO_CONSTRUTOR, MAX_CONSTRUTORES, ESTRELAS_POR_NIVEL,
  nivelDe, progressoNivel, alegriaAoConstruir,
} from './regras.js';
import { criarCena } from './cena.js';
import * as som from './audio.js';
import * as anuncios from './anuncios.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.floor(n).toLocaleString('pt-BR');
const ICONE = { moedas: 'i-moedas', doces: 'i-doces', alegria: 'i-alegria', estrelas: 'i-estrela' };
const svg = (id, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
const NOME_RECURSO = { moedas: 'moedas', doces: 'doces', alegria: 'alegria' };

/* ------------------------------ estado e servidor ------------------------------ */

// No app (Capacitor) a página roda dentro do aparelho e fala com o servidor publicado.
const NATIVO = !!window.Capacitor?.isNativePlatform?.();
const API = NATIVO ? 'https://natal.flat-salad-71d3.workers.dev' : '';
const plugin = (n) => window.Capacitor?.Plugins?.[n] || window.Capacitor?.registerPlugin?.(n) || null;

// Armazenamento: no navegador, localStorage; no app, também o Preferences nativo (o
// iPhone pode limpar o localStorage de um app, o Preferences ele não limpa).
const LS_TOKEN = 'natal.token', LS_VILA = 'natal.vila', LS_FILA = 'natal.fila';
const memo = {};
let prefsNativo = null;
async function prepararArmazenamento() {
  prefsNativo = NATIVO ? plugin('Preferences') : null;
  if (!prefsNativo) return;
  for (const k of [LS_TOKEN, LS_VILA, LS_FILA]) {
    try { const { value } = await prefsNativo.get({ key: k }); if (value != null) memo[k] = value; } catch { /* segue com o localStorage */ }
  }
}
const ls = {
  get(k) { if (k in memo) return memo[k]; try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) {
    memo[k] = v;
    try { localStorage.setItem(k, v); } catch { /* sem armazenamento: segue sem cache */ }
    prefsNativo?.set({ key: k, value: v }).catch(() => {});
  },
};
const vibrar = () => { try { plugin('Haptics')?.impact({ style: 'LIGHT' }); } catch { /* sem vibração */ } };

let estado = null;        // a vila como o jogador vê agora
let offset = 0;           // relógio do servidor - relógio local
let online = false;       // false = sem servidor (arquivo aberto direto, ou fora do ar)
let fila = [];            // ações ainda não confirmadas pelo servidor
let enviando = false;
const agora = () => Date.now() + offset;

async function api(method, path, body) {
  const token = ls.get(LS_TOKEN);
  const r = await fetch(API + path, {
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
  await prepararArmazenamento();
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
  if (!r.ok) { toast(r.erro); som.tocar('erro'); return r; }
  fila.push(acao);
  guardar();
  agendarEnvio();
  const nivelDepois = nivelDe(estado.alegria);
  if (nivelDepois > nivelAntes) subiuNivel(nivelDepois);
  if (acao.tipo === 'construir' && r.obra || acao.tipo === 'melhorar') som.tocar('martelo');
  if (acao.tipo === 'acelerar') som.tocar('pronto');
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
  som.tocar('nivel');
  const novos = Object.values(TIPOS).filter(t => t.cat && t.nivel === n).map(t => t.nome);
  toast(`Nível ${n}! +${ESTRELAS_POR_NIVEL} estrelas` + (novos.length ? ` · Liberou: ${novos.join(', ')}` : ''));
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
  for (const r of ['moedas', 'doces', 'alegria', 'estrelas']) {
    const el = $('r-' + r), v = Math.floor(estado[r] || 0);
    if (ultimos[r] !== undefined && v > ultimos[r]) { el.parentElement.classList.remove('pulse'); void el.offsetWidth; el.parentElement.classList.add('pulse'); }
    ultimos[r] = v; el.textContent = fmt(v);
  }
  $('nav-duendes').textContent = `Duendes ${estado.duendes.length}/${moradia(estado)}`;
  const ativas = missoesAtivas(estado), prontaM = ativas.find(m => m.progresso(estado) >= m.meta);
  const m1 = prontaM || ativas[0];
  $('missao-texto').textContent = m1 ? (prontaM ? `Prêmio pronto: ${m1.texto}` : `${m1.texto} · ${Math.min(m1.progresso(estado), m1.meta)}/${m1.meta}`) : 'Todas as missões feitas!';
  $('missao-ponto').hidden = !prontaM;
  $('presente-ponto').hidden = !presenteDeHoje(estado, agora());
}

function sincCena() { cena.sincronizar(visitando ? visitando.vila : estado); }
function desenhar() {
  sincCena();
  desenharHud();
  if (painel === 'predio') desenharPredio();
  if (painel === 'duendes') desenharDuendes();
  if (painel === 'construir') desenharCards();
  if (dentro) { const c = predio(estado, dentro); if (c) { cena.sincSala(c); desenharCasa(); } else sair(); }
  sincBaloes();
}

/* ---------- painéis ---------- */

function abrir(qual) {
  if (colocando || dentro || (visitando && qual)) return;
  painel = qual;
  for (const p of ['construir', 'predio', 'duendes', 'amigos', 'missoes', 'presente', 'ajustes', 'boasvindas', 'loja', 'terreno']) $('sheet-' + p).hidden = p !== qual;
  $('nav').hidden = !!qual;
  if (qual !== 'predio') { selecionado = null; cena.setSelecionado(null); }
  if (qual === 'construir') { desenharAbas(); desenharCards(); }
  if (qual === 'duendes') desenharDuendes();
  if (qual === 'missoes') desenharMissoes();
  if (qual === 'presente') desenharPresente();
  if (qual === 'loja') desenharLoja();
  if (qual === 'amigos') abrirAmigos();
  if (qual === 'terreno') desenharTerreno();
  if (qual === 'ajustes') { const pf = som.preferencias(); $('aj-musica').checked = pf.musica; $('aj-sons').checked = pf.sons; $('aj-qualidade').value = String(cena.qualidade()); }
  if (qual === 'predio') { vendaPendente = false; desenharPredio.chave = null; desenharPredio(); }
  deslocarCena();
}
function fechar() { abrir(null); }

// Com painel aberto, a cena anda pro lado (tela larga) ou pra cima (celular).
function deslocarCena() {
  const aberto = painel === 'predio' || painel === 'construir' || !!dentro;
  if (!aberto) cena.setDeslocamento(0, 0);
  else if (innerWidth >= 900) cena.setDeslocamento(220, 0);
  else if (innerWidth > innerHeight) cena.setDeslocamento(Math.round(innerWidth * 0.22), 0); // deitado: painel na direita
  else cena.setDeslocamento(0, Math.round(innerHeight * (dentro ? 0.07 : 0.13)));
}
addEventListener('resize', () => cena && deslocarCena());

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
function desenharConstrutores() {
  const n = construtores(estado), ocup = obrasDeConstrutor(estado);
  const prox = n < MAX_CONSTRUTORES ? CUSTO_CONSTRUTOR[n] : null;
  $('construtores').innerHTML = `<div class="item-info"><b>Duendes construtores: ${n - ocup} livre${n - ocup === 1 ? '' : 's'} de ${n}</b><small>Cada um toca uma obra por vez</small></div>` +
    (prox != null ? `<button type="button" class="buy ${(estado.estrelas || 0) >= prox ? '' : 'caro'}" data-construtor>+ Construtor<span class="cost"><span>${svg('i-estrela')}${prox}</span></span></button>` : `<span class="completo">${svg('i-ok')}Equipe completa</span>`);
}
$('construtores').addEventListener('click', (e) => {
  if (!e.target.closest('[data-construtor]')) return;
  const r = agir({ tipo: 'construtor' });
  if (r.ok) toast('Novo duende construtor chegou!');
});
function desenharCards() {
  desenharConstrutores();
  const nivel = nivelDe(estado.alegria);
  $('cards').innerHTML = Object.entries(TIPOS).filter(([, t]) => t.cat === abaConstrucao).map(([k, t]) => {
    const travado = nivel < t.nivel;
    return `<button type="button" class="card ${travado ? 'locked' : ''}" data-tipo="${k}" ${travado ? 'aria-disabled="true"' : ''}>
      <img src="${thumbs[k] || ''}" alt="">
      ${travado ? `<span class="lock">${svg('i-cadeado')}Nível ${t.nivel}</span>` : ''}
      <b>${t.nome}</b>
      <span class="cost">${travado ? 'Bloqueado' : custoHtml(t.custo)}</span>
      ${!travado && t.tempo ? `<span class="tempo">${svg('i-relogio')}${tempoTexto(t.tempo)}</span>` : ''}
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
  if (emConstrucao(p)) {
    const rest = Math.max(0, (p.obra.fim - agora()) / 1000);
    const chave = JSON.stringify(['obra', p.id, Math.ceil(rest), Math.floor(estado.estrelas || 0), vendaPendente]);
    if (chave === desenharPredio.chave) return;
    desenharPredio.chave = chave;
    $('pd-sub').textContent = 'Em construção';
    corpo = blocoObra(p);
  } else if (t.prod) {
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
  } else {
    const chave = JSON.stringify([p.id, p.r, p.nv, p.itens, p.obra, p.obra ? Math.ceil((p.obra.fim - agora()) / 1000) : 0, prontos(p), Math.floor(estado.moedas), Math.floor(estado.doces), Math.floor(estado.estrelas || 0), nivelDe(estado.alegria), estado.duendes.length, vendaPendente]);
    if (chave === desenharPredio.chave) return;
    desenharPredio.chave = chave;
  }
  if (t.prod) { /* já preenchido acima */ }
  else if (emConstrucao(p)) { /* já preenchido acima */ }
  else if (p.tipo === 'casa') {
    const nv = p.nv || 1, m = t.melhorias[nv - 1];
    if (p.obra) corpo += blocoObra(p);
    $('pd-sub').textContent = `Nível ${nv} · abriga ${moradiaDe(p)} duendes`;
    let alvo;
    if (!m) alvo = `<span class="completo">${svg('i-ok')}Nível máximo</span>`;
    else if (nivelDe(estado.alegria) < m.nivelVila) alvo = `<span class="bloq">${svg('i-cadeado')}Vila nível ${m.nivelVila}</span>`;
    else if (p.obra) alvo = `<span class="bloq">${svg('i-relogio')}Em obra</span>`;
    else alvo = `<button type="button" class="buy ${podePagar(estado, m.custo) ? '' : 'caro'}" data-acao="melhorar">Aumentar <span class="cost">${custoHtml(m.custo)}</span><span class="tempo">${svg('i-relogio')}${tempoTexto(m.tempo)}</span></button>`;
    corpo += `<div class="melhoria"><div class="item-info"><b>Aumentar a casa</b><small>${m ? `Nível ${nv + 1}: ${t.moradia[nv]} duendes, ${nv === 1 ? 'uma ala nova' : 'segundo andar'} e mais móveis` : `A vila tem lugar pra ${moradia(estado)} duendes`}</small></div>${alvo}</div>`;
    const alu = aluguelDe(p);
    corpo += `<p class="info">${alu ? `Aluguel: +${alu} moedas e ${PRESENTE_DOCES} doces a cada ${tempoTexto(ALUGUEL_CICLO)}. O Papai Noel passa, deixa um presente e recolhe pra você. Mais enfeites, mais aluguel.` : 'Enfeite a fachada pra o Papai Noel passar aqui: ele deixa presente e recolhe o aluguel.'}</p>`;
    corpo += `<div class="secao">Fachada</div><div class="itens">${linhasItens(p, 'fachada')}</div>`;
    corpo += `<button type="button" class="cta largo" data-acao="entrar">Entrar e mobiliar</button>`;
  } else if (p.tipo === 'praca') {
    const it = p.itens || {}, total = Object.values(ITENS.praca).reduce((s2, d) => s2 + d.custos.length, 0), feitos = Object.keys(ITENS.praca).reduce((s2, k) => s2 + nivelItem(p, k), 0);
    $('pd-sub').textContent = p.obra ? `Os moradores estão pendurando: ${ITENS.praca[p.obra.item].nome}` : feitos === total ? 'Árvore completa!' : `Os moradores enfeitam a árvore: ${feitos} de ${total} enfeites`;
    if (p.obra) corpo += blocoObra(p);
    corpo += `<div class="itens">${linhasItens(p, 'arvore')}</div>`;
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
  const it = e.target.closest('[data-item]'); if (it) { comprarItem(selecionado, it.dataset.item); return; }
  const ac = e.target.closest('[data-acao]');
  if (ac && ac.dataset.acao === 'melhorar') { const r = agir({ tipo: 'melhorar', id: selecionado }); if (r.ok) toast('Os construtores começaram a aumentar a casa!'); return; }
  if (ac && ac.dataset.acao === 'video-obra') { verVideo('obra', selecionado); return; }
  if (ac && ac.dataset.acao === 'acelerar') { const r = agir({ tipo: 'acelerar', id: selecionado }); if (r.ok) { toast(`Pronto! −${r.custo} estrela${r.custo > 1 ? 's' : ''}`); desenharPredio.chave = null; desenharPredio(); } return; }
  if (ac && ac.dataset.acao === 'entrar') { entrar(selecionado); return; }
  const tirar = e.target.closest('[data-tirar]'); if (tirar) { agir({ tipo: 'alocar', duende: tirar.dataset.tirar, predio: null }); return; }
  const col = e.target.closest('[data-colocar]'); if (col) agir({ tipo: 'alocar', duende: col.dataset.colocar, predio: selecionado });
});
$('pd-acoes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-acao]'); if (!b) return;
  const p = predio(estado, selecionado); if (!p) return;
  switch (b.dataset.acao) {
    case 'coletar': coletar(p.id); break;
    case 'mover': comecarColocar({ tipo: p.tipo, moverId: p.id, x: p.x, z: p.z, r: p.r, modelo: p }); break;
    case 'girar': agir({ tipo: 'mover', id: p.id, x: p.x, z: p.z, r: (p.r + 1) & 3 }); break;
    case 'vender': vendaPendente = true; desenharPredio(); break;
    case 'vender-ok': { const r = agir({ tipo: 'vender', id: p.id }); if (r.ok) { toast(`Vendido! ${Object.entries(r.ganho).map(([k, v]) => `+${fmt(v)} ${k}`).join(' ')}`); fechar(); } break; }
  }
});

// Obra em andamento: cronômetro, barra e "terminar agora" com estrelas.
function blocoObra(p) {
  const o = p.obra, rest = Math.max(0, (o.fim - agora()) / 1000), t = TIPOS[p.tipo];
  const total = o.tipo === 'construir' ? t.tempo : o.tipo === 'melhorar' ? t.melhorias[(p.nv || 1) - 1].tempo : TEMPO_ENFEITE(nivelItem(p, o.item));
  const nome = o.tipo === 'construir' ? 'Os construtores estão erguendo o prédio' : o.tipo === 'melhorar' ? `Aumentando pro nível ${(p.nv || 1) + 1}` : `Moradores pendurando: ${ITENS.praca[o.item].nome}`;
  const custo = custoAcelerar(rest);
  return `<div class="prod"><div class="row"><b>${nome}</b><span class="timer">${tempoTexto(rest)}</span></div>
    <div class="bar"><i style="width:${Math.min(100, (1 - rest / Math.max(1, total)) * 100)}%"></i></div></div>
    <button type="button" class="cta gold largo" data-acao="acelerar" ${(estado.estrelas || 0) >= custo ? '' : 'disabled'}>Terminar agora · ${svg('i-estrela')} ${custo}</button>
    ${anuncios.disponivel() && rest > 30 && anunciosHoje(estado, agora()) < ANUNCIOS_POR_DIA ? `<button type="button" class="cta video largo" data-acao="video-obra">Assistir vídeo · −${ANUNCIO_ADIANTA / 60} min</button>` : ''}`;
}

// Missões
const premioHtml = (premio) => Object.entries(premio).map(([r, q]) => `<span>${svg(ICONE[r])}${fmt(q)}</span>`).join('');
function desenharMissoes() {
  const ativas = missoesAtivas(estado);
  $('ms-lista').innerHTML = ativas.length ? ativas.map(m => {
    const pr = Math.min(m.progresso(estado), m.meta), feita = pr >= m.meta;
    const botao = feita ? `<button type="button" class="buy" data-missao="${m.id}">Pegar<span class="cost">${premioHtml(m.premio)}</span></button>`
      : m.foco ? `<button type="button" class="buy caro" data-ir="${m.foco}">Ir<span class="cost">${premioHtml(m.premio)}</span></button>` : `<span class="bloq">${premioHtml(m.premio)}</span>`;
    return `<div class="item-row"><div class="item-info"><b>${m.texto}</b><div class="bar"><i style="width:${pr / m.meta * 100}%"></i></div><small>${pr} de ${m.meta}</small></div>${botao}</div>`;
  }).join('') : '<p class="info">Você completou todas as missões. Mais chegam em breve!</p>';
}
$('ms-lista').addEventListener('click', (e) => {
  const b = e.target.closest('[data-missao]');
  if (b) { const r = agir({ tipo: 'missao', id: b.dataset.missao }); if (r.ok) { som.tocar('presente'); toast(`Missão cumprida! ${Object.entries(r.ganho).map(([k, q]) => `+${fmt(q)} ${k}`).join(' ')}`); desenharMissoes(); } return; }
  const ir = e.target.closest('[data-ir]'); if (!ir) return;
  const f = ir.dataset.ir;
  if (f === 'construir' || f === 'duendes') abrir(f);
  else if (estado.predios.some(p => p.tipo === f)) selecionar(estado.predios.find(p => p.tipo === f).id);
  else { abrir('construir'); toast(`Construa: ${TIPOS[f]?.nome || f}`); }
});

// Presente do dia / Calendário do Advento
function desenharPresente() {
  const h = presenteDeHoje(estado, agora()), d = estado.diario || {};
  const hoje = new Date(agora() - 3 * 3600000), diaMes = hoje.getUTCDate(), dezembro = hoje.getUTCMonth() === 11 && diaMes <= 25;
  if (dezembro) {
    $('pr-titulo').textContent = 'Calendário do Advento';
    $('pr-sub').textContent = h ? `Dia ${diaMes}: abra a janelinha de hoje!` : `Volte amanhã pra abrir o dia ${diaMes + 1}`;
    $('pr-grade').className = 'calendario advento';
    $('pr-grade').innerHTML = ADVENTO.map((p, i) => { const n = i + 1, aberto = n < diaMes || (n === diaMes && !h); return `<div class="dia ${aberto ? 'aberto' : ''} ${n === diaMes ? 'hoje' : ''}"><b>${n}</b>${aberto ? svg('i-ok') : svg(ICONE[Object.keys(p)[Object.keys(p).length - 1]])}</div>`; }).join('');
  } else {
    const seq = h ? h.sequencia : (d.sequencia || 1), pos = (seq - 1) % 7;
    $('pr-titulo').textContent = 'Presente do dia';
    $('pr-sub').textContent = h ? `Dia ${seq} seguido: volte todo dia pra presentes maiores` : 'Você já abriu o de hoje. Volte amanhã!';
    $('pr-grade').className = 'calendario';
    $('pr-grade').innerHTML = PRESENTE_DIARIO.map((p, i) => { const aberto = i < pos || (i === pos && !h); return `<div class="dia ${aberto ? 'aberto' : ''} ${i === pos ? 'hoje' : ''}"><b>${i + 1}</b>${svg(ICONE[Object.keys(p)[0]])}<span>${fmt(Object.values(p)[0])}</span></div>`; }).join('');
  }
  const btn = $('pr-abrir');
  btn.disabled = !h;
  btn.innerHTML = h ? `Abrir presente <span class="cost">${premioHtml(h.premio)}</span>` : 'Volte amanhã';
}
$('pr-abrir').addEventListener('click', () => {
  const r = agir({ tipo: 'presente' });
  if (!r.ok) return;
  som.tocar('presente');
  toast(`${r.advento ? `Advento, dia ${r.advento}` : 'Presente do dia'}: ${Object.entries(r.ganho).map(([k, q]) => `+${fmt(q)} ${k}`).join(' ')}`);
  desenharPresente();
});

// Ajustes
$('aj-musica').addEventListener('change', (e) => { som.iniciar(); som.setMusica(e.target.checked); });
$('aj-sons').addEventListener('change', (e) => som.setSons(e.target.checked));
$('aj-qualidade').addEventListener('change', (e) => cena.setQualidade(Number(e.target.value)));
$('bv-ok').addEventListener('click', () => { try { localStorage.setItem('natal.boasvindas', '1'); } catch { /* ok */ } som.iniciar(); fechar(); });

// Terrenos (expansão do mapa)
let terrenoAberto = null;
function abrirTerreno(id) {
  terrenoAberto = TERRENOS.find(t => t.id === id);
  abrir('terreno');
}
function desenharTerreno() {
  const t = terrenoAberto; if (!t) return;
  const nv = nivelDe(estado.alegria);
  $('tr-info').textContent = `Aumenta a vila em ${t.w} × ${t.h} lotes pra construir mais casas, padarias e decorações.`;
  const btn = $('tr-comprar');
  if (t.nivel > nv) { btn.disabled = true; btn.innerHTML = `${svg('i-cadeado')} Libera no nível ${t.nivel}`; }
  else { btn.disabled = !podePagar(estado, t.custo); btn.innerHTML = `Comprar terreno · <span class="cost">${custoHtml(t.custo)}</span>`; }
}
$('tr-comprar').addEventListener('click', () => {
  const r = agir({ tipo: 'terreno', id: terrenoAberto.id });
  if (r.ok) { som.tocar('nivel'); toast('Terreno comprado! A vila cresceu.'); fechar(); }
});

// Amigos
let eu = null, amigos = [], visitando = null;
const SITE = 'https://natal.flat-salad-71d3.workers.dev';
async function abrirAmigos() {
  const sem = !ls.get(LS_TOKEN);
  try {
    eu = await api('GET', '/api/eu');
    $('am-offline').hidden = true; $('am-conteudo').hidden = false;
  } catch { $('am-offline').hidden = false; $('am-conteudo').hidden = true; return; }
  if (sem) return;
  $('am-nome').value = eu.nome || '';
  $('am-meu-codigo').textContent = eu.codigo;
  await carregarAmigos();
}
async function carregarAmigos() {
  try { amigos = (await api('GET', '/api/amigos')).amigos; } catch { amigos = []; }
  const pend = eu?.presentesPendentes || 0;
  $('am-presentes').innerHTML = pend ? `<div class="melhoria"><div class="item-info"><b>${pend} presente${pend > 1 ? 's' : ''} de amigos!</b><small>Moedas e doces esperando por você</small></div><button type="button" class="buy" id="am-abrir-presentes">Abrir</button></div>` : '';
  $('am-lista').innerHTML = amigos.length ? amigos.map(a => `<div class="item-row"><div class="item-info"><b>${esc(a.nome)}</b><small>Nível ${a.nivel} · ${a.codigo}</small></div>
    <div class="amigo-acoes"><button type="button" class="buy caro" data-presente="${a.id}" ${a.podePresentear ? '' : 'disabled'}>${a.podePresentear ? 'Presente' : 'Enviado'}</button><button type="button" class="buy" data-visitar="${a.id}">Visitar</button></div></div>`).join('')
    : '<p class="info">Ainda sem amigos. Mande seu código ou o convite no WhatsApp: cada um que entrar vira seu vizinho.</p>';
}
const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
$('am-salvar').addEventListener('click', async () => {
  try { const r = await api('PUT', '/api/eu', { nome: $('am-nome').value }); toast(`Pronto, ${r.nome}!`); } catch (e) { toast(e.status === 400 ? 'O nome precisa ter pelo menos 2 letras' : 'Sem conexão'); }
});
$('am-convidar').addEventListener('click', async () => {
  if (!eu) return;
  const link = `${SITE}/?amigo=${eu.codigo}`, texto = `Vem montar sua Vila de Natal comigo! 🎄 Meu código de amigo: ${eu.codigo}\n${link}`;
  try { if (navigator.share) { await navigator.share({ title: 'Vila de Natal', text: texto }); return; } } catch { return; }
  const w = window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank');
  if (!w) { try { await navigator.clipboard.writeText(texto); toast('Convite copiado! Cole no WhatsApp.'); } catch { toast(`Seu código: ${eu.codigo}`); } }
});
async function adicionarAmigo(codigo) {
  try { const r = await api('POST', '/api/amigos', { codigo }); toast(`Agora você e ${r.nome} são vizinhos!`); som.tocar('presente'); return true; }
  catch (e) { toast(e.status === 404 ? 'Não achei ninguém com esse código' : e.status === 400 ? 'Esse é o seu próprio código' : 'Sem conexão'); return false; }
}
$('am-add').addEventListener('click', async () => { if (await adicionarAmigo($('am-codigo').value)) { $('am-codigo').value = ''; carregarAmigos(); } });
$('am-presentes').addEventListener('click', async (e) => {
  if (!e.target.closest('#am-abrir-presentes')) return;
  try {
    const r = await api('POST', '/api/presentes/resgatar');
    receber(r); desenhar(); som.tocar('presente');
    toast(`${r.quantos} presente${r.quantos > 1 ? 's' : ''}: ${Object.entries(r.ganho).map(([k, q]) => `+${fmt(q)} ${k}`).join(' ')}`);
    eu.presentesPendentes = 0; carregarAmigos();
  } catch { toast('Não deu pra abrir agora'); }
});
$('am-lista').addEventListener('click', async (e) => {
  const pr = e.target.closest('[data-presente]');
  if (pr) { await mandarPresente(pr.dataset.presente); carregarAmigos(); return; }
  const vs = e.target.closest('[data-visitar]'); if (vs) visitar(vs.dataset.visitar);
});
async function mandarPresente(id) {
  try { await api('POST', `/api/amigos/${id}/presente`); som.tocar('presente'); toast('Presente enviado!'); const a = amigos.find(x => x.id === id); if (a) a.podePresentear = false; return true; }
  catch (e) { toast(e.status === 409 ? 'Você já mandou presente pra esse amigo hoje' : 'Sem conexão'); return false; }
}
$('am-gerar').addEventListener('click', async () => {
  try { const r = await api('POST', '/api/eu/recuperacao'); $('am-recuperacao').textContent = r.codigo; $('am-recuperacao').hidden = false; toast('Anote o código. Ele só aparece agora.'); }
  catch { toast('Sem conexão'); }
});
$('am-entrar').addEventListener('click', async () => {
  try {
    const r = await (await fetch(API + '/api/recuperar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo: $('am-rec-codigo').value }) })).json();
    if (!r.token) { toast(r.error || 'Código não encontrado'); return; }
    ls.set(LS_TOKEN, r.token); fila = []; receber(r); fechar(); desenhar(); toast('Vila carregada!');
  } catch { toast('Sem conexão'); }
});

// Visitar a vila de um amigo (só olhar e ajudar)
async function visitar(id) {
  let r;
  try { r = await api('GET', `/api/amigos/${id}/vila`); } catch { toast('Não deu pra visitar agora'); return; }
  const a = amigos.find(x => x.id === id) || { nome: r.nome, nivel: nivelDe(r.vila.alegria), podeAjudar: true, podePresentear: true };
  fechar();
  visitando = { id, nome: r.nome, vila: r.vila, amigo: a };
  document.body.classList.add('visitando');
  $('nav').hidden = true; $('visita-topo').hidden = false; $('visita-acoes').hidden = false;
  $('vs-avatar').textContent = (r.nome || 'V')[0].toUpperCase();
  $('vs-nome').textContent = `Vila de ${r.nome}`;
  desenharVisita();
  sincBaloes(); sincCena();
}
function desenharVisita() {
  const a = visitando.amigo;
  $('vs-sub').textContent = `Nível ${nivelDe(visitando.vila.alegria)} · ${visitando.vila.predios.length} prédios`;
  $('vs-dica').textContent = a.podeAjudar ? 'Toque num prédio pra ajudar: adianta a produção ou a obra (você ganha moedas)' : 'Você já ajudou hoje. Volte amanhã!';
  $('vs-presente').disabled = !a.podePresentear;
  $('vs-presente').textContent = a.podePresentear ? 'Mandar presente' : 'Presente enviado hoje';
}
async function ajudarAmigo(pid) {
  const a = visitando.amigo;
  if (!a.podeAjudar) { toast('Você já ajudou esse amigo hoje'); return; }
  try {
    const r = await api('POST', `/api/amigos/${visitando.id}/ajuda`, { predio: pid });
    a.podeAjudar = false; visitando.vila = r.vilaAmigo;
    receber(r); sincCena(); desenharHud(); desenharVisita(); som.tocar('moeda'); vibrar();
    toast(`${r.como === 'obra' ? 'Obra adiantada' : 'Produção adiantada'}! Você ganhou +${r.recompensa.moedas} moedas`);
  } catch (e) { toast(e.status === 409 ? 'Você já ajudou esse amigo hoje' : e.status === 400 ? 'Esse prédio não precisa de ajuda' : 'Sem conexão'); }
}
$('vs-presente').addEventListener('click', async () => { if (await mandarPresente(visitando.id)) { visitando.amigo.podePresentear = false; desenharVisita(); } });
$('vs-voltar').addEventListener('click', () => {
  visitando = null;
  document.body.classList.remove('visitando');
  $('visita-topo').hidden = true; $('visita-acoes').hidden = true; $('nav').hidden = false;
  desenhar();
});

// Itens (enfeites da árvore, fachada, móveis)
function linhasItens(p, grupo) {
  return Object.entries(ITENS[p.tipo]).filter(([, d]) => d.grupo === grupo).map(([k, d]) => {
    const n = nivelItem(p, k), max = d.custos.length, bloq = bloqueioItem(estado, p, k);
    const dots = Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
    let btn;
    if (p.obra && p.obra.item === k) btn = `<span class="completo">${svg('i-martelo')}Enfeitando ${tempoTexto((p.obra.fim - agora()) / 1000)}</span>`;
    else if (p.obra && n < max && !bloq) btn = `<span class="bloq">Depois</span>`;
    else if (n >= max) btn = `<span class="completo">${svg('i-ok')}Completo</span>`;
    else if (bloq) btn = `<span class="bloq">${svg('i-cadeado')}${bloq}</span>`;
    else btn = `<button type="button" class="buy ${podePagar(estado, d.custos[n]) ? '' : 'caro'}" data-item="${k}">${n ? 'Melhorar' : 'Colocar'}<span class="cost">${custoHtml(d.custos[n])}</span></button>`;
    return `<div class="item-row" data-linha="${k}"><div class="item-info"><b>${d.nome}</b><span class="dots" aria-label="nível ${n} de ${max}">${dots}</span><small>${n < max ? `+${d.alegria[n]} alegria` : ''}</small></div>${btn}</div>`;
  }).join('');
}
function comprarItem(id, item) {
  const p = predio(estado, id), d = p && ITENS[p.tipo][item];
  const r = agir({ tipo: 'item', id, item });
  if (r.ok && r.obra) toast(`Os moradores foram pendurar: ${d.nome}`);
  else if (r.ok) toast(`${d.nome} ${r.nivel > 1 ? `nível ${r.nivel}` : 'colocado'}! +${r.ganho.alegria} alegria`);
}

// Dentro da casa
let dentro = null;
function entrar(id) {
  const p = predio(estado, id); if (!p) return;
  fechar();
  dentro = id;
  cena.entrarCasa(p);
  $('nav').hidden = true; $('sheet-casa').hidden = false;
  deslocarCena();
  desenharCasa.chave = null; desenharCasa();
}
function sair() {
  const id = dentro;
  dentro = null; cena.sairCasa(); deslocarCena();
  $('sheet-casa').hidden = true; $('nav').hidden = false;
  for (const el of bolhasCasa.values()) el.remove();
  bolhasCasa.clear();
  if (id && predio(estado, id)) selecionar(id);
}
$('cs-sair').addEventListener('click', sair);
function desenharCasa() {
  const p = predio(estado, dentro); if (!p) return;
  const chave = JSON.stringify([p.nv, p.itens, Math.floor(estado.moedas), Math.floor(estado.doces)]);
  if (chave === desenharCasa.chave) return;
  desenharCasa.chave = chave;
  const feitos = Object.entries(ITENS.casa).filter(([, d]) => d.grupo === 'moveis').reduce((s2, [k]) => s2 + nivelItem(p, k), 0);
  $('cs-sub').textContent = `Casa nível ${p.nv || 1} · ${feitos} melhorias de móveis`;
  $('cs-itens').innerHTML = linhasItens(p, 'moveis');
  sincBolhasCasa();
}
$('cs-itens').addEventListener('click', (e) => { const b = e.target.closest('[data-item]'); if (b) comprarItem(dentro, b.dataset.item); });
function focarLinha(k) {
  const l = document.querySelector(`#cs-itens [data-linha="${k}"]`); if (!l) return;
  l.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  l.classList.add('flash'); setTimeout(() => l.classList.remove('flash'), 900);
}
const bolhasCasa = new Map();
function sincBolhasCasa() {
  const p = predio(estado, dentro); if (!p) return;
  const vivos = new Set();
  for (const k of Object.keys(ITENS.casa)) {
    if (ITENS.casa[k].grupo !== 'moveis' || nivelItem(p, k) || bloqueioItem(estado, p, k)) continue;
    vivos.add(k);
    if (!bolhasCasa.has(k)) {
      const el = document.createElement('button'); el.type = 'button'; el.className = 'balao mais';
      el.setAttribute('aria-label', `Colocar ${ITENS.casa[k].nome}`);
      el.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="#3a2a10" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;
      el.addEventListener('click', () => focarLinha(k));
      $('baloes').appendChild(el); bolhasCasa.set(k, el);
    }
  }
  for (const [k, el] of bolhasCasa) if (!vivos.has(k)) { el.remove(); bolhasCasa.delete(k); }
}

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
$('btn-estrelas').addEventListener('click', () => abrir('loja'));

// Loja de estrelas: vídeo grátis (anúncio recompensado) e, no app, pacotes pagos.
const PACOTES = [{ id: 'estrelas_60', qtd: 60, preco: 'R$ 4,90' }, { id: 'estrelas_200', qtd: 200, preco: 'R$ 14,90', destaque: 'Mais popular' }, { id: 'estrelas_600', qtd: 600, preco: 'R$ 39,90', destaque: 'Melhor valor' }];
function desenharLoja() {
  const vistos = anunciosHoje(estado, agora()), resta = ANUNCIOS_POR_DIA - vistos;
  let html = '';
  if (anuncios.disponivel()) html += `<div class="item-row"><div class="item-info"><b>Vídeo grátis</b><small>Assista um vídeo curto · ${resta} de ${ANUNCIOS_POR_DIA} hoje</small></div><button type="button" class="buy" data-video="estrelas" ${resta > 0 ? '' : 'disabled'}>Assistir<span class="cost"><span>${svg('i-estrela')}+${ANUNCIO_ESTRELAS}</span></span></button></div>`;
  html += `<p class="info">Você ganha ${ESTRELAS_POR_NIVEL} estrelas a cada nível, nas missões e no presente do dia.</p>`;
  html += PACOTES.map(p => `<div class="item-row"><div class="item-info"><b>${svg('i-estrela')} ${p.qtd} estrelas</b><small>${p.destaque || 'Pacote'}</small></div><span class="bloq">${p.preco} · em breve</span></div>`).join('');
  html += `<p class="info">As compras chegam junto com o app na App Store e no Google Play.</p>`;
  $('lj-itens').innerHTML = html;
}
async function verVideo(premio, id) {
  if (anunciosHoje(estado, agora()) >= ANUNCIOS_POR_DIA) { toast('Chega de vídeos por hoje. Volte amanhã!'); return; }
  const ok = await anuncios.assistir();
  if (!ok) { toast('O vídeo não terminou, então não teve prêmio.'); return; }
  const r = agir({ tipo: 'anuncio', premio, id });
  if (!r.ok) return;
  som.tocar('presente');
  toast(premio === 'estrelas' ? `+${ANUNCIO_ESTRELAS} estrelas!` : `Obra adiantada em ${ANUNCIO_ADIANTA / 60} minutos!`);
  if (painel === 'loja') desenharLoja();
  if (painel === 'predio') { desenharPredio.chave = null; desenharPredio(); }
}
$('lj-itens').addEventListener('click', (e) => { const b = e.target.closest('[data-video]'); if (b) verVideo('estrelas'); });
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
  const tp = predio(estado, id)?.tipo;
  if (tp === 'praca' || tp === 'casa') cena.focar(id);
}

/* ---------- coletar e balões ---------- */

function coletar(id, ponto = null) {
  const b = baloes.get(id);
  let pos = b && b.style.visibility !== 'hidden' ? b.getBoundingClientRect() : null;
  if (ponto) pos = { left: ponto.x, top: ponto.y, width: 0 };
  const r = agir({ tipo: 'coletar', id });
  if (!r.ok) return;
  som.tocar('moeda'); vibrar();
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
  if (visitando) { for (const el of baloes.values()) el.remove(); baloes.clear(); return; }
  for (const p of estado.predios) {
    const pr = TIPOS[p.tipo].prod, aluguel = aluguelDe(p);
    let html = null, cls = 'balao', rotulo = '';
    let modo = 'coletar';
    if (p.obra) {
      const enf = p.tipo === 'praca';
      html = `${svg(enf ? 'i-martelo' : 'i-relogio')}${enf ? 'enfeitando ' : ''}${tempoTexto((p.obra.fim - agora()) / 1000)}`; cls += ' obra'; modo = 'abrir';
      rotulo = enf ? 'Moradores enfeitando a árvore' : `${TIPOS[p.tipo].nome} em obra`;
    } else if (p.tipo === 'casa') {
      const k = prontos(p);
      if (aluguel && k >= 1) { html = `${svg('i-moedas')}+${fmt(k * aluguel)}`; rotulo = `Recolher ${fmt(k * aluguel)} moedas de aluguel`; }
      else if (!aluguel) { html = `${svg('i-alegria')}sem enfeites`; cls += ' parado'; rotulo = 'Casa sem enfeites: o Papai Noel não passa'; }
    } else if (pr) {
      const k = prontos(p), n = duendesEm(estado, p.id);
      if (k >= 1) { html = `${svg(ICONE[pr.recurso])}+${fmt(k * pr.qtd)}`; rotulo = `Coletar ${fmt(k * pr.qtd)} ${NOME_RECURSO[pr.recurso]} de ${TIPOS[p.tipo].nome}`; }
      else if (!n) { html = `${svg('i-sono')}sem duendes`; cls += ' parado'; rotulo = `${TIPOS[p.tipo].nome} sem duendes`; }
    }
    if (!html) continue;
    vivos.add(p.id);
    let el = baloes.get(p.id);
    if (!el) {
      el = document.createElement('button'); el.type = 'button';
      el.addEventListener('click', () => { if (colocando) return; if (el.dataset.modo === 'abrir') selecionar(p.id); else coletar(p.id); });
      $('baloes').appendChild(el); baloes.set(p.id, el);
    }
    if (el.innerHTML !== html) el.innerHTML = html;
    el.className = cls;
    el.setAttribute('aria-label', rotulo);
    el.dataset.modo = modo;
  }
  // terrenos à venda: mostra os que já dá pra comprar e os do próximo nível
  const nv = nivelDe(estado.alegria);
  for (const t of TERRENOS) {
    if (!terrenoLivre(estado, t) || t.nivel > nv) continue;
    const id = 'T:' + t.id; vivos.add(id);
    let el = baloes.get(id);
    if (!el) {
      el = document.createElement('button'); el.type = 'button';
      el.addEventListener('click', () => { if (!colocando) abrirTerreno(t.id); });
      $('baloes').appendChild(el); baloes.set(id, el);
    }
    const html = t.nivel > nv ? `${svg('i-cadeado')}Terreno · nível ${t.nivel}` : `${svg('i-moedas')}Terreno · ${fmt(t.custo.moedas)}`;
    if (el.innerHTML !== html) el.innerHTML = html;
    el.className = 'balao ' + (t.nivel > nv ? 'obra' : 'terreno');
    el.setAttribute('aria-label', `Terreno à venda: ${fmt(t.custo.moedas)} moedas`);
  }
  for (const [id, el] of baloes) if (!vivos.has(id)) { el.remove(); baloes.delete(id); }
}
function posicionarBaloes() {
  for (const [k, el] of bolhasCasa) {
    const s2 = cena.projetar(cena.posItem(k));
    el.style.visibility = s2.visivel ? 'visible' : 'hidden';
    el.style.transform = `translate(${s2.x}px, ${s2.y}px) translate(-50%, calc(-100% - 8px))`;
  }
  for (const [id, el] of baloes) {
    if (dentro) { el.style.visibility = 'hidden'; continue; }
    const top = id.startsWith('T:') ? cena.centroTerreno(id.slice(2)) : cena.topoDe(id);
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
  for (let x = MAPA_MIN; x <= MAPA_MAX - tam; x++) for (let z = MAPA_MIN; z <= MAPA_MAX - tam; z++) {
    if (!cabe(estado, x, z, tam)) continue;
    const d = (x + tam / 2 - perto.x) ** 2 + (z + tam / 2 - perto.z) ** 2;
    if (d < md) { md = d; melhor = { x, z }; }
  }
  return melhor;
}

function comecarColocar({ tipo, moverId = null, x, z, r = 0, modelo = null }) {
  fechar();
  if (x === undefined) {
    const meio = cena.loteEm(innerWidth / 2, innerHeight * 0.58) || { fx: 9, fz: 13 };
    const l = lugarLivre(tipo, { x: meio.fx, z: meio.fz });
    if (!l) { toast('Não tem mais espaço na vila'); return; }
    ({ x, z } = l);
  }
  colocando = { tipo, moverId, x, z, r, modelo };
  $('nav').hidden = true; $('place').hidden = false;
  $('place-nome').textContent = (moverId ? 'Movendo: ' : '') + TIPOS[tipo].nome;
  cena.setGrade(true);
  if (moverId) cena.esconder(moverId);
  atualizarFantasma();
}
function atualizarFantasma() {
  const c = colocando, ok = cabe(estado, c.x, c.z, TIPOS[c.tipo].tam, c.moverId);
  cena.setFantasma(c.tipo, c.x, c.z, c.r, ok, c.modelo);
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
    if (r.obra) toast(`Obra começou! ${t.nome} fica pronta em ${tempoTexto(t.tempo)}`);
    else toast(`${t.nome} pronta! +${r.ganho.alegria} alegria`);
  }
});
function moverFantasmaPara(cx, cy) {
  const l = cena.loteEm(cx, cy); if (!l) return;
  const tam = TIPOS[colocando.tipo].tam;
  const x = Math.max(MAPA_MIN, Math.min(MAPA_MAX - tam, Math.round(l.fx - tam / 2)));
  const z = Math.max(MAPA_MIN, Math.min(MAPA_MAX - tam, Math.round(l.fz - tam / 2)));
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
    if (arrastando) { arrastando = false; if (!dentro) cena.controls.enabled = true; down = null; return; }
    if (!down) return;
    const tap = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && performance.now() - down.t < 500;
    down = null;
    if (!tap) return;
    if (colocando) { moverFantasmaPara(e.clientX, e.clientY); return; }
    if (dentro) { const k = cena.itemEm(e.clientX, e.clientY); if (k) focarLinha(k); return; }
    if (visitando) { const pid = cena.predioEm(e.clientX, e.clientY); if (pid) ajudarAmigo(pid); return; }
    const id = cena.predioEm(e.clientX, e.clientY);
    if (!id) {
      const l = cena.loteEm(e.clientX, e.clientY);
      const t = l && TERRENOS.find(t => terrenoLivre(estado, t) && l.x >= t.x && l.x < t.x + t.w && l.z >= t.z && l.z < t.z + t.h);
      if (t) { abrirTerreno(t.id); return; }
    }
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
  // guarda o jogo no aparelho pra abrir sem internet (na web; no app ele já vem dentro)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && !window.Capacitor) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    navigator.storage?.persist?.().catch(() => {});
  }
  document.addEventListener('pointerdown', () => som.iniciar(), { once: true });
  anuncios.iniciar();
  document.addEventListener('click', (e) => { if (e.target.closest('button')) som.tocar('clique'); });
  let viu = null; try { viu = localStorage.getItem('natal.boasvindas'); } catch { /* ok */ }
  if (!viu) abrir('boasvindas');
  if (!online) toast('Jogando sem conexão: o progresso fica salvo neste aparelho.');
  const convite = new URLSearchParams(location.search).get('amigo');
  if (convite && online) { adicionarAmigo(convite); history.replaceState(null, '', location.pathname); }
  if (fila.length) agendarEnvio(500);

  // o tempo passa: produção anda e os balões aparecem
  setInterval(() => {
    const nivelAntes = nivelDe(estado.alegria), obras = estado.predios.filter(p => p.obra).map(p => [p, p.obra.tipo || 'enfeite']);
    avancar(estado, agora());
    const prontas = obras.filter(([p]) => !p.obra);
    for (const [p, tipo] of prontas) toast(tipo === 'construir' ? `${TIPOS[p.tipo].nome} pronta!${TIPOS[p.tipo].prod ? ' Coloque duendes nela.' : ''}` : tipo === 'melhorar' ? `Casa aumentada pro nível ${p.nv}!` : 'Os moradores terminaram de enfeitar a árvore!');
    if (prontas.length) { sincCena(); som.tocar('pronto'); }
    if (nivelDe(estado.alegria) > nivelAntes) subiuNivel(nivelDe(estado.alegria));
    desenharHud();
    sincBaloes();
    if (painel === 'predio') desenharPredio();
  }, 500);
  // de tempos em tempos busca a vila oficial (ex: aberta em outro aparelho)
  setInterval(async () => {
    if (!ls.get(LS_TOKEN) || fila.length || enviando) { if (fila.length) agendarEnvio(0); return; }
    try { receber(await api('GET', '/api/vila')); online = true; desenhar(); } catch { online = false; }
  }, 60000);
  // Papai Noel: passa pelas casas enfeitadas com aluguel pronto (e de vez em quando só passeia)
  let semVisita = 0;
  const chamarNoel = () => {
    if (cena.noelVoando() || colocando || visitando) return;
    const alvos = estado.predios.filter(p => aluguelDe(p) && prontos(p) >= 1).map(p => ({ id: p.id, pos: cena.chamineDe(p.id) })).filter(a => a.pos);
    if (!alvos.length && ++semVisita % 5) return;
    semVisita = 0;
    som.tocar('guizos');
    cena.papaiNoel(alvos, (id) => { const ch = cena.chamineDe(id), sc = ch && cena.projetar(ch); coletar(id, sc && sc.visivel && !dentro ? sc : null); });
  };
  setTimeout(chamarNoel, 6000);
  setInterval(chamarNoel, 18000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') enviar(); });
}
// atalho pros testes automáticos (só no servidor local)
if (location.hostname === 'localhost') window.__teste = { selecionarTipo: (t) => selecionar(estado.predios.find(p => p.tipo === t).id), memoria: () => cena.memoria(), noel: () => { const c = estado.predios.find(p => p.tipo === 'casa'); cena.papaiNoel([{ id: c.id, pos: cena.chamineDe(c.id) }], (id) => coletar(id), { perto: true }); }, focar: (t) => cena.focar(estado.predios.find(p => p.tipo === t).id), agir: (a) => agir(a), estado: () => estado };

iniciar();
