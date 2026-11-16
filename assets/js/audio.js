// Som do jogo, todo sintetizado com Web Audio (nenhum arquivo pra baixar, funciona
// offline): música de fundo ("Jingle Bells", domínio público, em timbre de sino) e
// efeitos. O navegador só libera áudio depois de um toque, então iniciar() é chamado
// no primeiro toque na tela. Preferências ficam em localStorage ('natal.som').

let ctx = null, mestre = null, musicaG = null, efeitosG = null;
let prefs = { musica: true, sons: true };
try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem('natal.som') || '{}') }; } catch { /* padrão */ }
const salvar = () => { try { localStorage.setItem('natal.som', JSON.stringify(prefs)); } catch { /* sem armazenamento */ } };

const NOTA = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, G6: 1568 };

// Sino: fundamental + parcial inarmônico que some rápido.
function sino(freq, t, dur, vol, destino) {
  for (const [mult, v, d] of [[1, 1, dur], [2.76, 0.35, dur * 0.35], [5.4, 0.12, dur * 0.15]]) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq * mult;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * v, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(destino); o.start(t); o.stop(t + d + 0.05);
  }
}
function ruido(t, dur, vol, filtro, freq, destino) {
  const n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = buf; f.type = filtro; f.frequency.value = freq; g.gain.value = vol;
  s.connect(f).connect(g).connect(destino); s.start(t);
}
function tom(freq, t, dur, vol, tipo, destino) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = tipo; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(destino); o.start(t); o.stop(t + dur + 0.05);
}

// ---------- música ----------
const E = 'E5', D = 'D5', C = 'C5', F = 'F5', G = 'G5';
const MELODIA = [
  [E, 1], [E, 1], [E, 2], [E, 1], [E, 1], [E, 2], [E, 1], [G, 1], [C, 1.5], [D, 0.5], [E, 4],
  [F, 1], [F, 1], [F, 1.5], [F, 0.5], [F, 1], [E, 1], [E, 1], [E, 0.5], [E, 0.5], [E, 1], [D, 1], [D, 1], [E, 1], [D, 2], [G, 2],
  [E, 1], [E, 1], [E, 2], [E, 1], [E, 1], [E, 2], [E, 1], [G, 1], [C, 1.5], [D, 0.5], [E, 4],
  [F, 1], [F, 1], [F, 1.5], [F, 0.5], [F, 1], [E, 1], [E, 1], [E, 0.5], [E, 0.5], [G, 1], [G, 1], [F, 1], [D, 1], [C, 4],
];
const BAIXO = ['C4', 'C4', 'C4', 'C4', 'F4', 'C4', 'D4', 'G4', 'C4', 'C4', 'C4', 'C4', 'F4', 'C4', 'G4', 'C4']; // um por compasso (4 tempos)
const BATIDA = 60 / 112;
let tocando = false, proxNota = 0, idxNota = 0, compasso = 0, proxCompasso = 0, timer = null;
function agendarMusica() {
  if (!tocando) return;
  while (proxNota < ctx.currentTime + 0.6) {
    const [n, b] = MELODIA[idxNota];
    sino(NOTA[n], proxNota, Math.min(1.6, b * BATIDA * 1.6), 0.18, musicaG);
    proxNota += b * BATIDA; idxNota++;
    if (idxNota >= MELODIA.length) { idxNota = 0; proxNota += BATIDA * 4; } // respiro antes de repetir
  }
  while (proxCompasso < ctx.currentTime + 0.6) {
    tom(NOTA[BAIXO[compasso % BAIXO.length]] / 2, proxCompasso, BATIDA * 3.5, 0.07, 'triangle', musicaG);
    proxCompasso += BATIDA * 4; compasso++;
  }
}
function ligarMusica() {
  if (!ctx || tocando || !prefs.musica) return;
  tocando = true; proxNota = proxCompasso = ctx.currentTime + 0.3; idxNota = 0; compasso = 0;
  timer = setInterval(agendarMusica, 200);
}
function desligarMusica() { tocando = false; clearInterval(timer); }

// ---------- API ----------
export function iniciar() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  mestre = ctx.createGain(); mestre.gain.value = 0.9; mestre.connect(ctx.destination);
  musicaG = ctx.createGain(); musicaG.gain.value = 0.5; musicaG.connect(mestre);
  efeitosG = ctx.createGain(); efeitosG.gain.value = 0.8; efeitosG.connect(mestre);
  ligarMusica();
  document.addEventListener('visibilitychange', () => { if (document.hidden) ctx.suspend(); else ctx.resume(); });
}

export function preferencias() { return { ...prefs }; }
export function setMusica(on) { prefs.musica = on; salvar(); on ? ligarMusica() : desligarMusica(); }
export function setSons(on) { prefs.sons = on; salvar(); }

const EFEITOS = {
  moeda(t) { sino(NOTA.E6, t, 0.25, 0.25, efeitosG); sino(NOTA.G6, t + 0.08, 0.35, 0.25, efeitosG); },
  clique(t) { tom(900, t, 0.05, 0.08, 'square', efeitosG); },
  martelo(t) { for (let i = 0; i < 3; i++) { ruido(t + i * 0.16, 0.06, 0.5, 'lowpass', 900, efeitosG); tom(160, t + i * 0.16, 0.08, 0.2, 'sine', efeitosG); } },
  pronto(t) { [NOTA.C5, NOTA.E5, NOTA.G5].forEach((f, i) => sino(f, t + i * 0.1, 0.8, 0.22, efeitosG)); },
  nivel(t) { [NOTA.C5, NOTA.E5, NOTA.G5, NOTA.C6, NOTA.E6].forEach((f, i) => sino(f, t + i * 0.09, 1.1, 0.25, efeitosG)); },
  presente(t) { for (let i = 0; i < 10; i++) ruido(t + i * 0.06, 0.05, 0.25, 'highpass', 6000, efeitosG); EFEITOS.nivel(t + 0.4); },
  guizos(t) { for (let i = 0; i < 16; i++) ruido(t + i * 0.07 + (i % 2) * 0.02, 0.05, 0.18, 'highpass', 7000, efeitosG); },
  apito(t) { // apito de trem a vapor: acorde com vibrato, duas vezes
    for (const [ini, dur] of [[0, 0.55], [0.7, 0.9]]) for (const f of [440, 554, 659]) tom(f, t + ini, dur, 0.05, 'sawtooth', efeitosG);
    ruido(t, 1.6, 0.06, 'bandpass', 1800, efeitosG);
  },
  erro(t) { tom(220, t, 0.18, 0.12, 'triangle', efeitosG); tom(180, t + 0.12, 0.2, 0.12, 'triangle', efeitosG); },
};
export function tocar(nome) {
  if (!ctx || !prefs.sons || ctx.state !== 'running') return;
  EFEITOS[nome] && EFEITOS[nome](ctx.currentTime + 0.01);
}
