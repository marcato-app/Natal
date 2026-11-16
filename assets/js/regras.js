// Regras do jogo: catálogo de prédios, mapa e todas as ações.
//
// Módulo puro (sem DOM, sem banco). O navegador usa pra responder na hora e o
// Worker usa pra validar e gravar. Os dois têm de chegar no mesmo resultado, então
// nada aqui sorteia nem lê relógio: o horário entra sempre como parâmetro (`agora`,
// em ms) e os ids saem do contador da própria vila (`seq`).

export const VERSAO = 1;
export const TAMANHO = 18;          // a vila começa com uma grade de 18 x 18 lotes (0..17)
export const EXPANSAO = 6;          // terrenos à venda: blocos de 6 x 6 em volta dela
export const MAPA_MIN = -EXPANSAO, MAPA_MAX = TAMANHO + EXPANSAO;   // mapa completo: -6..23
export const ESTOQUE_MAX = 4;       // quantos ciclos de produção um prédio guarda
export const MAX_ACOES = 50;        // por requisição
// O trem passa na avenida de trás (linha MAPA_MIN). Estação encostada nele produz mais.
export const BONUS_TRILHO = 1.5;
export const pertoDoTrilho = (p) => p.tipo === 'estacao' && p.z === MAPA_MIN + 1;

// Ruas fixas do mapa (em lotes). Não dá pra construir em cima. A rua principal
// atravessa também os terrenos de expansão.
export const RUAS = [
  { x: MAPA_MIN, z: 10, w: MAPA_MAX - MAPA_MIN, h: 1 },
  { x: 9, z: 11, w: 1, h: 7 },
  // avenida em volta do mapa inteiro (nos terrenos de expansão) e a rua da frente até ela
  { x: 9, z: TAMANHO, w: 1, h: EXPANSAO - 1 },
  { x: MAPA_MIN, z: MAPA_MIN, w: MAPA_MAX - MAPA_MIN, h: 1 },
  { x: MAPA_MIN, z: MAPA_MAX - 1, w: MAPA_MAX - MAPA_MIN, h: 1 },
  { x: MAPA_MIN, z: MAPA_MIN + 1, w: 1, h: MAPA_MAX - MAPA_MIN - 2 },
  { x: MAPA_MAX - 1, z: MAPA_MIN + 1, w: 1, h: MAPA_MAX - MAPA_MIN - 2 },
];

// Alegria acumulada necessária pra cada nível: índice 0 = nível 1.
export const NIVEIS = [0, 20, 40, 90, 190, 360, 630, 1020, 1580, 2590, 3710, 5350, 7590, 10520, 15650, 21420, 28880, 38190, 50300, 65200];

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
  { id: 'pedido1', texto: 'Entregue um pedido de um morador', meta: 1, progresso: v => stat(v, 'pedidos'), premio: { moedas: 50 }, foco: 'pedidos' },
  { id: 'enfeite1', texto: 'Pendure o primeiro enfeite na árvore', meta: 1, progresso: v => somaItens(v, 'praca', 'arvore'), premio: { moedas: 40 }, foco: 'praca' },
  { id: 'fachada1', texto: 'Enfeite a fachada da casa', meta: 1, progresso: v => somaItens(v, 'casa', 'fachada'), premio: { doces: 20 }, foco: 'casa' },
  { id: 'padaria2', texto: 'Coloque 2 duendes na padaria', meta: 2, progresso: v => Math.max(0, ...v.predios.filter(p => p.tipo === 'padaria').map(p => duendesEm(v, p.id))), premio: { moedas: 50 }, foco: 'padaria' },
  { id: 'noel', texto: 'Receba a visita do Papai Noel', meta: 1, progresso: v => stat(v, 'alugueis'), premio: { estrelas: 3 }, foco: 'casa' },
  { id: 'duende4', texto: 'Contrate mais um duende', meta: 4, progresso: v => v.duendes.length, premio: { doces: 30 }, foco: 'duendes' },
  { id: 'moveis3', texto: 'Coloque 3 móveis na casa', meta: 3, progresso: v => somaItens(v, 'casa', 'moveis'), premio: { moedas: 80 }, foco: 'casa' },
  { id: 'nivel3', texto: 'Chegue ao nível 3 da vila', meta: 3, progresso: v => nivelDe(v.alegria), premio: { estrelas: 5 } },
  { id: 'estrela', texto: 'Coloque a estrela no topo da árvore', meta: 1, progresso: v => v.predios.some(p => p.tipo === 'praca' && nivelItem(p, 'estrela')) ? 1 : 0, premio: { estrelas: 10 }, foco: 'praca' },
  { id: 'casa2', texto: 'Aumente uma casa pro nível 2', meta: 2, progresso: v => Math.max(1, ...v.predios.filter(p => p.tipo === 'casa').map(p => p.nv || 1)), premio: { estrelas: 5 }, foco: 'casa' },
  { id: 'pedidos10', texto: 'Entregue 10 pedidos', meta: 10, progresso: v => stat(v, 'pedidos'), premio: { estrelas: 5 }, foco: 'pedidos' },
  { id: 'coletar30', texto: 'Faça 30 coletas', meta: 30, progresso: v => stat(v, 'coletas'), premio: { moedas: 150, doces: 30 } },
  { id: 'terreno1', texto: 'Compre um terreno pra vila crescer', meta: 1, progresso: v => (v.terrenos || []).length, premio: { estrelas: 5 } },
  { id: 'pisca5', texto: 'Ponha pisca-pisca em 5 pinheiros', meta: 5, progresso: v => v.predios.filter(p => ['pinheiro', 'abeto', 'espruce'].includes(p.tipo) && nivelItem(p, 'luzes')).length, premio: { moedas: 200 } },
  { id: 'correio', texto: 'Construa o Correio do Papai Noel', meta: 1, progresso: v => v.predios.filter(p => p.tipo === 'correio' && !p.obra).length, premio: { estrelas: 5 }, foco: 'construir' },
  { id: 'nivel6', texto: 'Chegue ao nível 6 da vila', meta: 6, progresso: v => nivelDe(v.alegria), premio: { estrelas: 8 } },
  { id: 'loja', texto: 'Construa a Loja de Brinquedos', meta: 1, progresso: v => v.predios.filter(p => p.tipo === 'loja' && !p.obra).length, premio: { moedas: 400 }, foco: 'construir' },
  { id: 'estacao', texto: 'Construa a Estação de Trem', meta: 1, progresso: v => v.predios.filter(p => p.tipo === 'estacao' && !p.obra).length, premio: { estrelas: 10 }, foco: 'construir' },
  { id: 'terreno4', texto: 'Tenha 4 terrenos comprados', meta: 4, progresso: v => (v.terrenos || []).length, premio: { estrelas: 15 } },
  { id: 'serie1', texto: 'Complete uma série da coleção', meta: 1, progresso: v => stat(v, 'series'), premio: { estrelas: 10 }, foco: 'colecao' },
  { id: 'nivel10', texto: 'Chegue ao nível 10 da vila', meta: 10, progresso: v => nivelDe(v.alegria), premio: { estrelas: 15 } },
  { id: 'roda', texto: 'Construa a Roda-Gigante', meta: 1, progresso: v => v.predios.filter(p => p.tipo === 'roda' && !p.obra).length, premio: { estrelas: 15 }, foco: 'construir' },
  { id: 'casas3', texto: 'Tenha 3 casas no nível 3', meta: 3, progresso: v => v.predios.filter(p => p.tipo === 'casa' && (p.nv || 1) >= 3).length, premio: { estrelas: 15 } },
  { id: 'nivel15', texto: 'Chegue ao nível 15 da vila', meta: 15, progresso: v => nivelDe(v.alegria), premio: { estrelas: 25 } },
  { id: 'castelo', texto: 'Construa o Castelo de Gelo', meta: 1, progresso: v => v.predios.filter(p => p.tipo === 'castelo' && !p.obra).length, premio: { estrelas: 25 }, foco: 'construir' },
  { id: 'oficina', texto: 'Construa a Oficina do Papai Noel', meta: 1, progresso: v => v.predios.filter(p => p.tipo === 'oficina' && !p.obra).length, premio: { estrelas: 50 }, foco: 'construir' },
  { id: 'arvore', texto: 'Complete todos os enfeites da árvore', meta: 17, progresso: v => somaItens(v, 'praca', 'arvore'), premio: { estrelas: 20 }, foco: 'praca' },
];
// As 3 primeiras missões ainda não resgatadas.
export function missoesAtivas(v) {
  const feitas = new Set(v.missoes || []);
  return MISSOES.filter(m => !feitas.has(m.id)).slice(0, 3);
}

// ---------- pedidos dos moradores ----------
// Um quadro com pedidos ("Dona Rosa quer 40 doces → paga 150 moedas + alegria"). Entregou,
// outro chega em PEDIDO_ESPERA; trocou, chega em PEDIDO_TROCA. O conteúdo sai de um contador
// próprio (v.pedSeq) passado por um embaralhador fixo: navegador e servidor geram o mesmo
// pedido sem sortear nada (e sem mexer no seq dos prédios).
export const PEDIDO_ESPERA = 3 * 60, PEDIDO_TROCA = 15 * 60;
export const MORADORES = ['Dona Rosa', 'Seu Tonico', 'Vovó Neve', 'Pedrinho', 'Luiza', 'Tio Beto', 'Dona Zefa', 'Lucas', 'Marina', 'Seu Amaro', 'Clarinha', 'Padre João'];
export const vagasPedidos = (v) => { const n = nivelDe(v.alegria); return n < 5 ? 3 : n < 10 ? 4 : 5; };
// número pseudoaleatório fixo em [0, 1) a partir de dois inteiros
export function sorte(a, b = 0) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
const escala = (n) => Math.pow(1.22, n - 1);
const arred = (x) => x < 100 ? Math.round(x / 5) * 5 || 5 : Math.round(x / 10) * 10;
function novoPedido(v, chega) {
  const k = v.pedSeq = (v.pedSeq || 0) + 1, n = nivelDe(v.alegria), e = escala(n), m = 0.8 + sorte(k, 1) * 0.6;
  const tipo = sorte(k, 2), ped = { id: 'o' + k, quem: MORADORES[Math.floor(sorte(k, 3) * MORADORES.length)], chega };
  const al = Math.max(1, Math.round(n * 0.6));
  if (tipo < 0.5) { const d = arred(25 * e * m); ped.pede = { doces: d }; ped.paga = { moedas: arred(d * 2.2 + 10), alegria: al }; }
  else if (tipo < 0.9) { const md = arred(70 * e * m); ped.pede = { moedas: md }; ped.paga = { doces: arred(md / 5 + 5), alegria: al }; }
  else { ped.pede = { doces: arred(15 * e * m), moedas: arred(45 * e * m) }; ped.paga = { estrelas: 1, alegria: al * 2 }; }
  if (sorte(k, 4) < 0.06 && !ped.paga.estrelas) ped.paga.estrelas = 1;
  if (sorte(k, 5) < 0.15) { const sr = COLECAO[Math.floor(sorte(k, 6) * COLECAO.length)]; ped.peca = `${sr.id}:${Math.floor(sorte(k, 7) * sr.pecas.length)}`; }
  return ped;
}
// completa o quadro (pedido novo chega na hora). Chamado em avancar().
function garantirPedidos(v, agora) {
  v.pedidos = v.pedidos || [];
  while (v.pedidos.length < vagasPedidos(v)) v.pedidos.push(novoPedido(v, agora));
}
export const pedidoChegou = (ped, agora) => agora >= ped.chega;

// ---------- evento da semana ----------
// Toda segunda (horário de Brasília) começa um evento novo. Pedidos, coletas, aluguéis e o
// presente diário dão pontos; a trilha de prêmios termina numa decoração exclusiva que só
// sai no evento. O tema da semana dá pontos em dobro numa coisa.
export const EVENTOS = [
  { id: 'biscoito', nome: 'Semana do Biscoito', dobro: 'doces', texto: 'Coletas de doces valem o dobro', exclusivo: 'casaBiscoito' },
  { id: 'luzes', nome: 'Semana das Luzes', dobro: 'aluguel', texto: 'Visitas do Papai Noel valem o dobro', exclusivo: 'tunelLuzes' },
  { id: 'presentes', nome: 'Semana dos Presentes', dobro: 'pedido', texto: 'Pedidos valem o dobro', exclusivo: 'presenteGigante' },
  { id: 'neve', nome: 'Semana da Neve', dobro: 'moedas', texto: 'Coletas de moedas valem o dobro', exclusivo: 'globoNeve' },
];
export const PONTOS = { pedido: 10, coleta: 1, aluguel: 2, presente: 5 };
export const TRILHA = [
  { pontos: 15, premio: { moedas: 150 } }, { pontos: 40, premio: { doces: 60 } }, { pontos: 80, premio: { estrelas: 5 } },
  { pontos: 130, premio: { moedas: 500, peca: true } }, { pontos: 200, premio: { doces: 200, estrelas: 5 } },
  { pontos: 290, premio: { moedas: 1500, peca: true } }, { pontos: 400, premio: { estrelas: 15, exclusivo: true } },
];
const INICIO_EVENTOS = Date.UTC(2026, 10, 16, 3); // segunda, 16/11/2026, 0h em Brasília
const SEMANA = 7 * 86400000;
export function eventoAtual(agora) {
  const semana = Math.floor((agora - INICIO_EVENTOS) / SEMANA), ev = EVENTOS[((semana % EVENTOS.length) + EVENTOS.length) % EVENTOS.length];
  return { ...ev, chave: `${ev.id}-${semana}`, fim: INICIO_EVENTOS + (semana + 1) * SEMANA };
}
// estado do jogador no evento de agora (zerado quando o evento muda)
export function meuEvento(v, agora) {
  const ev = eventoAtual(agora);
  return v.evento && v.evento.chave === ev.chave ? v.evento : { chave: ev.chave, pontos: 0, premios: [] };
}
function ganharPontos(v, agora, fonte, extra) {
  const ev = eventoAtual(agora), e = meuEvento(v, agora);
  const q = PONTOS[fonte] * (ev.dobro === fonte || ev.dobro === extra ? 2 : 1);
  v.evento = { ...e, pontos: e.pontos + q };
  return q;
}

// ---------- coleção de enfeites raros ----------
// Peças saem de pedidos (às vezes) e da trilha do evento. Série completa troca por prêmio
// (gasta uma de cada peça; dá pra completar de novo).
export const COLECAO = [
  { id: 'bolas', nome: 'Bolas de Cristal', pecas: ['Vermelha', 'Dourada', 'Azul', 'Prateada'], premio: { estrelas: 10, moedas: 300 } },
  { id: 'sinos', nome: 'Sinos Dourados', pecas: ['Sino pequeno', 'Sino duplo', 'Sino com laço', 'Sino grande'], premio: { estrelas: 10, doces: 120 } },
  { id: 'anjos', nome: 'Anjinhos', pecas: ['Anjo da harpa', 'Anjo da trombeta', 'Anjo da estrela', 'Anjo do sino', 'Anjo dormindo'], premio: { estrelas: 20, moedas: 600 } },
  { id: 'biscoitos', nome: 'Biscoitos Raros', pecas: ['Boneco de gengibre', 'Bengala doce', 'Estrela de açúcar'], premio: { estrelas: 8, doces: 200 } },
];
export const qtdPeca = (v, chave) => (v.colecao && v.colecao[chave]) || 0;
export const serieCompleta = (v, sr) => sr.pecas.every((_, i) => qtdPeca(v, `${sr.id}:${i}`) > 0);
function ganharPeca(v, chave) { v.colecao = { ...(v.colecao || {}), [chave]: qtdPeca(v, chave) + 1 }; }
// peça da trilha do evento: a que falta na série mais perto de completar (fixo, sem sorteio)
function pecaQueFalta(v) {
  let melhor = null;
  for (const sr of COLECAO) {
    const faltam = sr.pecas.map((_, i) => `${sr.id}:${i}`).filter(c => !qtdPeca(v, c));
    if (faltam.length && (!melhor || faltam.length < melhor.n)) melhor = { n: faltam.length, chave: faltam[0] };
  }
  return melhor ? melhor.chave : `${COLECAO[0].id}:0`;
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
  rinque: { nome: 'Rinque de Patinação', cat: 'diversao', tam: 4, custo: { moedas: 600, doces: 50 }, nivel: 3, tempo: 600, prod: { recurso: 'alegria', qtd: 8, ciclo: 120, vagas: 2 } },
  // ---- liberados do nível 4 ao 20 ----
  correio: { nome: 'Correio do Papai Noel', cat: 'diversao', tam: 3, custo: { moedas: 800, doces: 40 }, nivel: 4, tempo: 900, prod: { recurso: 'alegria', qtd: 6, ciclo: 180, vagas: 1 } },
  confeitaria: { nome: 'Confeitaria de Chocolate', cat: 'producao', tam: 3, custo: { moedas: 1100 }, nivel: 5, tempo: 1200, prod: { recurso: 'doces', qtd: 40, ciclo: 240, vagas: 2 } },
  loja: { nome: 'Loja de Brinquedos', cat: 'producao', tam: 3, custo: { moedas: 1500, doces: 60 }, nivel: 6, tempo: 1500, prod: { recurso: 'moedas', qtd: 110, ciclo: 240, vagas: 2 } },
  estacao: { nome: 'Estação de Trem', cat: 'producao', tam: 4, custo: { moedas: 2200, doces: 100 }, nivel: 7, tempo: 1800, prod: { recurso: 'moedas', qtd: 260, ciclo: 600, vagas: 3 } },
  mercado: { nome: 'Mercado de Natal', cat: 'diversao', tam: 4, custo: { moedas: 2600, doces: 120 }, nivel: 8, tempo: 2100, prod: { recurso: 'alegria', qtd: 12, ciclo: 300, vagas: 2 } },
  renas: { nome: 'Renas de Luz', cat: 'decoracao', tam: 2, custo: { moedas: 400, doces: 30 }, nivel: 9, alegria: 25 },
  pista: { nome: 'Pista de Trenó', cat: 'diversao', tam: 4, custo: { moedas: 3500, doces: 150 }, nivel: 10, tempo: 2700, prod: { recurso: 'alegria', qtd: 16, ciclo: 480, vagas: 2 } },
  igreja: { nome: 'Igreja', cat: 'decoracao', tam: 4, custo: { moedas: 3200, doces: 160 }, nivel: 9, tempo: 1800, alegria: 130 },
  presepio: { nome: 'Presépio', cat: 'decoracao', tam: 2, custo: { moedas: 700, doces: 50 }, nivel: 11, alegria: 40 },
  roda: { nome: 'Roda-Gigante', cat: 'diversao', tam: 4, custo: { moedas: 5000, doces: 200 }, nivel: 12, tempo: 3600, prod: { recurso: 'alegria', qtd: 22, ciclo: 600, vagas: 3 } },
  chafariz: { nome: 'Chafariz Congelado', cat: 'decoracao', tam: 2, custo: { moedas: 1100, doces: 80 }, nivel: 13, alegria: 60 },
  teatro: { nome: 'Teatro de Natal', cat: 'diversao', tam: 4, custo: { moedas: 7000, doces: 260 }, nivel: 14, tempo: 4500, prod: { recurso: 'alegria', qtd: 30, ciclo: 900, vagas: 3 } },
  arvoreGigante: { nome: 'Árvore Gigante', cat: 'decoracao', tam: 2, custo: { moedas: 1800, doces: 120 }, nivel: 15, alegria: 95 },
  castelo: { nome: 'Castelo de Gelo', cat: 'diversao', tam: 4, custo: { moedas: 9500, doces: 350 }, nivel: 16, tempo: 5400, prod: { recurso: 'alegria', qtd: 40, ciclo: 1200, vagas: 3 } },
  arco: { nome: 'Arco de Luzes', cat: 'decoracao', tam: 2, custo: { moedas: 2600, doces: 150 }, nivel: 17, alegria: 140 },
  pousada: { nome: 'Pousada da Neve', cat: 'casas', tam: 4, custo: { moedas: 6000, doces: 250 }, nivel: 18, tempo: 3600, moradia: 10 },
  estatua: { nome: 'Estátua do Papai Noel', cat: 'decoracao', tam: 2, custo: { moedas: 4000, doces: 220 }, nivel: 19, alegria: 200 },
  // decorações exclusivas: só saem como prêmio final do evento da semana (v.exclusivos)
  casaBiscoito: { nome: 'Casinha de Biscoito', cat: 'decoracao', tam: 2, custo: {}, nivel: 1, alegria: 60, exclusivo: true },
  tunelLuzes: { nome: 'Túnel de Luzes', cat: 'decoracao', tam: 2, custo: {}, nivel: 1, alegria: 60, exclusivo: true },
  presenteGigante: { nome: 'Presente Gigante', cat: 'decoracao', tam: 2, custo: {}, nivel: 1, alegria: 60, exclusivo: true },
  globoNeve: { nome: 'Globo de Neve Gigante', cat: 'decoracao', tam: 2, custo: {}, nivel: 1, alegria: 60, exclusivo: true },
  oficina: { nome: 'Oficina do Papai Noel', cat: 'producao', tam: 4, custo: { moedas: 15000, doces: 600, estrelas: 50 }, nivel: 20, tempo: 7200, prod: { recurso: 'estrelas', qtd: 3, ciclo: 1800, vagas: 4 } },
  pinheiro: { nome: 'Pinheiro', cat: 'decoracao', tam: 1, custo: { moedas: 15 }, nivel: 1, alegria: 2 },
  abeto: { nome: 'Abeto', cat: 'decoracao', tam: 1, custo: { moedas: 25 }, nivel: 2, alegria: 3 },
  espruce: { nome: 'Espruce Azul', cat: 'decoracao', tam: 1, custo: { moedas: 35 }, nivel: 3, alegria: 4 },
  boneco: { nome: 'Boneco de Neve', cat: 'decoracao', tam: 1, custo: { moedas: 30 }, nivel: 1, alegria: 5 },
  poste: { nome: 'Poste de Luz', cat: 'decoracao', tam: 1, custo: { moedas: 40 }, nivel: 2, alegria: 6 },
  presentes: { nome: 'Pilha de Presentes', cat: 'decoracao', tam: 1, custo: { moedas: 60, doces: 10 }, nivel: 2, alegria: 10 },
};

// Itens comprados dentro de um prédio: enfeites da árvore, decoração da fachada e
// móveis. custos[n] leva o item do nível n ao n+1 (0 = ainda não tem) e dá alegria[n].
// nivelCasa: nível mínimo da casa pra ter o item. precisa: outro item que vem antes.
const PISCA_PINHEIRO = { luzes: { nome: 'Pisca-pisca', grupo: 'pisca', custos: [{ moedas: 20 }, { moedas: 45 }], alegria: [2, 3] } };
export const ITENS = {
  pinheiro: PISCA_PINHEIRO, abeto: PISCA_PINHEIRO, espruce: PISCA_PINHEIRO,
  praca: {
    luzes: { nome: 'Pisca-pisca branco quente', grupo: 'arvore', custos: [{ moedas: 20 }, { moedas: 60 }, { moedas: 150 }], alegria: [3, 5, 8] },
    bolas: { nome: 'Bolas vermelhas, verdes e brancas', grupo: 'arvore', custos: [{ moedas: 30 }, { moedas: 80 }, { moedas: 180, doces: 10 }], alegria: [3, 6, 9] },
    festao: { nome: 'Laços de veludo', grupo: 'arvore', custos: [{ moedas: 50 }, { moedas: 140, doces: 15 }], alegria: [4, 8] },
    flores: { nome: 'Bicos-de-papagaio', grupo: 'arvore', custos: [{ moedas: 80 }, { moedas: 200, doces: 20 }], alegria: [5, 9] },
    ursinhos: { nome: 'Ursinhos e bengalas doces', grupo: 'arvore', custos: [{ moedas: 60, doces: 10 }, { moedas: 160, doces: 25 }], alegria: [4, 8] },
    presentes: { nome: 'Presentes embaixo', grupo: 'arvore', custos: [{ moedas: 40, doces: 5 }, { moedas: 100, doces: 15 }, { moedas: 220, doces: 30 }], alegria: [4, 7, 10] },
    borboleta: { nome: 'Borboleta de luz', grupo: 'arvore', custos: [{ moedas: 250, doces: 40 }], alegria: [18], precisa: 'luzes' },
    estrela: { nome: 'Estrela de cristal no topo', grupo: 'arvore', custos: [{ moedas: 120, doces: 20 }], alegria: [15], precisa: 'luzes' },
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

// Terrenos de expansão: os 16 blocos em volta da vila. Os do lado da rua são os
// primeiros (mais baratos); fundos e frente depois; cantos por último.
export const TERRENOS = (() => {
  const lista = [];
  for (const bx of [-6, 0, 6, 12, 18]) for (const bz of [-6, 0, 6, 12, 18]) {
    const dentro = bx >= 0 && bx < TAMANHO && bz >= 0 && bz < TAMANHO;
    if (dentro) continue;
    const canto = (bx < 0 || bx >= TAMANHO) && (bz < 0 || bz >= TAMANHO);
    const ladoRua = !canto && (bx < 0 || bx >= TAMANHO) && bz === 6;
    const custo = canto ? { moedas: 2500, estrelas: 20 } : ladoRua ? { moedas: 800 } : (bx < 0 || bx >= TAMANHO) ? { moedas: 1200 } : { moedas: 1500 };
    const nivel = canto ? 5 : ladoRua ? 2 : 3;
    lista.push({ id: `t${bx}_${bz}`, x: bx, z: bz, w: EXPANSAO, h: EXPANSAO, custo, nivel });
  }
  return lista;
})();
export const terreno = (id) => TERRENOS.find(t => t.id === id) || null;
export function terrenoLivre(v, t) { return !(v.terrenos || []).includes(t.id); }

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

// O lote (x,z) é da vila? (área inicial ou terreno comprado)
export function naVila(v, x, z) {
  if (x >= 0 && z >= 0 && x < TAMANHO && z < TAMANHO) return true;
  const meus = v.terrenos || [];
  return TERRENOS.some(t => meus.includes(t.id) && x >= t.x && x < t.x + t.w && z >= t.z && z < t.z + t.h);
}

// O lote (x,z) com tamanho tam cabe? ignorar = id de prédio que não conta (ao mover).
export function cabe(v, x, z, tam, ignorar = null) {
  if (!Number.isInteger(x) || !Number.isInteger(z)) return false;
  if (x < MAPA_MIN || z < MAPA_MIN || x + tam > MAPA_MAX || z + tam > MAPA_MAX) return false;
  for (let i = x; i < x + tam; i++) for (let j = z; j < z + tam; j++) if (ehRua(i, j) || !naVila(v, i, j)) return false;
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
  if (!(dt > 0)) { if (!v.pedidos) garantirPedidos(v, agora); return; }
  for (const p of v.predios) {
    if (p.obra && agora >= p.obra.fim) concluirObra(v, p);
    if (emConstrucao(p)) continue;
    if (aluguelDe(p)) { p.prog = Math.min(ESTOQUE_MAX, (p.prog || 0) + dt / ALUGUEL_CICLO); continue; }
    const pr = TIPOS[p.tipo].prod;
    if (!pr) continue;
    const n = Math.min(duendesEm(v, p.id), pr.vagas);
    if (!n) continue;
    p.prog = Math.min(ESTOQUE_MAX, (p.prog || 0) + dt * (n / pr.vagas) * (pertoDoTrilho(p) ? BONUS_TRILHO : 1) / pr.ciclo);
  }
  v.t = agora;
  garantirPedidos(v, agora);
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

/* ------------------------------ amigos ------------------------------ */
// Estas não passam por aplicar(): o servidor chama quando um AMIGO age (o dono não pode
// se dar ajuda nem presente pela fila de ações).
export const PRESENTE_AMIGO = { moedas: 30, doces: 10 };
export const AJUDA_OBRA = 10 * 60;        // segundos que uma ajuda tira de uma obra
export const AJUDA_PRODUCAO = 0.5;        // ciclos de produção que uma ajuda adianta
export const RECOMPENSA_AJUDANTE = { moedas: 15 };

// Ajuda de amigo num prédio: adianta a obra ou a produção.
export function receberAjuda(v, id, agora) {
  avancar(v, agora);
  const p = predio(v, id);
  if (!p) return { ok: false, erro: 'Prédio não encontrado' };
  if (p.obra && p.obra.tipo !== 'enfeite' && p.obra.item === undefined) {
    p.obra = { ...p.obra, fim: p.obra.fim - AJUDA_OBRA * 1000 };
    if (agora >= p.obra.fim) concluirObra(v, p);
    return { ok: true, como: 'obra' };
  }
  const pr = TIPOS[p.tipo].prod;
  if (pr || aluguelDe(p)) {
    p.prog = Math.min(ESTOQUE_MAX, (p.prog || 0) + AJUDA_PRODUCAO);
    return { ok: true, como: 'producao' };
  }
  return { ok: false, erro: 'Esse prédio não precisa de ajuda' };
}
export function darRecompensa(v, premio, agora) { avancar(v, agora); receber(v, premio); }

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
      if (t.exclusivo && !((v.exclusivos || {})[a.predio] > 0)) return erro('Essa decoração só sai no evento');
      if (!podePagar(v, t.custo)) return erro('Recursos insuficientes');
      if (!cabe(v, a.x, a.z, t.tam)) return erro('Não cabe aqui');
      if (t.tempo && obrasDeConstrutor(v) >= construtores(v)) return erro('Todos os construtores estão ocupados');
      pagar(v, t.custo);
      if (t.exclusivo) v.exclusivos = { ...v.exclusivos, [a.predio]: v.exclusivos[a.predio] - 1 };
      const p = { id: 'p' + (++v.seq), tipo: a.predio, x: a.x, z: a.z, r: (a.r | 0) & 3, prog: 0 };
      if (ITENS[a.predio]) p.itens = {};
      if (t.melhorias) p.nv = 1;
      v.predios.push(p);
      if (t.tempo) { p.obra = { tipo: 'construir', fim: agora + t.tempo * 1000 }; return { ok: true, id: p.id, obra: p.obra }; }
      // decoração repetida vale menos (a 2ª dá metade, a 3ª um terço...): incentiva variar
      const iguais = v.predios.filter(x => x.tipo === a.predio).length - 1;
      const ganho = Math.max(1, Math.floor(alegriaAoConstruir(a.predio) / (1 + iguais)));
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
        return { ok: true, ganho, pontos: ganharPontos(v, agora, 'aluguel') };
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
      return { ok: true, ganho, pontos: ganharPontos(v, agora, 'coleta', pr.recurso) };
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
      return { ok: true, ganho: h.premio, sequencia: h.sequencia, advento: h.advento, pontos: ganharPontos(v, agora, 'presente') };
    }

    case 'pedido': {
      const i = (v.pedidos || []).findIndex(x => x.id === a.id), ped = v.pedidos?.[i];
      if (!ped) return erro('Pedido não encontrado');
      if (!pedidoChegou(ped, agora)) return erro('Esse pedido ainda não chegou');
      if (!podePagar(v, ped.pede)) return erro('Faltam recursos pra esse pedido');
      pagar(v, ped.pede);
      receber(v, ped.paga);
      if (ped.peca) ganharPeca(v, ped.peca);
      contar(v, 'pedidos');
      const pontos = ganharPontos(v, agora, 'pedido');
      v.pedidos.splice(i, 1, novoPedido(v, agora + PEDIDO_ESPERA * 1000));
      return { ok: true, ganho: ped.paga, peca: ped.peca || null, pontos };
    }

    case 'trocarPedido': {
      const i = (v.pedidos || []).findIndex(x => x.id === a.id);
      if (i < 0) return erro('Pedido não encontrado');
      if (!pedidoChegou(v.pedidos[i], agora)) return erro('Esse pedido ainda não chegou');
      v.pedidos.splice(i, 1, novoPedido(v, agora + PEDIDO_TROCA * 1000));
      return { ok: true };
    }

    case 'eventoPremio': {
      const ev = eventoAtual(agora), e = meuEvento(v, agora), n = a.n | 0, passo = TRILHA[n];
      if (!passo) return erro('Prêmio desconhecido');
      if (e.premios.includes(n)) return erro('Prêmio já resgatado');
      if (e.pontos < passo.pontos) return erro('Faltam pontos pra esse prêmio');
      const { peca, exclusivo, ...rec } = passo.premio;
      receber(v, rec);
      const ganho = { ...rec };
      if (peca) { const c = pecaQueFalta(v); ganharPeca(v, c); ganho.peca = c; }
      if (exclusivo) { v.exclusivos = { ...(v.exclusivos || {}), [ev.exclusivo]: ((v.exclusivos || {})[ev.exclusivo] || 0) + 1 }; ganho.exclusivo = ev.exclusivo; }
      v.evento = { ...e, premios: [...e.premios, n] };
      return { ok: true, ganho };
    }

    case 'colecao': {
      const sr = COLECAO.find(x => x.id === a.serie);
      if (!sr) return erro('Série desconhecida');
      if (!serieCompleta(v, sr)) return erro('Ainda faltam peças nessa série');
      v.colecao = { ...v.colecao };
      sr.pecas.forEach((_, i) => { v.colecao[`${sr.id}:${i}`]--; });
      receber(v, sr.premio);
      contar(v, 'series');
      return { ok: true, ganho: sr.premio };
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

    case 'terreno': {
      const t = terreno(a.id);
      if (!t) return erro('Terreno desconhecido');
      if (!terrenoLivre(v, t)) return erro('Esse terreno já é seu');
      if (nivelDe(v.alegria) < t.nivel) return erro(`Libera no nível ${t.nivel}`);
      if (!podePagar(v, t.custo)) return erro('Recursos insuficientes');
      pagar(v, t.custo);
      v.terrenos = [...(v.terrenos || []), t.id];
      ganharAlegria(v, 10);
      return { ok: true, ganho: { alegria: 10 } };
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
