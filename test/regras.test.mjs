// Testes das regras do jogo (assets/js/regras.js).
//
//   node test/regras.test.mjs

import {
  novaVila, aplicar, avancar, cabe, moradia, prontos, nivelDe, TIPOS, ESTOQUE_MAX, CUSTO_DUENDE,
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
  check('construir dá alegria', v.alegria === 5);
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

check('ação desconhecida falha', !aplicar(novaVila(T0), { tipo: 'hackear' }, T0).ok);
check('ação vazia falha', !aplicar(novaVila(T0), null, T0).ok);

console.log(`\n${pass} ok, ${fail} falharam`);
if (fail) process.exit(1);
