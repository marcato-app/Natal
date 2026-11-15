// Regras do jogo: catálogo de prédios, mapa e todas as ações.
//
// Módulo puro (sem DOM, sem banco). O navegador usa pra responder na hora e o
// Worker usa pra validar e gravar. Os dois têm de chegar no mesmo resultado, então
// nada aqui sorteia nem lê relógio: o horário entra sempre como parâmetro (`agora`,
// em ms) e os ids saem do contador da própria vila (`seq`).

export const VERSAO = 1;
export const TAMANHO = 18;          // a vila é uma grade de 18 x 18 lotes
export const ESTOQUE_MAX = 4;       // quantos ciclos de produção um prédio guarda
export const MAX_ACOES = 50;        // por requisição

// Ruas fixas do mapa (em lotes). Não dá pra construir em cima.
export const RUAS = [
  { x: 0, z: 10, w: 18, h: 1 },
  { x: 9, z: 11, w: 1, h: 7 },
];

// Alegria acumulada necessária pra cada nível: índice 0 = nível 1.
export const NIVEIS = [0, 30, 80, 160, 280, 450, 700, 1000];

export const CUSTO_DUENDE = { doces: 40 };

// Obras e estrelas mágicas (estilo jogo de construir): construir e aumentar levam
// tempo (TIPOS[x].tempo e melhorias[n].tempo, em segundos; decoração fica pronta na
// hora). Cada duende construtor toca uma obra por vez. Estrelas são a moeda especial:
// terminam uma obra na hora e contratam construtores. Ganha ao subir de nível (e,
// depois, por anúncio e compra).
export const ESTRELAS_INICIAIS = 25;
export const ESTRELAS_POR_NIVEL = 5;
export const MAX_CONSTRUTORES = 3;
export const CUSTO_CONSTRUTOR = [0, 150, 300];   // estrelas pro construtor nº 2 e nº 3 (índice = quantos já tem)
export const custoAcelerar = (segundos) => Math.max(1, Math.ceil(segundos / 60));

// Anúncio recompensado (o jogador escolhe assistir): +estrelas ou adianta uma obra.
// Limite por dia (horário de Brasília) pra não virar fazenda de anúncio.
export const ANUNCIO_ESTRELAS = 3;
export const ANUNCIO_ADIANTA = 5 * 60;        // segundos que um vídeo tira de uma obra
export const ANUNCIOS_POR_DIA = 10;
export function anunciosHoje(v, agora) { const a = v.anuncios || {}; return a.dia === diaDe(agora) ? a.n : 0; }

// Presente diário: um por dia (horário de Brasília). Voltar dias seguidos aumenta o
// prêmio (ciclo de 7). De 1 a 25 de dezembro vira o Calendário do Advento.
export const PRESENTE_DIARIO = [
  { moedas: 50 }, { doces: 20 }, { moedas: 120 }, { estrelas: 2 }, { moedas: 200, doces: 20 }, { doces: 50 }, { estrelas: 6, moedas: 300 },
];
export const ADVENTO = [
  { moedas: 100 }, { doces: 30 }, { estrelas: 3 }, { moedas: 150 }, { doces: 40 }, { moedas: 200 }, { estrelas: 5 },
  { moedas: 250 }, { doces: 50 }, { moedas: 300, doces: 20 }, { estrelas: 5 }, { moedas: 350 }, { doces: 60 }, { estrelas: 8 },
  { moedas: 400 }, { doces: 70 }, { moedas: 450, estrelas: 3 }, { doces: 80 }, { estrelas: 10 }, { moedas: 500 },
  { doces: 100 }, { moedas: 600, estrelas: 5 }, { doces: 120, estrelas: 5 }, { moedas: 800, doces: 100 }, { moedas: 1500, doces: 200, estrelas: 25 },
];
const BRT = 3 * 3600 * 1000;
export function diaDe(agora) { return new Date(agora - BRT).toISOString().slice(0, 10); }
// O que o presente de hoje daria (ou null se já pegou). { premio, sequencia, advento: dia|null }
export function presenteDeHoje(v, agora) {
  const hoje = diaDe(agora), d = v.diario || {};
  if (d.ultimo === hoje) return null;
  const sequencia = d.ultimo === diaDe(agora - 86400000) ? (d.sequencia || 0) + 1 : 1;
  const data = new Date(agora - BRT), dia = data.getUTCDate();
  const advento = data.getUTCMonth() === 11 && dia <= 25 ? dia : null;
  return { premio: advento ? ADVENTO[dia - 1] : PRESENTE_DIARIO[(sequencia - 1) % 7], sequencia, advento };
}

// Missões: objetivos em sequência que também ensinam o jogo. progresso(v) lê só o
// estado da vila (e os contadores em v.stats), então cliente e servidor concordam.
const somaItens = (v, tipo, grupo) => v.predios.filter(p => p.tipo === tipo).reduce((s, p) => s + Object.entries(p.itens || {}).reduce((t, [k, n]) => t + (ITENS[tipo][k].grupo === grupo ? n : 0), 0), 0);
const stat = (v, k) => (v.stats && v.stats[k]) || 0;
export const MISSOES = [
  { id: 'coletar1', texto: 'Colete a produção da fábrica', meta: 1, progresso: v => stat(v, 'coletas'), premio: { moedas: 30 }, foco: 'fabrica' },
  { id: 'padaria', texto: 'Construa uma Padaria de Biscoitos', meta: 1, progresso: v => v.predios.filter(p => p.tipo === 'padaria' && !p.obra).length, premio: { estrelas: 3 }, foco: 'construir' },
  { id: 'enfeite1', texto: 'Pendure o primeiro enfeite na árvore', meta: 1, progresso: v => somaItens(v, 'praca', 'arvore'), premio: { moedas: 40 }, foco: 'praca' },
  { id: 'fachada1', texto: 'Enfeite a fachada da casa', meta: 1, progresso: v => somaItens(v, 'casa', 'fachada'), premio: { doces: 20 }, foco: 'casa' },
  { id: 'padaria2', texto: 'Coloque 2 duendes na padaria', meta: 2, progresso: v => Math.max(0, ...v.predios.filter(p => p.tipo === 'padaria').map(p => duendesEm(v, p.id))), premio: { moedas: 50 }, foco: 'padaria' },
  { id: 'noel', texto: 'Receba a visita do Papai Noel', meta: 1, progresso: v => stat(v, 'alugueis'), premio: { estrelas: 3 }, foco: 'casa' },
  { id: 'duende4', texto: 'Contrate mais um duende', meta: 4, progresso: v => v.duendes.length, premio: { doces: 30 }, foco: 'duendes' },
  { id: 'moveis3', texto: 'Coloque 3 móveis na casa', meta: 3, progresso: v => somaItens(v, 'casa', 'moveis'), premio: { moedas: 80 }, foco: 'casa' },
  { id: 'nivel3', texto: 'Chegue ao nível 3 da vila', meta: 3, progresso: v => nivelDe(v.alegria), premio: { estrelas: 5 } },
  { id: 'estrela', texto: 'Coloque a estrela no topo da árvore', meta: 1, progresso: v => v.predios.some(p => p.tipo === 'praca' && nivelItem(p, 'estrela')) ? 1 : 0, premio: { estrelas: 10 }, foco: 'praca' },
  { id: 'casa2', texto: 'Aumente uma casa pro nível 2', meta: 2, progresso: v => Math.max(1, ...v.predios.filter(p => p.tipo === 'casa').map(p => p.nv || 1)), premio: { estrelas: 5 }, foco: 'casa' },
  { id: 'coletar30', texto: 'Faça 30 coletas', meta: 30, progresso: v => stat(v, 'coletas'), premio: { moedas: 150, doces: 30 } },
  { id: 'arvore', texto: 'Complete todos os enfeites da árvore', meta: 12, progresso: v => somaItens(v, 'praca', 'arvore'), premio: { estrelas: 20 }, foco: 'praca' },
];
// As 3 primeiras missões ainda não resgatadas.
export function missoesAtivas(v) {
  const feitas = new Set(v.missoes || []);
  return MISSOES.filter(m => !feitas.has(m.id)).slice(0, 3);
}

// Aluguel das casas: só casa enfeitada recebe o Papai Noel, que recolhe o aluguel e
// deixa um presente (doces). Rende a cada ALUGUEL_CICLO segundos, sem precisar de duende.
export const ALUGUEL_CICLO = 120;
export const ALUGUEL_BASE = [8, 14, 22];     // moedas por ciclo, por nível da casa
export const ALUGUEL_POR_ENFEITE = 3;        // + moedas por nível de enfeite da fachada
export const PRESENTE_DOCES = 2;             // doces por ciclo

// Enfeitar a árvore leva tempo: os moradores vão lá e penduram. Segundos por nível.
export const TEMPO_ENFEITE = (nivelAtual) => 15 + 15 * nivelAtual;

export const NOMES_DUENDES = [
  'Pipo', 'Lumi', 'Tico', 'Bia', 'Nino', 'Juju', 'Fafá', 'Zeca', 'Mel', 'Bento',
  'Lolo', 'Duda', 'Kiko', 'Nina', 'Teco', 'Lili', 'Gigi', 'Bubu', 'Caju', 'Pituca',
];

export const RECURSOS = {
  moedas: { nome: 'moedas' },
  doces: { nome: 'doces' },
  alegria: { nome: 'alegria' },
};

// cat: aba do menu Construir (null = não aparece no menu).
// prod.ciclo em segundos; prod.vagas = duendes pra produzir na velocidade máxima.
export const TIPOS = {
  praca: { nome: 'Praça da Árvore', cat: null, tam: 4, custo: {}, nivel: 1, vendavel: false },
  casa: {
    nome: 'Casinha', cat: 'casas', tam: 3, custo: { moedas: 150 }, nivel: 1, tempo: 60,
    moradia: [4, 6, 8], // por nível da casa
    melhorias: [         // melhorias[n-1] leva do nível n ao n+1
      { custo: { moedas: 300, doces: 30 }, nivelVila: 2, alegria: 10, tempo: 300 },
      { custo: { moedas: 700, doces: 80 }, nivelVila: 4, alegria: 20, tempo: 900 },
    ],
  },
  padaria: { nome: 'Padaria de Biscoitos', cat: 'producao', tam: 3, custo: { moedas: 250 }, nivel: 1, tempo: 120, prod: { recurso: 'doces', qtd: 15, ciclo: 90, vagas: 2 } },
  fabrica: { nome: 'Fábrica de Brinquedos', cat: 'producao', tam: 4, custo: { moedas: 400 }, nivel: 2, tempo: 300, prod: { recurso: 'moedas', qtd: 40, ciclo: 60, vagas: 3 } },
  rinque: { nome: 'Rinque de Patinação', cat: 'diversao', tam: 4, custo: { moedas: 600, doces: 50 }, nivel: 3, tempo: 600, prod: { recurso: 'alegria', qtd: 12, ciclo: 120, vagas: 2 } },
  pinheiro: { nome: 'Pinheiro', cat: 'decoracao', tam: 1, custo: { moedas: 15 }, nivel: 1, alegria: 2 },
  boneco: { nome: 'Boneco de Neve', cat: 'decoracao', tam: 1, custo: { moedas: 30 }, nivel: 1, alegria: 5 },
  poste: { nome: 'Poste de Luz', cat: 'decoracao', tam: 1, custo: { moedas: 40 }, nivel: 2, alegria: 6 },
  presentes: { nome: 'Pilha de Presentes', cat: 'decoracao', tam: 1, custo: { moedas: 60, doces: 10 }, nivel: 2, alegria: 10 },
};

// Itens comprados dentro de um prédio: enfeites da árvore, decoração da fachada e
// móveis. custos[n] leva o item do nível n ao n+1 (0 = ainda não tem) e dá alegria[n].
// nivelCasa: nível mínimo da casa pra ter o item. precisa: outro item que vem antes.
export const ITENS = {
  praca: {
    luzes: { nome: 'Pisca-pisca', grupo: 'arvore', custos: [{ moedas: 20 }, { moedas: 60 }, { moedas: 150 }], alegria: [3, 5, 8] },
    bolas: { nome: 'Bolas coloridas', grupo: 'arvore', custos: [{ moedas: 30 }, { moedas: 80 }, { moedas: 180, doces: 10 }], alegria: [3, 6, 9] },
    festao: { nome: 'Festão dourado', grupo: 'arvore', custos: [{ moedas: 50 }, { moedas: 140, doces: 15 }], alegria: [4, 8] },
    presentes: { nome: 'Presentes embaixo', grupo: 'arvore', custos: [{ moedas: 40, doces: 5 }, { moedas: 100, doces: 15 }, { moedas: 220, doces: 30 }], alegria: [4, 7, 10] },
    estrela: { nome: 'Estrela no topo', grupo: 'arvore', custos: [{ moedas: 120, doces: 20 }], alegria: [15], precisa: 'luzes' },
  },
  casa: {
    pisca: { nome: 'Pisca-pisca no telhado', grupo: 'fachada', custos: [{ moedas: 25 }, { moedas: 70 }], alegria: [2, 4] },
    guirlanda: { nome: 'Guirlanda na porta', grupo: 'fachada', custos: [{ moedas: 20 }], alegria: [2] },
    velas: { nome: 'Velas nas janelas', grupo: 'fachada', custos: [{ moedas: 35 }], alegria: [3] },
    jardim: { nome: 'Jardim de inverno', grupo: 'fachada', custos: [{ moedas: 60 }, { moedas: 140, doces: 10 }], alegria: [4, 6] },
    lareira: { nome: 'Lareira', grupo: 'moveis', custos: [{ moedas: 40 }, { moedas: 120 }, { moedas: 260, doces: 20 }], alegria: [3, 6, 10] },
    sofa: { nome: 'Sofá', grupo: 'moveis', custos: [{ moedas: 30 }, { moedas: 90 }, { moedas: 200, doces: 15 }], alegria: [2, 5, 8] },
    mesa: { nome: 'Mesa de biscoitos', grupo: 'moveis', custos: [{ moedas: 25, doces: 5 }, { moedas: 80, doces: 10 }, { moedas: 180, doces: 25 }], alegria: [2, 5, 8] },
    tapete: { nome: 'Tapete', grupo: 'moveis', custos: [{ moedas: 15 }, { moedas: 50 }, { moedas: 120 }], alegria: [1, 3, 5] },
    cama: { nome: 'Cama quentinha', grupo: 'moveis', custos: [{ moedas: 60 }, { moedas: 150 }, { moedas: 300, doces: 25 }], alegria: [3, 6, 10], nivelCasa: 2 },
    estante: { nome: 'Estante de livros', grupo: 'moveis', custos: [{ moedas: 50 }, { moedas: 130 }, { moedas: 280 }], alegria: [3, 5, 9], nivelCasa: 2 },
    poltrona: { nome: 'Poltrona', grupo: 'moveis', custos: [{ moedas: 70 }, { moedas: 170 }, { moedas: 320, doces: 20 }], alegria: [3, 6, 10], nivelCasa: 3 },
    arvorinha: { nome: 'Arvorezinha', grupo: 'moveis', custos: [{ moedas: 80, doces: 10 }, { moedas: 200, doces: 20 }, { moedas: 380, doces: 40 }], alegria: [4, 8, 12], nivelCasa: 3 },
  },
};

export const CATEGORIAS = [
  { id: 'casas', nome: 'Casas' },
  { id: 'producao', nome: 'Produção' },
  { id: 'diversao', nome: 'Diversão' },
  { id: 'decoracao', nome: 'Decoração' },
];

/* ------------------------------ consultas ------------------------------ */

export function nivelDe(alegria) {
  let n = 0;
  while (n < NIVEIS.length && alegria >= NIVEIS[n]) n++;
  return n;
}

// { nivel, atual, proximo } — atual/proximo em alegria acumulada, proximo = null no nível máximo.
export function progressoNivel(alegria) {
  const nivel = nivelDe(alegria);
  return { nivel, atual: NIVEIS[nivel - 1], proximo: nivel < NIVEIS.length ? NIVEIS[nivel] : null };
}

// Alegria que um prédio dá ao ser construído.
export function alegriaAoConstruir(tipo) {
  const t = TIPOS[tipo];
  return t.alegria ?? Math.floor((t.custo.moedas || 0) / 50);
}

// Ganha alegria; subir de nível dá estrelas.
export function ganharAlegria(v, q) {
  const antes = nivelDe(v.alegria);
  v.alegria += q;
  const depois = nivelDe(v.alegria);
  if (depois > antes) v.estrelas = (v.estrelas || 0) + ESTRELAS_POR_NIVEL * (depois - antes);
}

const ehEnfeite = (o) => o.tipo === 'enfeite' || (!o.tipo && !!o.item);
export const emConstrucao = (p) => !!(p.obra && p.obra.tipo === 'construir');
// Obras que ocupam construtor (enfeitar a árvore é com os moradores, não conta).
export function obrasDeConstrutor(v) {
  return v.predios.filter(p => p.obra && !ehEnfeite(p.obra)).length;
}
export function construtores(v) { return v.construtores || 1; }

// Moradia de um prédio (casas crescem com o nível; casa em construção ainda não abriga).
export function moradiaDe(p) {
  if (emConstrucao(p)) return 0;
  const m = TIPOS[p.tipo].moradia;
  return Array.isArray(m) ? m[(p.nv || 1) - 1] : (m || 0);
}

export function moradia(v) {
  return v.predios.reduce((s, p) => s + moradiaDe(p), 0);
}

export function nivelItem(p, item) {
  return (p.itens && p.itens[item]) || 0;
}

// Por que o item não pode ser comprado/melhorado agora (null = pode, sem olhar o preço).
export function bloqueioItem(v, p, item) {
  const def = ITENS[p.tipo] && ITENS[p.tipo][item];
  if (!def) return 'Item desconhecido';
  const n = nivelItem(p, item);
  if (n >= def.custos.length) return 'Já está no máximo';
  if (def.nivelCasa && (p.nv || 1) < def.nivelCasa) return `Precisa da casa nível ${def.nivelCasa}`;
  if (def.precisa && !nivelItem(p, def.precisa)) return `Precisa de ${ITENS[p.tipo][def.precisa].nome} antes`;
  return null;
}

export function duendesEm(v, predioId) {
  let n = 0;
  for (const d of v.duendes) if (d.predio === predioId) n++;
  return n;
}

export function predio(v, id) {
  return v.predios.find(p => p.id === id) || null;
}

export function podePagar(v, custo) {
  return Object.entries(custo).every(([r, q]) => (v[r] || 0) >= q);
}

export function ehRua(x, z) {
  return RUAS.some(r => x >= r.x && x < r.x + r.w && z >= r.z && z < r.z + r.h);
}

// O lote (x,z) com tamanho tam cabe? ignorar = id de prédio que não conta (ao mover).
export function cabe(v, x, z, tam, ignorar = null) {
  if (!Number.isInteger(x) || !Number.isInteger(z)) return false;
  if (x < 0 || z < 0 || x + tam > TAMANHO || z + tam > TAMANHO) return false;
  for (let i = x; i < x + tam; i++) for (let j = z; j < z + tam; j++) if (ehRua(i, j)) return false;
  for (const p of v.predios) {
    if (p.id === ignorar) continue;
    const t = TIPOS[p.tipo].tam;
    if (x < p.x + t && p.x < x + tam && z < p.z + t && p.z < z + tam) return false;
  }
  return true;
}

// Soma dos níveis dos enfeites de fachada de uma casa.
export function enfeitesFachada(p) {
  const it = p.itens || {};
  return Object.entries(it).reduce((s, [k, n]) => s + (ITENS[p.tipo]?.[k]?.grupo === 'fachada' ? n : 0), 0);
}

// Moedas de aluguel por ciclo (0 = casa sem enfeite, o Papai Noel não passa).
export function aluguelDe(p) {
  if (p.tipo !== 'casa') return 0;
  const e = enfeitesFachada(p);
  return e ? ALUGUEL_BASE[(p.nv || 1) - 1] + ALUGUEL_POR_ENFEITE * e : 0;
}

// Ciclos inteiros prontos pra coletar.
export function prontos(p) {
  return Math.floor((p.prog || 0) + 1e-9);
}

/* ------------------------------ vila nova ------------------------------ */

export function novaVila(agora) {
  const v = {
    v: VERSAO, t: agora, seq: 0,
    moedas: 500, doces: 60, alegria: 0, estrelas: ESTRELAS_INICIAIS, construtores: 1,
    predios: [], duendes: [],
  };
  const add = (tipo, x, z) => { const p = { id: 'p' + (++v.seq), tipo, x, z, r: 0, prog: 0 }; if (ITENS[tipo]) p.itens = {}; if (TIPOS[tipo].melhorias) p.nv = 1; v.predios.push(p); return p; };
  add('praca', 7, 6);
  add('casa', 2, 7);
  const fab = add('fabrica', 13, 6);
  add('pinheiro', 1, 3);
  add('pinheiro', 16, 2);
  add('boneco', 6, 12);
  for (let i = 0; i < 3; i++) v.duendes.push({ id: 'd' + (++v.seq), nome: NOMES_DUENDES[i], predio: fab.id });
  fab.prog = 0.5; // a primeira entrega sai rápido
  return v;
}

/* ------------------------------ tempo ------------------------------ */

// Leva a produção de todos os prédios até `agora`. Sem duende, não produz.
export function avancar(v, agora) {
  const dt = (agora - v.t) / 1000;
  if (!(dt > 0)) return;
  for (const p of v.predios) {
    if (p.obra && agora >= p.obra.fim) concluirObra(v, p);
    if (emConstrucao(p)) continue;
    if (aluguelDe(p)) { p.prog = Math.min(ESTOQUE_MAX, (p.prog || 0) + dt / ALUGUEL_CICLO); continue; }
    const pr = TIPOS[p.tipo].prod;
    if (!pr) continue;
    const n = Math.min(duendesEm(v, p.id), pr.vagas);
    if (!n) continue;
    p.prog = Math.min(ESTOQUE_MAX, (p.prog || 0) + dt * (n / pr.vagas) / pr.ciclo);
  }
  v.t = agora;
}

function concluirObra(v, p) {
  const o = p.obra;
  delete p.obra;
  if (ehEnfeite(o)) {
    const def = ITENS[p.tipo][o.item], n = nivelItem(p, o.item);
    p.itens = { ...(p.itens || {}), [o.item]: n + 1 };
    ganharAlegria(v, def.alegria[n]);
  } else if (o.tipo === 'construir') {
    ganharAlegria(v, alegriaAoConstruir(p.tipo));
  } else if (o.tipo === 'melhorar') {
    const m = TIPOS[p.tipo].melhorias[(p.nv || 1) - 1];
    p.nv = (p.nv || 1) + 1;
    ganharAlegria(v, m ? m.alegria : 0);
  }
}

/* ------------------------------ ações ------------------------------ */

function pagar(v, custo) { for (const [r, q] of Object.entries(custo)) v[r] -= q; }
function receber(v, premio) { for (const [r, q] of Object.entries(premio)) r === 'alegria' ? ganharAlegria(v, q) : (v[r] = (v[r] || 0) + q); }
function contar(v, k, n = 1) { v.stats = { ...(v.stats || {}), [k]: (v.stats?.[k] || 0) + n }; }
const erro = (msg) => ({ ok: false, erro: msg });

// Aplica uma ação na vila (muda o objeto). Devolve { ok, erro?, ganho? }.
export function aplicar(v, a, agora) {
  avancar(v, agora);
  if (!a || typeof a !== 'object') return erro('Ação inválida');

  switch (a.tipo) {
    case 'construir': {
      const t = TIPOS[a.predio];
      if (!t || !t.cat) return erro('Prédio desconhecido');
      if (nivelDe(v.alegria) < t.nivel) return erro(`Libera no nível ${t.nivel}`);
      if (!podePagar(v, t.custo)) return erro('Recursos insuficientes');
      if (!cabe(v, a.x, a.z, t.tam)) return erro('Não cabe aqui');
      if (t.tempo && obrasDeConstrutor(v) >= construtores(v)) return erro('Todos os construtores estão ocupados');
      pagar(v, t.custo);
      const p = { id: 'p' + (++v.seq), tipo: a.predio, x: a.x, z: a.z, r: (a.r | 0) & 3, prog: 0 };
      if (ITENS[a.predio]) p.itens = {};
      if (t.melhorias) p.nv = 1;
      v.predios.push(p);
      if (t.tempo) { p.obra = { tipo: 'construir', fim: agora + t.tempo * 1000 }; return { ok: true, id: p.id, obra: p.obra }; }
      const ganho = alegriaAoConstruir(a.predio);
      ganharAlegria(v, ganho);
      return { ok: true, id: p.id, ganho: { alegria: ganho } };
    }

    case 'mover': {
      const p = predio(v, a.id);
      if (!p) return erro('Prédio não encontrado');
      if (!cabe(v, a.x, a.z, TIPOS[p.tipo].tam, p.id)) return erro('Não cabe aqui');
      p.x = a.x; p.z = a.z; p.r = (a.r | 0) & 3;
      return { ok: true };
    }

    case 'vender': {
      const p = predio(v, a.id);
      if (!p) return erro('Prédio não encontrado');
      const t = TIPOS[p.tipo];
      if (t.vendavel === false) return erro('Esse não dá pra vender');
      if (t.moradia && moradia(v) - moradiaDe(p) < v.duendes.length) return erro('Os duendes precisam de onde morar');
      const devolve = {};
      for (const [r, q] of Object.entries(t.custo)) { devolve[r] = Math.floor(q / 2); v[r] += devolve[r]; }
      for (const d of v.duendes) if (d.predio === p.id) d.predio = null;
      v.predios = v.predios.filter(x => x !== p);
      return { ok: true, ganho: devolve };
    }

    case 'coletar': {
      const p = predio(v, a.id);
      if (p && p.tipo === 'casa') {
        const k = prontos(p);
        if (k < 1 || !aluguelDe(p)) return erro('Nada pronto ainda');
        p.prog -= k;
        const ganho = { moedas: k * aluguelDe(p), doces: k * PRESENTE_DOCES, alegria: k };
        contar(v, 'alugueis');
        for (const [r, q] of Object.entries(ganho)) r === 'alegria' ? ganharAlegria(v, q) : (v[r] += q);
        return { ok: true, ganho };
      }
      const pr = p && TIPOS[p.tipo].prod;
      if (!pr) return erro('Esse prédio não produz');
      const k = prontos(p);
      if (k < 1) return erro('Nada pronto ainda');
      p.prog -= k;
      const ganho = { [pr.recurso]: k * pr.qtd };
      contar(v, 'coletas');
      if (pr.recurso !== 'alegria') ganho.alegria = k;
      for (const [r, q] of Object.entries(ganho)) r === 'alegria' ? ganharAlegria(v, q) : (v[r] += q);
      return { ok: true, ganho };
    }

    case 'contratar': {
      if (v.duendes.length >= moradia(v)) return erro('Construa uma casa pra mais duendes');
      if (!podePagar(v, CUSTO_DUENDE)) return erro('Doces insuficientes');
      pagar(v, CUSTO_DUENDE);
      const d = { id: 'd' + (++v.seq), nome: NOMES_DUENDES[v.duendes.length % NOMES_DUENDES.length], predio: null };
      v.duendes.push(d);
      return { ok: true, id: d.id };
    }

    case 'alocar': {
      const d = v.duendes.find(x => x.id === a.duende);
      if (!d) return erro('Duende não encontrado');
      if (a.predio == null) { d.predio = null; return { ok: true }; }
      const p = predio(v, a.predio);
      const pr = p && TIPOS[p.tipo].prod;
      if (!pr) return erro('Esse prédio não precisa de duendes');
      if (emConstrucao(p)) return erro('O prédio ainda está em obra');
      if (d.predio !== p.id && duendesEm(v, p.id) >= pr.vagas) return erro('Sem vaga nesse prédio');
      d.predio = p.id;
      return { ok: true };
    }

    case 'melhorar': {
      const p = predio(v, a.id);
      const ms = p && TIPOS[p.tipo].melhorias;
      if (!ms) return erro('Esse prédio não melhora');
      const m = ms[(p.nv || 1) - 1];
      if (!m) return erro('Já está no nível máximo');
      if (nivelDe(v.alegria) < m.nivelVila) return erro(`Precisa da vila no nível ${m.nivelVila}`);
      if (p.obra) return erro('Espere a obra terminar');
      if (obrasDeConstrutor(v) >= construtores(v)) return erro('Todos os construtores estão ocupados');
      if (!podePagar(v, m.custo)) return erro('Recursos insuficientes');
      pagar(v, m.custo);
      p.obra = { tipo: 'melhorar', fim: agora + (m.tempo || 0) * 1000 };
      if (!m.tempo) concluirObra(v, p);
      return { ok: true, obra: p.obra || null };
    }

    case 'item': {
      const p = predio(v, a.id);
      if (!p) return erro('Prédio não encontrado');
      if (typeof a.item !== 'string' || !ITENS[p.tipo] || !Object.hasOwn(ITENS[p.tipo], a.item)) return erro('Item desconhecido');
      const motivo = bloqueioItem(v, p, a.item);
      if (motivo) return erro(motivo);
      const def = ITENS[p.tipo][a.item], n = nivelItem(p, a.item);
      if (p.tipo === 'praca' && p.obra) return erro('Os moradores ainda estão enfeitando');
      if (p.obra) return erro('Espere a obra terminar');
      if (!podePagar(v, def.custos[n])) return erro('Recursos insuficientes');
      pagar(v, def.custos[n]);
      if (p.tipo === 'praca') {
        p.obra = { tipo: 'enfeite', item: a.item, fim: agora + TEMPO_ENFEITE(n) * 1000 };
        return { ok: true, obra: p.obra };
      }
      p.itens = { ...(p.itens || {}), [a.item]: n + 1 };
      ganharAlegria(v, def.alegria[n]);
      return { ok: true, nivel: n + 1, ganho: { alegria: def.alegria[n] } };
    }

    case 'presente': {
      const h = presenteDeHoje(v, agora);
      if (!h) return erro('Você já abriu o presente de hoje');
      receber(v, h.premio);
      v.diario = { ultimo: diaDe(agora), sequencia: h.sequencia };
      return { ok: true, ganho: h.premio, sequencia: h.sequencia, advento: h.advento };
    }

    case 'missao': {
      const m = MISSOES.find(x => x.id === a.id);
      if (!m) return erro('Missão desconhecida');
      if ((v.missoes || []).includes(m.id)) return erro('Prêmio já resgatado');
      if (!missoesAtivas(v).includes(m)) return erro('Missão ainda não liberada');
      if (m.progresso(v) < m.meta) return erro('Missão ainda não cumprida');
      v.missoes = [...(v.missoes || []), m.id];
      receber(v, m.premio);
      return { ok: true, ganho: m.premio };
    }

    case 'anuncio': {
      if (anunciosHoje(v, agora) >= ANUNCIOS_POR_DIA) return erro('Chega de vídeos por hoje. Volte amanhã!');
      let ganho = null;
      if (a.premio === 'estrelas') { v.estrelas = (v.estrelas || 0) + ANUNCIO_ESTRELAS; ganho = { estrelas: ANUNCIO_ESTRELAS }; }
      else if (a.premio === 'obra') {
        const p = predio(v, a.id);
        if (!p || !p.obra) return erro('Nada em obra aqui');
        p.obra = { ...p.obra, fim: p.obra.fim - ANUNCIO_ADIANTA * 1000 };
        if (agora >= p.obra.fim) concluirObra(v, p);
        ganho = {};
      } else return erro('Prêmio desconhecido');
      v.anuncios = { dia: diaDe(agora), n: anunciosHoje(v, agora) + 1 };
      return { ok: true, ganho };
    }

    case 'acelerar': {
      const p = predio(v, a.id);
      if (!p || !p.obra) return erro('Nada em obra aqui');
      const custo = custoAcelerar((p.obra.fim - agora) / 1000);
      if ((v.estrelas || 0) < custo) return erro('Estrelas insuficientes');
      v.estrelas -= custo;
      concluirObra(v, p);
      return { ok: true, custo };
    }

    case 'construtor': {
      const n = construtores(v);
      if (n >= MAX_CONSTRUTORES) return erro('Já tem todos os construtores');
      if ((v.estrelas || 0) < CUSTO_CONSTRUTOR[n]) return erro('Estrelas insuficientes');
      v.estrelas -= CUSTO_CONSTRUTOR[n];
      v.construtores = n + 1;
      return { ok: true };
    }

    default:
      return erro('Ação desconhecida');
  }
}
