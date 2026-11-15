// Teste de navegador: abre o jogo de verdade (servidor local + Chromium do Playwright)
// num celular em pé e deitado, e confere o caminho principal de quem joga.
//
//   node test/e2e.mjs            (telas em .e2e/)
//
// Precisa do Playwright com Chromium instalado. Leva uns minutos: a cena 3D roda em
// WebGL por software (SwiftShader).

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const raiz = fileURLToPath(new URL('..', import.meta.url));
const PORTA = 8799, URL_JOGO = `http://localhost:${PORTA}/?qualidade=1`;
const TELAS = raiz + '.e2e/';
await mkdir(TELAS, { recursive: true });

let ok = 0, falhas = 0;
function check(nome, cond, extra) {
  if (cond) { ok++; console.log('ok   ', nome); } else { falhas++; console.log('FAIL ', nome, extra ?? ''); }
}

const servidor = spawn(process.execPath, ['scripts/dev.mjs'], { cwd: raiz, env: { ...process.env, PORT: String(PORTA) }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(`http://localhost:${PORTA}/`)).ok) break; } catch {}
  await new Promise(r => setTimeout(r, 200));
}

const navegador = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const [nome, viewport] of [['em pé', { width: 390, height: 844 }], ['deitado', { width: 844, height: 390 }]]) {
    console.log(`\n— celular ${nome} (${viewport.width}x${viewport.height})`);
    const ctx = await navegador.newContext({ viewport, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    const erros = [], externos = new Set();
    p.on('pageerror', e => erros.push(e.message));
    p.on('request', r => { const u = new URL(r.url()); if (!['blob:', 'data:'].includes(u.protocol) && u.hostname !== 'localhost') externos.add(u.hostname); });
    await p.addInitScript(() => localStorage.setItem('natal.boasvindas', '1'));
    await p.goto(URL_JOGO);
    await p.waitForSelector('#carregando.fora', { timeout: 180000 });
    await p.waitForTimeout(2000);
    await p.screenshot({ path: `${TELAS}${nome}-1-vila.png` });

    const v0 = await p.evaluate(() => window.__teste.estado());
    check('vila inicial carregou (praça, casa, fábrica)', ['praca', 'casa', 'fabrica'].every(t => v0.predios.some(x => x.tipo === t)));
    check('nenhum pedido pra fora do localhost', externos.size === 0, [...externos]);
    const token = await p.evaluate(() => localStorage.getItem('natal.token'));
    check('jogador criado no servidor', !!token);

    // HUD e navegação cabem na tela
    const caixas = await p.evaluate(() => [...document.querySelectorAll('.hud, #nav')].map(e => e.getBoundingClientRect()).map(r => ({ l: r.left, r: r.right, t: r.top, b: r.bottom })));
    check('interface dentro da tela', caixas.every(c => c.l >= -1 && c.t >= -1 && c.r <= viewport.width + 1 && c.b <= viewport.height + 1), caixas);

    const rola = await p.evaluate(() => { const e = document.scrollingElement; e.scrollLeft = 50; e.scrollTop = 50; return { x: e.scrollLeft, y: e.scrollTop }; });
    check('página não rola pro lado nem pra baixo', rola.x === 0 && rola.y === 0, rola);
    const tam = await p.evaluate(() => { const c = document.getElementById('cena'); return { c: [c.clientWidth, c.clientHeight], w: [innerWidth, innerHeight] }; });
    check('cena ocupa a tela toda', tam.c[0] === tam.w[0] && tam.c[1] === tam.w[1], tam);
    // menu de construir abre e fecha
    await p.click('[data-abrir="construir"]'); await p.waitForTimeout(600);
    check('menu construir abre', await p.isVisible('#sheet-construir'));
    await p.screenshot({ path: `${TELAS}${nome}-2-construir.png` });
    await p.click('#sheet-construir [data-fechar]'); await p.waitForTimeout(400);

    // painel da fábrica
    await p.evaluate(() => window.__teste.selecionarTipo('fabrica')); await p.waitForTimeout(800);
    check('painel do prédio abre', await p.isVisible('#sheet-predio'));
    await p.screenshot({ path: `${TELAS}${nome}-3-predio.png` });
    await p.click('#sheet-predio [data-fechar]'); await p.waitForTimeout(300);

    // constrói um pinheiro e uma casa (obra) pela fila; o servidor tem de concordar
    const r1 = await p.evaluate(() => { for (let x = 0; x < 18; x++) for (let z = 0; z < 18; z++) { const r = window.__teste.agir({ tipo: 'construir', predio: 'pinheiro', x, z }); if (r.ok) return r; } return { ok: false }; });
    const r2 = await p.evaluate(() => window.__teste.agir({ tipo: 'contratar' }));
    check('ações aplicadas no navegador', r1.ok && r2.ok, { r1, r2 });
    await p.waitForTimeout(2500);
    const oficial = await (await fetch(`http://localhost:${PORTA}/api/vila`, { headers: { Authorization: `Bearer ${token}` } })).json();
    check('servidor gravou o pinheiro', oficial.vila.predios.some(x => x.tipo === 'pinheiro'), oficial.vila.predios.map(x => x.tipo));
    check('servidor gravou o duende novo', oficial.vila.duendes.length === v0.duendes.length + 1);

    // Papai Noel desce na casa
    await p.evaluate(() => window.__teste.noel()); await p.waitForTimeout(3000);
    await p.screenshot({ path: `${TELAS}${nome}-4-noel.png` });

    // gira o aparelho no meio do jogo
    await p.setViewportSize({ width: viewport.height, height: viewport.width }); await p.waitForTimeout(1200);
    await p.screenshot({ path: `${TELAS}${nome}-5-girado.png` });
    const desenho = await p.evaluate(() => { const c = document.getElementById('cena'); return { buf: c.width / devicePixelRatio, css: c.clientWidth }; });
    check('resolução acompanha o giro', Math.abs(desenho.css - (viewport.height)) <= 1, desenho);

    // recarrega sem internet: abre com a cópia local
    await ctx.setOffline(true);
    await p.reload(); await p.waitForSelector('#carregando.fora', { timeout: 180000 }); await p.waitForTimeout(1500);
    const offline = await p.evaluate(() => window.__teste.estado());
    check('abre offline com a vila salva', offline.predios.some(x => x.tipo === 'pinheiro'));

    const mem = await p.evaluate(() => window.__teste.memoria());
    console.log('      memória da GPU:', JSON.stringify(mem));
    check('sem erro de JavaScript', erros.length === 0, erros);
    await ctx.close();
  }
} finally {
  await navegador.close();
  servidor.kill();
}
console.log(`\n${ok} ok, ${falhas} falharam (telas em .e2e/)`);
process.exit(falhas ? 1 : 0);
