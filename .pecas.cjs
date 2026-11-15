const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const S = process.argv[2], arq = process.argv[3];
(async () => {
  const srv = spawn(process.execPath, ['scripts/dev.mjs'], { cwd: '/home/user/Natal', env: { ...process.env, PORT: '8798' }, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 3000));
  const r = await (await fetch('http://localhost:8798/api/jogador', { method: 'POST' })).json();
  if (arq) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync('/home/user/Natal/.wrangler/dev.sqlite');
    const id = db.prepare('SELECT jogador_id FROM vilas ORDER BY atualizado_em DESC LIMIT 1').get().jogador_id;
    db.prepare('UPDATE vilas SET estado = ? WHERE jogador_id = ?').run(fs.readFileSync(arq, 'utf8'), id);
  }
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const erros = []; p.on('pageerror', e => erros.push(e.message));
  await p.addInitScript((t) => { localStorage.setItem('natal.boasvindas', '1'); localStorage.setItem('natal.token', t); }, r.token);
  await p.goto('http://localhost:8798/?qualidade=1'); await p.waitForSelector('#carregando.fora', { timeout: 240000 }); await p.waitForTimeout(3000);
  if (process.env.DET) { console.log((await p.evaluate(() => window.__grupos || [])).join('\n')); console.log((await p.evaluate((t) => window.__teste.detalhe(t), process.env.DET)).join('\n')); }
  const pc = await p.evaluate(() => window.__teste.pecas());
  const lista = Object.entries(pc).filter(([k]) => k[0] !== '_').sort((a, b) => b[1].pecas - a[1].pecas);
  for (const [k, x] of lista) console.log(k.padEnd(14), 'qtd', x.n, 'peças', x.pecas, '(', Math.round(x.pecas / x.n), 'cada) tri', x.tri);
  console.log('cena toda (peças):', pc._cenaToda, 'só prédios:', lista.reduce((s, [, x]) => s + x.pecas, 0));
  console.log('memória', JSON.stringify(await p.evaluate(() => window.__teste.memoria())), 'erros', erros);
  if (process.env.ALTO) { await p.evaluate(() => { const c = window.__teste.cena().controls; c.object.position.sub(c.target).setLength(90).add(c.target); c.update(); }); await p.waitForTimeout(2500); }
  if (process.argv[4]) await p.screenshot({ path: process.argv[4], timeout: 180000 });
  await b.close(); srv.kill();
})();
