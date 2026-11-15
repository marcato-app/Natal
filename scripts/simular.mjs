// Simulador de balanceamento: um jogador "robô" joga com as mesmas regras do jogo
// (assets/js/regras.js) e mede em que dia chega a cada nível.
//
//   node scripts/simular.mjs [dias=45] [sessoesPorDia=4] [minutosPorSessao=5]
//
// Ele abre o jogo algumas vezes por dia, coleta tudo, pega presente e missões, contrata
// e aloca duendes, constrói o que liberou, melhora casas, enfeita e compra terrenos.
// Não usa anúncio nem compra: é o ritmo de quem joga de graça.

import {
  novaVila, aplicar, avancar, cabe, TIPOS, ITENS, TERRENOS, MAPA_MIN, MAPA_MAX, CUSTO_DUENDE, CUSTO_CONSTRUTOR, MAX_CONSTRUTORES,
  nivelDe, prontos, duendesEm, moradia, podePagar, bloqueioItem, nivelItem, missoesAtivas, presenteDeHoje, obrasDeConstrutor, construtores, terrenoLivre, aluguelDe,
  pedidoChegou, meuEvento, TRILHA, COLECAO, serieCompleta,
} from '../assets/js/regras.js';

const DIAS = Number(process.argv[2] || 45), SESSOES = Number(process.argv[3] || 4), MIN = Number(process.argv[4] || 5);
const HORAS = [8, 12.5, 19, 22.5].slice(0, SESSOES);
const SEM_PEDIDOS = process.argv.includes('--sem-pedidos');
const INICIO = Date.parse('2026-11-16T03:00:00Z'); // meia-noite em Brasília
const v = novaVila(INICIO);
const marcos = {}, log = [];

function lugar(tam) {
  for (let r = 0; r < 30; r++) for (let x = MAPA_MIN; x <= MAPA_MAX - tam; x++) for (let z = MAPA_MIN; z <= MAPA_MAX - tam; z++) {
    if (Math.max(Math.abs(x + tam / 2 - 9), Math.abs(z + tam / 2 - 9)) > r + 3) continue;
    if (cabe(v, x, z, tam)) return { x, z };
  }
  return null;
}
const qtd = (tipo) => v.predios.filter(p => p.tipo === tipo).length;
// quantos de cada prédio o robô quer ter
const META = { casa: 6, padaria: 2, fabrica: 2, rinque: 1, correio: 1, confeitaria: 1, loja: 2, estacao: 1, mercado: 1, pista: 1, roda: 1, teatro: 1, castelo: 1, pousada: 1, oficina: 1, renas: 1, presepio: 1, chafariz: 1, arvoreGigante: 1, arco: 1, estatua: 1 };

function vez(agora) {
  const tenta = (a) => aplicar(v, a, agora).ok;
  if (presenteDeHoje(v, agora)) tenta({ tipo: 'presente' });
  for (const m of missoesAtivas(v)) if (m.progresso(v) >= m.meta) tenta({ tipo: 'missao', id: m.id });
  for (const p of v.predios) if (prontos(p) >= 1 && (TIPOS[p.tipo].prod || aluguelDe(p))) tenta({ tipo: 'coletar', id: p.id });
  // duendes: contrata se tem casa e vaga, e aloca os livres
  const vagas = () => v.predios.reduce((s, p) => s + (TIPOS[p.tipo].prod && !p.obra ? Math.max(0, TIPOS[p.tipo].prod.vagas - duendesEm(v, p.id)) : 0), 0);
  while (v.duendes.length < moradia(v) && vagas() > v.duendes.filter(d => !d.predio).length && podePagar(v, CUSTO_DUENDE)) if (!tenta({ tipo: 'contratar' })) break;
  for (const d of v.duendes.filter(d => !d.predio)) {
    const alvo = v.predios.filter(p => TIPOS[p.tipo].prod && !p.obra && duendesEm(v, p.id) < TIPOS[p.tipo].prod.vagas).sort((a, b) => TIPOS[b.tipo].prod.qtd - TIPOS[a.tipo].prod.qtd)[0];
    if (alvo) tenta({ tipo: 'alocar', duende: d.id, predio: alvo.id });
  }
  // construtor extra com estrelas
  if (construtores(v) < MAX_CONSTRUTORES && v.estrelas >= CUSTO_CONSTRUTOR[construtores(v)] + 10) tenta({ tipo: 'construtor' });
  const nivel = nivelDe(v.alegria);
  // obras: o que liberou e ainda falta
  if (obrasDeConstrutor(v) < construtores(v)) {
    const precisaCasa = v.duendes.length >= moradia(v) - 1;
    const opcoes = Object.entries(TIPOS).filter(([k, t]) => t.cat && t.nivel <= nivel && t.tempo && qtd(k) < (META[k] || 0) && podePagar(v, t.custo))
      .sort(([a], [b]) => (a === 'casa' && precisaCasa ? -1 : 0) - (b === 'casa' && precisaCasa ? -1 : 0) || TIPOS[a].nivel - TIPOS[b].nivel);
    for (const [k, t] of opcoes) { const l = lugar(t.tam); if (l && tenta({ tipo: 'construir', predio: k, ...l })) break; }
  }
  // aumentar casas
  for (const p of v.predios.filter(p => p.tipo === 'casa' && !p.obra)) if (obrasDeConstrutor(v) < construtores(v)) tenta({ tipo: 'melhorar', id: p.id });
  // terrenos quando falta espaço
  if (!lugar(4)) { const t = TERRENOS.filter(t => terrenoLivre(v, t) && t.nivel <= nivel && podePagar(v, t.custo)).sort((a, b) => a.custo.moedas - b.custo.moedas)[0]; if (t) tenta({ tipo: 'terreno', id: t.id }); }
  // enfeites e móveis (mantém uma reserva pra obras)
  const reserva = 300 + nivel * 150;
  // pedidos dos moradores (se não comer a reserva), prêmios do evento e coleção
  if (!SEM_PEDIDOS) {
    for (const ped of [...(v.pedidos || [])]) if (pedidoChegou(ped, agora) && Object.entries(ped.pede).every(([r, q]) => v[r] - q >= (r === 'moedas' ? reserva : 40))) tenta({ tipo: 'pedido', id: ped.id });
    const ev = meuEvento(v, agora);
    TRILHA.forEach((t, n) => { if (ev.pontos >= t.pontos && !ev.premios.includes(n)) tenta({ tipo: 'eventoPremio', n }); });
    for (const sr of COLECAO) if (serieCompleta(v, sr)) tenta({ tipo: 'colecao', serie: sr.id });
    for (const [k, q] of Object.entries(v.exclusivos || {})) if (q > 0) { const l = lugar(TIPOS[k].tam); if (l) tenta({ tipo: 'construir', predio: k, ...l }); }
  }
  const itens = [];
  for (const p of v.predios) for (const k of Object.keys(ITENS[p.tipo] || {})) if (!bloqueioItem(v, p, k)) { const c = ITENS[p.tipo][k].custos[nivelItem(p, k)]; itens.push({ p, k, c }); }
  itens.sort((a, b) => (a.c.moedas || 0) - (b.c.moedas || 0));
  for (const { p, k, c } of itens) if ((v.moedas - (c.moedas || 0)) > reserva && podePagar(v, c)) tenta({ tipo: 'item', id: p.id, item: k });
  // decorações sem obra (alegria barata)
  const decos = Object.entries(TIPOS).filter(([k, t]) => t.cat === 'decoracao' && !t.exclusivo && t.nivel <= nivel && (META[k] ? qtd(k) < META[k] : qtd(k) < 4)).sort(([, a], [, b]) => b.alegria / (b.custo.moedas || 1) - a.alegria / (a.custo.moedas || 1));
  for (const [k, t] of decos) if (v.moedas - (t.custo.moedas || 0) > reserva && podePagar(v, t.custo)) { const l = lugar(t.tam); if (l) tenta({ tipo: 'construir', predio: k, ...l }); }
}

for (let dia = 0; dia < DIAS; dia++) {
  for (const h of HORAS) {
    const ini = INICIO + dia * 86400000 + h * 3600000;
    for (let s = 0; s <= MIN * 60; s += 30) vez(ini + s * 1000);
    const n = nivelDe(v.alegria);
    for (let k = 1; k <= n; k++) if (!(k in marcos)) marcos[k] = (dia + 1) + (h / 24);
  }
  avancar(v, INICIO + (dia + 1) * 86400000);
  log.push(`dia ${String(dia + 1).padStart(2)}  nível ${String(nivelDe(v.alegria)).padStart(2)}  alegria ${String(v.alegria).padStart(6)}  moedas ${String(Math.floor(v.moedas)).padStart(7)}  doces ${String(Math.floor(v.doces)).padStart(5)}  estrelas ${String(v.estrelas).padStart(4)}  prédios ${v.predios.length}  duendes ${v.duendes.length}  terrenos ${(v.terrenos || []).length}  pedidos ${(v.stats || {}).pedidos || 0}  séries ${(v.stats || {}).series || 0}`);
}
if (process.argv.includes('--dias')) console.log(log.join('\n'));
console.log('Dia em que chega a cada nível (jogando ' + SESSOES + 'x por dia, ' + MIN + ' min):');
console.log(Object.entries(marcos).map(([n, d]) => `nível ${n}: dia ${d.toFixed(1)}`).join('\n'));
console.log(log[log.length - 1]);
