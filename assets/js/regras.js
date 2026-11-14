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
  casa: { nome: 'Casinha', cat: 'casas', tam: 3, custo: { moedas: 150 }, nivel: 1, moradia: 4 },
  padaria: { nome: 'Padaria de Biscoitos', cat: 'producao', tam: 3, custo: { moedas: 250 }, nivel: 1, prod: { recurso: 'doces', qtd: 15, ciclo: 90, vagas: 2 } },
  fabrica: { nome: 'Fábrica de Brinquedos', cat: 'producao', tam: 4, custo: { moedas: 400 }, nivel: 2, prod: { recurso: 'moedas', qtd: 40, ciclo: 60, vagas: 3 } },
  rinque: { nome: 'Rinque de Patinação', cat: 'diversao', tam: 4, custo: { moedas: 600, doces: 50 }, nivel: 3, prod: { recurso: 'alegria', qtd: 12, ciclo: 120, vagas: 2 } },
  pinheiro: { nome: 'Pinheiro', cat: 'decoracao', tam: 1, custo: { moedas: 15 }, nivel: 1, alegria: 2 },
  boneco: { nome: 'Boneco de Neve', cat: 'decoracao', tam: 1, custo: { moedas: 30 }, nivel: 1, alegria: 5 },
  poste: { nome: 'Poste de Luz', cat: 'decoracao', tam: 1, custo: { moedas: 40 }, nivel: 2, alegria: 6 },
  presentes: { nome: 'Pilha de Presentes', cat: 'decoracao', tam: 1, custo: { moedas: 60, doces: 10 }, nivel: 2, alegria: 10 },
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

export function moradia(v) {
  return v.predios.reduce((s, p) => s + (TIPOS[p.tipo].moradia || 0), 0);
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

// Ciclos inteiros prontos pra coletar.
export function prontos(p) {
  return Math.floor((p.prog || 0) + 1e-9);
}

/* ------------------------------ vila nova ------------------------------ */

export function novaVila(agora) {
  const v = {
    v: VERSAO, t: agora, seq: 0,
    moedas: 500, doces: 60, alegria: 0,
    predios: [], duendes: [],
  };
  const add = (tipo, x, z) => { const p = { id: 'p' + (++v.seq), tipo, x, z, r: 0, prog: 0 }; v.predios.push(p); return p; };
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
    const pr = TIPOS[p.tipo].prod;
    if (!pr) continue;
    const n = Math.min(duendesEm(v, p.id), pr.vagas);
    if (!n) continue;
    p.prog = Math.min(ESTOQUE_MAX, (p.prog || 0) + dt * (n / pr.vagas) / pr.ciclo);
  }
  v.t = agora;
}

/* ------------------------------ ações ------------------------------ */

function pagar(v, custo) { for (const [r, q] of Object.entries(custo)) v[r] -= q; }
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
      pagar(v, t.custo);
      const p = { id: 'p' + (++v.seq), tipo: a.predio, x: a.x, z: a.z, r: (a.r | 0) & 3, prog: 0 };
      v.predios.push(p);
      const ganho = alegriaAoConstruir(a.predio);
      v.alegria += ganho;
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
      if (t.moradia && moradia(v) - t.moradia < v.duendes.length) return erro('Os duendes precisam de onde morar');
      const devolve = {};
      for (const [r, q] of Object.entries(t.custo)) { devolve[r] = Math.floor(q / 2); v[r] += devolve[r]; }
      for (const d of v.duendes) if (d.predio === p.id) d.predio = null;
      v.predios = v.predios.filter(x => x !== p);
      return { ok: true, ganho: devolve };
    }

    case 'coletar': {
      const p = predio(v, a.id);
      const pr = p && TIPOS[p.tipo].prod;
      if (!pr) return erro('Esse prédio não produz');
      const k = prontos(p);
      if (k < 1) return erro('Nada pronto ainda');
      p.prog -= k;
      const ganho = { [pr.recurso]: k * pr.qtd };
      if (pr.recurso !== 'alegria') ganho.alegria = k;
      for (const [r, q] of Object.entries(ganho)) v[r] += q;
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
      if (d.predio !== p.id && duendesEm(v, p.id) >= pr.vagas) return erro('Sem vaga nesse prédio');
      d.predio = p.id;
      return { ok: true };
    }

    default:
      return erro('Ação desconhecida');
  }
}
