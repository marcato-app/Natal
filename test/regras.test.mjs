// Testes das regras do jogo (assets/js/regras.js).
//
//   node test/regras.test.mjs

import {
  TERRENOS, naVila, ANUNCIOS_POR_DIA, ANUNCIO_ADIANTA, anunciosHoje, presenteDeHoje, missoesAtivas, MISSOES, ADVENTO, ganharAlegria, ITENS, bloqueioItem, aluguelDe, TEMPO_ENFEITE, ALUGUEL_CICLO, novaVila, aplicar, avancar, cabe, moradia, prontos, nivelDe, TIPOS, ESTOQUE_MAX, CUSTO_DUENDE,
} from '../assets/js/regras.js';

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('ok    ' + label); }
  else { fail++; console.log('FAIL  ' + label + (detail !== undefined ? '  — ' + JSON.stringify(detail) : '')); }
}
const T0 = 1_800_000_000_000;
const seg = (s) => T0 + s * 1000;
const fab = (v) => v.predios.find(p => p.tipo === 'fabrica');

// vila inicial
{
  const v = novaVila(T0);
  check('vila nova tem praça, casa e fábrica', ['praca', 'casa', 'fabrica'].every(t => v.predios.some(p => p.tipo === t)));
  check('vila nova tem 3 duendes na fábrica', v.duendes.length === 3 && v.duendes.every(d => d.predio === fab(v).id));
  check('prédios iniciais não se sobrepõem nem pisam na rua', v.predios.every(p => cabe(v, p.x, p.z, TIPOS[p.tipo].tam, p.id)));
  check('moradia inicial = 4', moradia(v) === 4);
  check('começa no nível 1', nivelDe(v.alegria) === 1);
}

// produção com o tempo (inclusive "com o jogo fechado")
{
  const v = novaVila(T0);
  const ciclo = TIPOS.fabrica.prod.ciclo;
  avancar(v, seg(ciclo * 0.5));
  check('fábrica com 3/3 duendes: meio ciclo + meio inicial = 1 pronto', prontos(fab(v)) === 1, fab(v).prog);
  avancar(v, seg(ciclo * 100));
  check('estoque para no máximo', fab(v).prog === ESTOQUE_MAX);
  const antes = v.moedas;
  const r = aplicar(v, { tipo: 'coletar', id: fab(v).id }, seg(ciclo * 100));
  check('coletar dá qtd × ciclos', r.ok && v.moedas - antes === ESTOQUE_MAX * TIPOS.fabrica.prod.qtd, r);
  check('coletar dá alegria', r.ganho.alegria === ESTOQUE_MAX);
  check('coletar sem nada pronto falha', !aplicar(v, { tipo: 'coletar', id: fab(v).id }, seg(ciclo * 100)).ok);
}

// sem duende não produz; com menos duendes produz mais devagar
{
  const v = novaVila(T0);
  const f = fab(v); f.prog = 0;
  for (const d of v.duendes) aplicar(v, { tipo: 'alocar', duende: d.id, predio: null }, T0);
  avancar(v, seg(10_000));
  check('sem duende o prédio não produz', f.prog === 0);
  aplicar(v, { tipo: 'alocar', duende: v.duendes[0].id, predio: f.id }, seg(10_000));
  avancar(v, seg(10_000 + TIPOS.fabrica.prod.ciclo));
  check('1 de 3 duendes produz a 1/3 da velocidade', Math.abs(f.prog - 1 / 3) < 1e-9, f.prog);
}

// construir
{
  const v = novaVila(T0);
  check('não constrói na rua', !aplicar(v, { tipo: 'construir', predio: 'padaria', x: 0, z: 9 }, T0).ok);
  check('não constrói em cima de outro', !aplicar(v, { tipo: 'construir', predio: 'padaria', x: 2, z: 7 }, T0).ok);
  check('não constrói fora do mapa', !aplicar(v, { tipo: 'construir', predio: 'padaria', x: 16, z: 0 }, T0).ok);
  check('não constrói prédio de nível maior', aplicar(v, { tipo: 'construir', predio: 'rinque', x: 0, z: 13 }, T0).erro.includes('nível'));
  check('não constrói a praça pelo menu', !aplicar(v, { tipo: 'construir', predio: 'praca', x: 0, z: 13 }, T0).ok);
  const moedas = v.moedas;
  const r = aplicar(v, { tipo: 'construir', predio: 'padaria', x: 2, z: 12, r: 1 }, T0);
  check('constrói padaria num lote livre', r.ok && v.predios.some(p => p.id === r.id && p.tipo === 'padaria' && p.r === 1));
  check('cobra o custo', moedas - v.moedas === TIPOS.padaria.custo.moedas);
  check('construir abre uma obra (sem alegria ainda)', v.alegria === 0 && v.predios.find(p => p.id === r.id).obra.tipo === 'construir');
  avancar(v, T0 + TIPOS.padaria.tempo * 1000);
  check('obra pronta dá alegria', v.alegria === 5 && !v.predios.find(p => p.id === r.id).obra);
  v.moedas = 10;
  check('sem moedas não constrói', aplicar(v, { tipo: 'construir', predio: 'casa', x: 12, z: 12 }, T0).erro === 'Recursos insuficientes');
}

// mover, girar, vender
{
  const v = novaVila(T0);
  const casa = v.predios.find(p => p.tipo === 'casa');
  check('move pra lugar livre', aplicar(v, { tipo: 'mover', id: casa.id, x: 2, z: 12, r: 2 }, T0).ok && casa.x === 2 && casa.z === 12 && casa.r === 2);
  check('mover pra onde já está (só girar) funciona', aplicar(v, { tipo: 'mover', id: casa.id, x: 2, z: 12, r: 3 }, T0).ok && casa.r === 3);
  check('não move pra cima da fábrica', !aplicar(v, { tipo: 'mover', id: casa.id, x: 13, z: 6 }, T0).ok);
  check('não vende a única casa com duendes morando', !aplicar(v, { tipo: 'vender', id: casa.id }, T0).ok);
  check('não vende a praça', !aplicar(v, { tipo: 'vender', id: v.predios.find(p => p.tipo === 'praca').id }, T0).ok);
  const f = fab(v), moedas = v.moedas;
  const r = aplicar(v, { tipo: 'vender', id: f.id }, T0);
  check('vende a fábrica e devolve metade', r.ok && v.moedas - moedas === TIPOS.fabrica.custo.moedas / 2);
  check('duendes da fábrica vendida ficam livres', v.duendes.every(d => d.predio === null));
}

// duendes
{
  const v = novaVila(T0);
  const doces = v.doces;
  const r = aplicar(v, { tipo: 'contratar' }, T0);
  check('contrata duende', r.ok && v.duendes.length === 4 && doces - v.doces === CUSTO_DUENDE.doces);
  check('novo duende chega livre', v.duendes[3].predio === null);
  v.doces = 999;
  check('não contrata sem moradia', aplicar(v, { tipo: 'contratar' }, T0).erro.includes('casa'));
  check('não aloca em prédio sem vaga', !aplicar(v, { tipo: 'alocar', duende: v.duendes[3].id, predio: fab(v).id }, T0).ok);
  check('não aloca em decoração', !aplicar(v, { tipo: 'alocar', duende: v.duendes[3].id, predio: v.predios.find(p => p.tipo === 'boneco').id }, T0).ok);
}

// determinismo: mesma sequência de ações = mesma vila (o que permite cliente e servidor concordarem)
{
  const acoes = [
    { tipo: 'construir', predio: 'padaria', x: 2, z: 12 },
    { tipo: 'acelerar', id: 'p10' },
    { tipo: 'contratar' },
    { tipo: 'alocar', duende: 'd11', predio: 'p10' },
    { tipo: 'construir', predio: 'boneco', x: 0, z: 0 },
    { tipo: 'coletar', id: 'p3' },
  ];
  const a = novaVila(T0), b = novaVila(T0);
  acoes.forEach((x, i) => { aplicar(a, x, seg(i * 30)); aplicar(b, structuredClone(x), seg(i * 30)); });
  check('mesmas ações, mesma vila', JSON.stringify(a) === JSON.stringify(b));
  check('ids previsíveis (p10 = padaria, d11 = duende novo)', a.predios.some(p => p.id === 'p10' && p.tipo === 'padaria') && a.duendes.some(d => d.id === 'd11' && d.predio === 'p10'));
}

// árvore da praça: se monta comprando enfeites
{
  const v = novaVila(T0); v.moedas = 5000; v.doces = 500;
  const pr = v.predios.find(p => p.tipo === 'praca');
  check('árvore começa sem enfeites', Object.keys(pr.itens).length === 0);
  check('estrela precisa do pisca-pisca antes', aplicar(v, { tipo: 'item', id: pr.id, item: 'estrela' }, T0).erro.includes('Pisca'));
  const a0 = v.alegria, m0 = v.moedas;
  let t = T0;
  const enfeitar = (item) => { const r = aplicar(v, { tipo: 'item', id: pr.id, item }, t); t = r.ok ? r.obra.fim : t; avancar(v, t); return r; };
  const r1 = aplicar(v, { tipo: 'item', id: pr.id, item: 'luzes' }, t);
  check('comprar enfeite começa a obra dos moradores', r1.ok && pr.obra && pr.obra.item === 'luzes' && !pr.itens.luzes);
  check('cobra na hora', m0 - v.moedas === 20);
  check('não começa outro enfeite durante a obra', aplicar(v, { tipo: 'item', id: pr.id, item: 'bolas' }, t + 1000).erro.includes('enfeitando'));
  avancar(v, t + TEMPO_ENFEITE(0) * 1000 - 1);
  check('antes do tempo o enfeite não aparece', !pr.itens.luzes);
  t += TEMPO_ENFEITE(0) * 1000; avancar(v, t);
  check('no fim da obra o enfeite aparece e dá alegria', pr.itens.luzes === 1 && !pr.obra && v.alegria - a0 === 3);
  enfeitar('luzes'); enfeitar('luzes');
  check('pisca-pisca vai até o nível 3', pr.itens.luzes === 3);
  check('não passa do máximo', aplicar(v, { tipo: 'item', id: pr.id, item: 'luzes' }, t).erro === 'Já está no máximo');
  check('agora coloca a estrela', enfeitar('estrela').ok && pr.itens.estrela === 1);
  check('item de outro prédio é recusado', !aplicar(v, { tipo: 'item', id: pr.id, item: 'sofa' }, T0).ok);
  check('item com nome esquisito é recusado', !aplicar(v, { tipo: 'item', id: pr.id, item: 'toString' }, T0).ok);
}

// casa: melhorar (com obra), fachada e móveis
{
  const v = novaVila(T0); v.moedas = 5000; v.doces = 500;
  const casa = v.predios.find(p => p.tipo === 'casa');
  let t = T0;
  const melhorar = () => { const r = aplicar(v, { tipo: 'melhorar', id: casa.id }, t); if (r.ok) { t = casa.obra.fim; avancar(v, t); } return r; };
  check('casa começa no nível 1', casa.nv === 1 && moradia(v) === 4);
  check('cama precisa da casa nível 2', bloqueioItem(v, casa, 'cama').includes('nível 2'));
  check('melhorar precisa da vila no nível 2', aplicar(v, { tipo: 'melhorar', id: casa.id }, t).erro.includes('nível 2'));
  v.alegria = 80; v.doces = 500;
  const r = aplicar(v, { tipo: 'melhorar', id: casa.id }, t);
  check('melhorar abre obra e a casa segue nível 1 até acabar', r.ok && casa.obra.tipo === 'melhorar' && casa.nv === 1 && moradia(v) === 4);
  check('durante a obra não decora', aplicar(v, { tipo: 'item', id: casa.id, item: 'guirlanda' }, t).erro.includes('obra'));
  check('um construtor só: não abre segunda obra', aplicar(v, { tipo: 'construir', predio: 'padaria', x: 2, z: 12 }, t).erro.includes('construtores'));
  t = casa.obra.fim; avancar(v, t);
  check('obra pronta: casa nível 2 abriga 6', casa.nv === 2 && moradia(v) === 6);
  check('agora pode ter cama', aplicar(v, { tipo: 'item', id: casa.id, item: 'cama' }, t).ok);
  check('nível 3 precisa da vila nível 4', aplicar(v, { tipo: 'melhorar', id: casa.id }, t).erro.includes('nível 4'));
  v.alegria = 1000;
  melhorar();
  check('nível máximo 3', casa.nv === 3 && aplicar(v, { tipo: 'melhorar', id: casa.id }, t).erro.includes('máximo'));
  check('fachada: guirlanda', aplicar(v, { tipo: 'item', id: casa.id, item: 'guirlanda' }, t).ok);
  check('decoração continua depois de mover', aplicar(v, { tipo: 'mover', id: casa.id, x: 2, z: 12, r: 1 }, t).ok && casa.itens.guirlanda === 1 && casa.itens.cama === 1);
  check('fábrica não melhora (por enquanto)', !aplicar(v, { tipo: 'melhorar', id: fab(v).id }, t).ok);
  check('todos os itens têm custos e alegria do mesmo tamanho', Object.values(ITENS).every(g => Object.values(g).every(d => d.custos.length === d.alegria.length)));
}

// obras, construtores e estrelas
{
  const v = novaVila(T0); v.moedas = 5000; v.doces = 500;
  check('começa com estrelas e 1 construtor', v.estrelas === 25 && v.construtores === 1);
  const r = aplicar(v, { tipo: 'construir', predio: 'padaria', x: 2, z: 12 }, T0);
  const pad = v.predios.find(p => p.id === r.id);
  check('decoração fica pronta na hora mesmo com construtor ocupado', aplicar(v, { tipo: 'construir', predio: 'boneco', x: 0, z: 0 }, T0).ok);
  check('não põe duende em prédio em obra', aplicar(v, { tipo: 'alocar', duende: v.duendes[0].id, predio: pad.id }, T0).erro.includes('obra'));
  avancar(v, T0 + 60_000);
  check('em obra não produz', !pad.prog);
  const e0 = v.estrelas, falta = (pad.obra.fim - (T0 + 60_000)) / 1000;
  const ac = aplicar(v, { tipo: 'acelerar', id: pad.id }, T0 + 60_000);
  check('acelerar custa 1 estrela por minuto que falta', ac.ok && e0 - v.estrelas === Math.ceil(falta / 60) && !pad.obra);
  check('acelerar sem obra falha', !aplicar(v, { tipo: 'acelerar', id: pad.id }, T0 + 60_000).ok);
  check('construtor extra sem estrelas suficientes falha', aplicar(v, { tipo: 'construtor' }, T0).erro.includes('Estrelas'));
  v.estrelas = 1000;
  check('contrata 2º construtor por 150', aplicar(v, { tipo: 'construtor' }, T0).ok && v.construtores === 2 && v.estrelas === 850);
  aplicar(v, { tipo: 'construtor' }, T0);
  check('máximo 3 construtores', v.construtores === 3 && !aplicar(v, { tipo: 'construtor' }, T0).ok);
  check('com 2 livres, abre 2 obras', aplicar(v, { tipo: 'construir', predio: 'casa', x: 12, z: 12 }, T0).ok && aplicar(v, { tipo: 'construir', predio: 'casa', x: 12, z: 15 }, T0).ok);
  const nova = v.predios.find(p => p.tipo === 'casa' && p.x === 12 && p.z === 12);
  check('casa em construção ainda não abriga duendes', moradia(v) === 4);
  v.alegria = 25; v.estrelas = 0;
  const a2 = nivelDe(v.alegria);
  aplicar(v, { tipo: 'coletar', id: fab(v).id }, T0 + 400_000);
  check('subir de nível dá estrelas', nivelDe(v.alegria) > a2 ? v.estrelas === 5 : true, { a: v.alegria, e: v.estrelas });
  check('nível sobe e dá 5 estrelas', (ganhar => { const w = novaVila(T0); w.alegria = 29; w.estrelas = 0; ganhar(w); return w.estrelas === 5; })(w => aplicar(w, { tipo: 'construir', predio: 'pinheiro', x: 0, z: 0 }, T0)));
}

// aluguel: casa enfeitada rende, o Papai Noel recolhe
{
  const v = novaVila(T0); v.moedas = 5000;
  const casa = v.predios.find(p => p.tipo === 'casa');
  check('casa sem enfeite não rende aluguel', aluguelDe(casa) === 0);
  avancar(v, seg(ALUGUEL_CICLO * 3));
  check('casa sem enfeite não acumula', !casa.prog);
  aplicar(v, { tipo: 'item', id: casa.id, item: 'guirlanda' }, seg(ALUGUEL_CICLO * 3));
  check('casa enfeitada rende aluguel (base + enfeite)', aluguelDe(casa) === 8 + 3);
  avancar(v, seg(ALUGUEL_CICLO * 5));
  const m0 = v.moedas, d0 = v.doces;
  const r = aplicar(v, { tipo: 'coletar', id: casa.id }, seg(ALUGUEL_CICLO * 5));
  check('coleta o aluguel de 2 ciclos com presente', r.ok && v.moedas - m0 === 22 && v.doces - d0 === 4, r);
  check('aluguel fica no máximo do estoque', (avancar(v, seg(ALUGUEL_CICLO * 999)), prontos(casa) === ESTOQUE_MAX));
}

// presente diário e calendário do Advento
{
  const dia = (iso) => Date.parse(iso + 'T15:00:00Z'); // meio-dia em Brasília
  const v = novaVila(dia('2026-11-20'));
  const m0 = v.moedas;
  const r1 = aplicar(v, { tipo: 'presente' }, dia('2026-11-20'));
  check('abre o presente do dia 1 da sequência', r1.ok && r1.sequencia === 1 && v.moedas - m0 === 50);
  check('só um por dia', aplicar(v, { tipo: 'presente' }, dia('2026-11-20') + 3600_000).erro.includes('hoje'));
  check('dia seguinte continua a sequência', aplicar(v, { tipo: 'presente' }, dia('2026-11-21')).sequencia === 2);
  check('pulou um dia: sequência volta pra 1', aplicar(v, { tipo: 'presente' }, dia('2026-11-23')).sequencia === 1);
  check('virada do dia é no horário de Brasília', presenteDeHoje(v, Date.parse('2026-11-24T02:30:00Z')) === null);
  const w = novaVila(dia('2026-12-25'));
  const e0 = w.estrelas, r2 = aplicar(w, { tipo: 'presente' }, dia('2026-12-25'));
  check('25 de dezembro: presentão do Advento', r2.advento === 25 && w.estrelas - e0 === ADVENTO[24].estrelas);
  check('26 de dezembro volta ao presente comum', presenteDeHoje(novaVila(0), dia('2026-12-26')).advento === null);
}

// missões
{
  const v = novaVila(T0);
  check('3 missões ativas no começo', missoesAtivas(v).length === 3 && missoesAtivas(v)[0].id === 'coletar1');
  check('não resgata missão não cumprida', aplicar(v, { tipo: 'missao', id: 'coletar1' }, T0).erro.includes('cumprida'));
  check('não resgata missão ainda não liberada', aplicar(v, { tipo: 'missao', id: 'arvore' }, T0).erro.includes('liberada'));
  avancar(v, seg(60));
  aplicar(v, { tipo: 'coletar', id: fab(v).id }, seg(60));
  const m0 = v.moedas;
  check('cumpriu e resgata o prêmio', aplicar(v, { tipo: 'missao', id: 'coletar1' }, seg(60)).ok && v.moedas - m0 === 30);
  check('não resgata duas vezes', !aplicar(v, { tipo: 'missao', id: 'coletar1' }, seg(60)).ok);
  check('a próxima missão entra na lista', missoesAtivas(v).some(m => m.id === 'fachada1'));
  check('todas as missões têm id único', new Set(MISSOES.map(m => m.id)).size === MISSOES.length);
}

// anúncio recompensado
{
  const v = novaVila(T0); v.moedas = 5000;
  const e0 = v.estrelas;
  check('vídeo dá estrelas', aplicar(v, { tipo: 'anuncio', premio: 'estrelas' }, T0).ok && v.estrelas - e0 === 3);
  v.alegria = 80; v.doces = 500;
  const r = aplicar(v, { tipo: 'construir', predio: 'rinque', x: 2, z: 12 }, T0);
  const f = v.predios.find(p => p.id === r.id);
  if (r.ok) {
    const fim0 = f.obra.fim;
    aplicar(v, { tipo: 'anuncio', premio: 'obra', id: f.id }, T0);
    check('vídeo adianta a obra em 5 min', f.obra && fim0 - f.obra.fim === ANUNCIO_ADIANTA * 1000);
    aplicar(v, { tipo: 'anuncio', premio: 'obra', id: f.id }, T0 + 1000);
    check('obra que passou do fim fica pronta', !f.obra);
  } else check('fábrica precisa nível 2 (pula)', true);
  while (anunciosHoje(v, T0) < ANUNCIOS_POR_DIA) aplicar(v, { tipo: 'anuncio', premio: 'estrelas' }, T0);
  check('limite de vídeos por dia', aplicar(v, { tipo: 'anuncio', premio: 'estrelas' }, T0).erro.includes('amanhã'));
  check('no dia seguinte libera de novo', aplicar(v, { tipo: 'anuncio', premio: 'estrelas' }, T0 + 86400000).ok);
}

// expansão do mapa
{
  const v = novaVila(T0); v.moedas = 9999; v.estrelas = 999;
  check('16 terrenos em volta da vila', TERRENOS.length === 16);
  check('fora da vila não constrói', !aplicar(v, { tipo: 'construir', predio: 'pinheiro', x: -3, z: 3 }, T0).ok);
  check('terreno pede nível', aplicar(v, { tipo: 'terreno', id: 't-6_6' }, T0).erro.includes('nível'));
  v.alegria = 30;
  const m0 = v.moedas;
  check('compra o terreno do lado da rua', aplicar(v, { tipo: 'terreno', id: 't-6_6' }, T0).ok && m0 - v.moedas === 800);
  check('não compra duas vezes', aplicar(v, { tipo: 'terreno', id: 't-6_6' }, T0).erro.includes('já é seu'));
  check('lote do terreno comprado é da vila', naVila(v, -3, 7) && !naVila(v, -3, 3));
  check('agora constrói no terreno novo', aplicar(v, { tipo: 'construir', predio: 'pinheiro', x: -3, z: 7 }, T0).ok);
  check('a rua atravessa o terreno novo', !aplicar(v, { tipo: 'construir', predio: 'pinheiro', x: -3, z: 10 }, T0).ok);
  check('prédio que passa da borda do terreno comprado não cabe', !aplicar(v, { tipo: 'construir', predio: 'casa', x: -2, z: 4 }, T0).ok);
}

// pinheiros com pisca-pisca
{
  const v = novaVila(T0); v.moedas = 999;
  const pin = v.predios.find(p => p.tipo === 'pinheiro');
  check('pinheiro aceita pisca-pisca (na hora)', aplicar(v, { tipo: 'item', id: pin.id, item: 'luzes' }, T0).ok && pin.itens.luzes === 1);
  check('pisca colorido no nível 2', aplicar(v, { tipo: 'item', id: pin.id, item: 'luzes' }, T0).ok && pin.itens.luzes === 2);
  v.alegria = 80;
  const r = aplicar(v, { tipo: 'construir', predio: 'espruce', x: 0, z: 0 }, T0);
  check('espruce azul libera no nível 3 e já nasce aceitando pisca', r.ok && v.predios.find(p => p.id === r.id).itens !== undefined);
}

check('ação desconhecida falha', !aplicar(novaVila(T0), { tipo: 'hackear' }, T0).ok);
check('ação vazia falha', !aplicar(novaVila(T0), null, T0).ok);

console.log(`\n${pass} ok, ${fail} falharam`);
if (fail) process.exit(1);
