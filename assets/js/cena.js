// Cena 3D da vila (Three.js): céu com aurora, terreno, floresta, neve caindo e os
// modelos de cada prédio e duende. Não conhece regras de jogo: recebe o estado da
// vila em sincronizar() e desenha. Tudo é gerado por código (formas + texturas em
// canvas); trocar um modelo por um .glb pronto é só mudar a função dele em MODELOS.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TAMANHO, RUAS, TIPOS } from './regras.js';

export const T = 2.5; // tamanho de um lote em unidades do mundo
const MEIO = TAMANHO / 2;

const coarse = matchMedia('(pointer: coarse)').matches;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- utilidades ----------
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(11);
const R = (a, b) => a + (b - a) * rnd();
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });
function rbox(w, h, d, r = 0.12, seg = 2) { return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, Math.min(w, h, d) / 2 - 0.002)); }
function shadowAll(o, cast = true) { o.traverse(m => { if (m.isMesh) { m.castShadow = cast; m.receiveShadow = true; } }); return o; }
function mesh(geo, m, x = 0, y = 0, z = 0) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); return o; }
function tex(w, h, draw, rep = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); t.anisotropy = 8;
  return t;
}
const rep = (t, x, y) => { const c = t.clone(); c.repeat.set(x, y); c.needsUpdate = true; return c; };

// Centro (no chão) de um prédio com canto em (x,z) e lado tam, em lotes.
export function centroLote(x, z, tam = 1) {
  return V3((x + tam / 2 - MEIO) * T, 0, (z + tam / 2 - MEIO) * T);
}

// ---------- texturas ----------
const logsTex = tex(256, 256, (g, w, h) => {
  const rows = 8, rh = h / rows;
  for (let i = 0; i < rows; i++) {
    const y = i * rh, gr = g.createLinearGradient(0, y, 0, y + rh);
    gr.addColorStop(0, '#3e2414'); gr.addColorStop(0.2, '#85512f'); gr.addColorStop(0.5, '#a36a40'); gr.addColorStop(0.82, '#744628'); gr.addColorStop(1, '#341d0f');
    g.fillStyle = gr; g.fillRect(0, y, w, rh);
    g.strokeStyle = 'rgba(50,26,12,0.35)'; g.lineWidth = 1;
    for (let k = 0; k < 5; k++) { const yy = y + R(5, rh - 5); g.beginPath(); g.moveTo(0, yy); for (let x = 0; x <= w; x += 16) g.lineTo(x, yy + Math.sin(x * 0.05 + k) * 1.4); g.stroke(); }
    g.fillStyle = 'rgba(232,240,255,0.7)'; for (let x = 0; x < w; x += 5) g.fillRect(x, y + 1, R(2, 6), R(1, 3));
  }
});
const brickTex = tex(256, 256, (g, w, h) => {
  g.fillStyle = '#d6d2cf'; g.fillRect(0, 0, w, h);
  const rows = 10, bh = h / rows, bw = w / 4;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * bw / 2;
    for (let c = -1; c < 5; c++) {
      const x = c * bw + off, y = r * bh;
      g.fillStyle = `hsl(${R(3, 11)},${R(50, 62)}%,${R(34, 44)}%)`;
      g.beginPath(); g.roundRect(x + 2, y + 2, bw - 4, bh - 4, 3); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x + 3, y + 3, bw - 6, 3);
    }
  }
});
const cobbleTex = tex(512, 512, (g, w, h) => {
  g.fillStyle = '#e8eefc'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 520; i++) { const x = R(0, w), y = R(0, h), r = R(9, 18); g.fillStyle = `hsl(224,${R(10, 24)}%,${R(50, 66)}%)`; g.beginPath(); g.ellipse(x, y, r, r * R(0.7, 1), R(0, 3), 0, 7); g.fill(); }
  for (let i = 0; i < 1100; i++) { g.fillStyle = 'rgba(240,246,255,0.65)'; g.beginPath(); g.arc(R(0, w), R(0, h), R(1, 5), 0, 7); g.fill(); }
}, [2, 2]);
const stripeTex = tex(128, 128, (g, w, h) => {
  g.fillStyle = '#f6f2ec'; g.fillRect(0, 0, w, h); g.fillStyle = '#d42f37';
  for (let i = -3; i < 3; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64 + 30, 0); g.lineTo(i * 64 + 30 + 128, h); g.lineTo(i * 64 + 128, h); g.closePath(); g.fill(); }
});
const roadTex = tex(256, 256, (g, w, h) => {
  g.fillStyle = '#c3d0ee'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(${R(205, 255) | 0},${R(215, 255) | 0},255,0.4)`; g.fillRect(R(0, w), R(0, h), R(1, 4), R(1, 4)); }
  g.strokeStyle = 'rgba(110,130,185,0.35)'; g.lineWidth = 7;
  [w * 0.3, w * 0.7].forEach(x => { g.beginPath(); g.moveTo(x, 0); for (let y = 0; y <= h; y += 16) g.lineTo(x + Math.sin(y * 0.05) * 2, y); g.stroke(); });
});
const plankTex = tex(128, 128, (g, w, h) => {
  const n = 4, pw = w / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = `hsl(22,${R(38, 48)}%,${R(26, 34)}%)`; g.fillRect(i * pw, 0, pw, h);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(i * pw, 0, 2, h);
    g.strokeStyle = 'rgba(0,0,0,0.14)'; for (let k = 0; k < 4; k++) { const x = i * pw + R(5, pw - 5); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + R(-3, 3), h); g.stroke(); }
  }
});
const gingerTex = tex(256, 256, (g, w, h) => {
  g.fillStyle = '#b8733d'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 600; i++) { g.fillStyle = 'rgba(90,45,15,0.2)'; g.beginPath(); g.arc(R(0, w), R(0, h), R(1, 2.5), 0, 7); g.fill(); }
  g.strokeStyle = '#fff7ee'; g.lineWidth = 8; g.lineCap = 'round';
  g.beginPath(); for (let x = 0; x <= w; x += 32) { g.moveTo(x, 8); g.quadraticCurveTo(x + 16, 34, x + 32, 8); } g.stroke();
  g.beginPath(); for (let x = 0; x <= w; x += 32) { g.moveTo(x, h - 8); g.quadraticCurveTo(x + 16, h - 34, x + 32, h - 8); } g.stroke();
  g.fillStyle = '#fff7ee'; for (let x = 16; x < w; x += 32) { g.beginPath(); g.arc(x, h / 2, 6, 0, 7); g.fill(); }
});
const flakeTex = tex(64, 64, (g, w) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
const smokeTex = tex(128, 128, (g, w) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
const poolTex = tex(128, 128, (g, w) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,190,110,0.9)'); gr.addColorStop(0.5, 'rgba(255,160,80,0.3)'); gr.addColorStop(1, 'rgba(255,150,70,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
let signTex = null;
function makeSignTex() {
  signTex = tex(1024, 160, (g, w, h) => {
    g.fillStyle = '#fff4dc'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#d8333a'; g.lineWidth = 10; g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = '#b8242c'; g.font = '700 86px Fredoka, Nunito, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('Fábrica de Brinquedos', w / 2, h / 2 + 4);
  });
  signTex.wrapS = signTex.wrapT = THREE.ClampToEdgeWrapping;
}

// ---------- materiais compartilhados ----------
const snowMat = mat(0xeef3ff, { roughness: 0.95 });
const glowMat = new THREE.MeshStandardMaterial({ color: 0xffd28a, emissive: 0xffa040, emissiveIntensity: 2.4, roughness: 0.5 });
const frameMat = mat(0xf1ece2, { roughness: 0.6 });
const darkMat = mat(0x2a2f45, { roughness: 0.6, metalness: 0.3 });
const stripeMat = new THREE.MeshStandardMaterial({ map: rep(stripeTex, 1, 3), roughness: 0.45 });
const bulbMat = new THREE.MeshBasicMaterial({ toneMapped: false });
const wireMat = mat(0x1d2233);
const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55, toneMapped: false });
const BULBS = [[5, 0.7, 0.5], [0.6, 4, 1.2], [0.9, 1.8, 5], [5, 3.4, 0.7], [4, 1.1, 3.2]];
const bulbGeo = new THREE.SphereGeometry(0.11, 8, 6);

// Cordão de luzinhas entre dois pontos (coordenadas locais do grupo).
function addString(group, p0, p1, sag, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n, p = p0.clone().lerp(p1, t); p.y -= Math.sin(t * Math.PI) * sag; pts.push(p); }
  group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, 0.025, 4), wireMat));
  const im = new THREE.InstancedMesh(bulbGeo, bulbMat, pts.length), m4 = new THREE.Matrix4(), c = new THREE.Color();
  pts.forEach((p, i) => { m4.makeTranslation(p.x, p.y - 0.1, p.z); im.setMatrixAt(i, m4); im.setColorAt(i, c.setRGB(...BULBS[i % 5])); });
  im.userData.noShadow = true;
  group.add(im);
}
function addPool(group, x, z, s) {
  const p = mesh(new THREE.PlaneGeometry(s, s), poolMat, x, 0.08, z); p.rotation.x = -Math.PI / 2; p.userData.noShadow = true; group.add(p);
}

// ---------- modelos ----------
function makeWindow(w = 1.1, h = 1.3) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.PlaneGeometry(w, h), glowMat, 0, 0, 0.02));
  const t = 0.13;
  g.add(mesh(new THREE.BoxGeometry(w + t * 2, t, 0.16), frameMat, 0, h / 2, 0.05));
  g.add(mesh(new THREE.BoxGeometry(w + t * 2, t, 0.16), frameMat, 0, -h / 2, 0.05));
  g.add(mesh(new THREE.BoxGeometry(t, h, 0.16), frameMat, -w / 2, 0, 0.05));
  g.add(mesh(new THREE.BoxGeometry(t, h, 0.16), frameMat, w / 2, 0, 0.05));
  g.add(mesh(new THREE.BoxGeometry(0.06, h, 0.08), frameMat, 0, 0, 0.05));
  g.add(mesh(new THREE.BoxGeometry(w, 0.06, 0.08), frameMat, 0, 0, 0.05));
  g.add(mesh(rbox(w + 0.55, 0.2, 0.42, 0.09), snowMat, 0, -h / 2 - 0.13, 0.18));
  return g;
}

function gableRoof({ w, d, h, oh = 0.6, gableMat, trim = 0x8a2f2b, snowM = snowMat }) {
  const g = new THREE.Group();
  const a = d / 2, th = Math.atan2(h, a), L = Math.hypot(a, h) + oh;
  const sh = new THREE.Shape(); sh.moveTo(-a, 0); sh.lineTo(a, 0); sh.lineTo(0, h); sh.closePath();
  const prism = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false }), gableMat);
  prism.rotation.y = Math.PI / 2; prism.position.x = -w / 2; g.add(prism);
  const n = new THREE.Vector2(Math.sin(th), Math.cos(th));
  const ez = a + oh * Math.cos(th), ey = -oh * Math.sin(th);
  const M = new THREE.Vector2(ez / 2, (h + ey) / 2);
  for (const s of [1, -1]) {
    const tr = mesh(rbox(w + 2 * oh, 0.24, L, 0.07), mat(trim, { roughness: 0.7 }));
    tr.position.set(0, M.y + n.y * 0.12, s * (M.x + n.x * 0.12)); tr.rotation.x = s * th; g.add(tr);
    const sn = mesh(rbox(w + 2 * oh + 0.3, 0.55, L + 0.25, 0.24, 3), snowM);
    sn.position.set(0, M.y + n.y * 0.5, s * (M.x + n.x * 0.5)); sn.rotation.x = s * th; g.add(sn);
  }
  const ridge = mesh(new THREE.CylinderGeometry(0.42, 0.42, w + 2 * oh + 0.3, 16), snowM, 0, h + 0.55, 0);
  ridge.rotation.z = Math.PI / 2; g.add(ridge);
  g.userData.eave = { z: ez + 0.1, y: ey - 0.3, x: w / 2 + oh };
  return g;
}

function makeGift(s = 1, color = 0xd8333a, ribbon = 0xffd166) {
  const g = new THREE.Group(), rm = mat(ribbon, { roughness: 0.4, metalness: 0.2 });
  g.add(mesh(rbox(s, s * 0.85, s, 0.06), mat(color, { roughness: 0.55 }), 0, s * 0.425, 0));
  g.add(mesh(new THREE.BoxGeometry(s * 1.02, s * 0.87, s * 0.16), rm, 0, s * 0.425, 0));
  g.add(mesh(new THREE.BoxGeometry(s * 0.16, s * 0.87, s * 1.02), rm, 0, s * 0.425, 0));
  const b1 = mesh(new THREE.TorusGeometry(s * 0.16, s * 0.05, 6, 12), rm, -s * 0.14, s * 0.95, 0); b1.rotation.y = 0.4; g.add(b1);
  const b2 = mesh(new THREE.TorusGeometry(s * 0.16, s * 0.05, 6, 12), rm, s * 0.14, s * 0.95, 0); b2.rotation.y = -0.4; g.add(b2);
  return g;
}

function makeHouse() {
  const g = new THREE.Group(), w = 7, d = 5.5, H = 3.6, base = 0.4;
  g.add(mesh(rbox(w + 0.5, base, d + 0.5, 0.12), mat(0x7d8597, { roughness: 0.95 }), 0, base / 2, 0));
  g.add(mesh(rbox(w, H, d, 0.18, 3), new THREE.MeshStandardMaterial({ map: rep(logsTex, 2.2, 1.6), roughness: 0.85 }), 0, base + H / 2, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.24, 0.24, H, 10), mat(0x5e3a22), sx * w / 2, base + H / 2, sz * d / 2));
  const roof = gableRoof({ w, d, h: 2.6, oh: 0.7, gableMat: new THREE.MeshStandardMaterial({ map: rep(logsTex, 0.3, 0.3), roughness: 0.85 }), trim: 0x8a2f2b });
  roof.position.y = base + H; g.add(roof);
  g.add(mesh(rbox(1.4, 2.4, 0.25, 0.08), new THREE.MeshStandardMaterial({ map: plankTex, color: 0xd08a6a, roughness: 0.8 }), 0, base + 1.2, d / 2 + 0.08));
  g.add(mesh(new THREE.TorusGeometry(0.36, 0.12, 8, 20), mat(0x2f7a46, { roughness: 0.9 }), 0, base + 1.85, d / 2 + 0.26));
  g.add(mesh(new THREE.SphereGeometry(0.1, 8, 8), mat(0xd8333a), 0, base + 1.5, d / 2 + 0.36));
  const lamp = mesh(new THREE.SphereGeometry(0.13, 10, 10), bulbMat.clone(), 1.1, base + 2.45, d / 2 + 0.3); lamp.material.color.setRGB(4, 2.6, 1.1); g.add(lamp);
  for (const x of [-2.3, 2.3]) { const wn = makeWindow(); wn.position.set(x, base + 2.0, d / 2 + 0.02); g.add(wn); }
  for (const s of [-1, 1]) { const wn = makeWindow(); wn.position.set(s * (w / 2 + 0.02), base + 2.0, 0); wn.rotation.y = s * Math.PI / 2; g.add(wn); }
  g.add(mesh(rbox(1, 3.2, 1, 0.1), mat(0x8f97a8, { roughness: 0.95 }), 2.2, base + H + 2.0, -1.1));
  g.add(mesh(rbox(1.3, 0.38, 1.3, 0.16), snowMat, 2.2, base + H + 3.65, -1.1));
  const e = roof.userData.eave;
  addString(g, V3(-e.x, base + H + e.y, e.z), V3(e.x, base + H + e.y, e.z), 0.35, 22);
  addPool(g, 0, d / 2 + 1.6, 6);
  g.userData.smoke = [V3(2.2, base + H + 4, -1.1)];
  g.userData.altura = 8;
  return g;
}

function makeFactory() {
  const g = new THREE.Group(), w = 11, d = 8, H = 6, base = 0.4;
  g.add(mesh(rbox(w + 0.6, base, d + 0.6, 0.12), mat(0x7d8597, { roughness: 0.95 }), 0, base / 2, 0));
  g.add(mesh(rbox(w, H, d, 0.15, 2), new THREE.MeshStandardMaterial({ map: rep(brickTex, 3, 2), roughness: 0.9 }), 0, base + H / 2, 0));
  const cream = mat(0xeee6d8, { roughness: 0.7 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(rbox(0.7, H, 0.7, 0.1), cream, sx * w / 2, base + H / 2, sz * d / 2));
  g.add(mesh(rbox(w + 0.3, 0.4, d + 0.3, 0.1), cream, 0, base + H - 0.2, 0));
  const roof = gableRoof({ w, d, h: 3.2, oh: 0.7, gableMat: new THREE.MeshStandardMaterial({ map: rep(brickTex, 0.35, 0.35), roughness: 0.9 }), trim: 0x2f6b4f });
  roof.position.y = base + H; g.add(roof);
  g.add(mesh(rbox(3.2, 3.9, 0.3, 0.1), cream, 0, base + 1.95, d / 2 + 0.05));
  g.add(mesh(rbox(2.6, 3.4, 0.3, 0.08), new THREE.MeshStandardMaterial({ map: plankTex, color: 0xc0504a, roughness: 0.8 }), 0, base + 1.7, d / 2 + 0.15));
  g.add(mesh(new THREE.PlaneGeometry(2.4, 0.5), glowMat, 0, base + 3.2, d / 2 + 0.32));
  for (const x of [-3.7, 3.7]) { const wn = makeWindow(1.5, 1.7); wn.position.set(x, base + 2.0, d / 2 + 0.02); g.add(wn); }
  for (const x of [-4.2, -2.2, 2.2, 4.2]) { const wn = makeWindow(1.1, 1.1); wn.position.set(x, base + 4.15, d / 2 + 0.02); g.add(wn); }
  for (const s of [-1, 1]) for (const z of [-2, 2]) { const wn = makeWindow(1.3, 1.5); wn.position.set(s * (w / 2 + 0.02), base + 2.6, z); wn.rotation.y = s * Math.PI / 2; g.add(wn); }
  const board = new THREE.Group(); board.position.set(0, base + 5.25, d / 2 + 0.12);
  board.add(mesh(rbox(7, 1.3, 0.22, 0.08), mat(0x5a3420), 0, 0, 0));
  board.add(mesh(new THREE.PlaneGeometry(6.6, 1.05), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.35 }), 0, 0, 0.12));
  g.add(board);
  g.userData.smoke = [];
  for (const x of [-3, 3]) {
    g.add(mesh(new THREE.CylinderGeometry(0.55, 0.62, 5.4, 18), stripeMat, x, base + H + 2.6, -2));
    g.add(mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.35, 18), snowMat, x, base + H + 5.35, -2));
    g.userData.smoke.push(V3(x, base + H + 5.8, -2));
  }
  for (const [x, z, s, c, r] of [[-5.2, 4.8, 0.9, 0x2f9e5b, 0xffd166], [-4.3, 5.3, 0.6, 0xd8333a, 0xffffff], [5.0, 5.0, 0.8, 0xf2a93b, 0xd8333a]]) {
    const gf = makeGift(s, c, r); gf.position.set(x, 0, z); gf.rotation.y = R(0, 1.5); g.add(gf);
  }
  const e = roof.userData.eave;
  addString(g, V3(-e.x, base + H + e.y, e.z), V3(e.x, base + H + e.y, e.z), 0.45, 30);
  addPool(g, 0, d / 2 + 2, 8);
  g.scale.setScalar(0.88);
  g.userData.altura = 13;
  return g;
}

function makeBakery() {
  const g = new THREE.Group(), w = 6, d = 5, H = 3.2, base = 0.35;
  g.add(mesh(rbox(w + 0.4, base, d + 0.4, 0.1), mat(0xf3e6d6), 0, base / 2, 0));
  g.add(mesh(rbox(w, H, d, 0.25, 3), new THREE.MeshStandardMaterial({ map: rep(gingerTex, 2, 1), roughness: 0.8 }), 0, base + H / 2, 0));
  const icing = mat(0xfff7f0, { roughness: 0.6 });
  const roof = gableRoof({ w, d, h: 2.3, oh: 0.6, gableMat: new THREE.MeshStandardMaterial({ map: rep(gingerTex, 0.35, 0.35), roughness: 0.8 }), trim: 0xf28fb0, snowM: icing });
  roof.position.y = base + H; g.add(roof);
  const candy = [0xd8333a, 0x2fbf86, 0xffc94d, 0x7aa8ff];
  const th = Math.atan2(2.3, d / 2);
  for (let i = 0; i < 14; i++) {
    const t = R(0.15, 0.85), x = R(-w / 2, w / 2), z = t * (d / 2 + 0.3), y = base + H + 2.3 * (1 - t) + 0.75;
    g.add(mesh(new THREE.SphereGeometry(0.17, 10, 8), mat(candy[i % 4], { roughness: 0.3 }), x, y + Math.cos(th) * 0.05, z + 0.12));
  }
  g.add(mesh(rbox(1.3, 2.2, 0.22, 0.08), new THREE.MeshStandardMaterial({ map: plankTex, color: 0xf0b4c4, roughness: 0.8 }), 0, base + 1.1, d / 2 + 0.06));
  for (const x of [-1.9, 1.9]) { const wn = makeWindow(1, 1.1); wn.position.set(x, base + 1.8, d / 2 + 0.02); g.add(wn); }
  const cookie = mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.18, 24), mat(0xc98a4b, { roughness: 0.9 }), 0, base + 2.85, d / 2 + 0.14); cookie.rotation.x = Math.PI / 2; g.add(cookie);
  for (const [cx, cy] of [[-0.2, 0.15], [0.22, -0.05], [-0.05, -0.25], [0.15, 0.3]]) g.add(mesh(new THREE.SphereGeometry(0.07, 6, 6), mat(0x4a2a14), cx, base + 2.85 + cy, d / 2 + 0.24));
  for (const x of [-1.05, 1.05]) g.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 2.6, 10), stripeMat, x, 1.3, d / 2 + 0.6));
  const e = roof.userData.eave;
  addString(g, V3(-e.x, base + H + e.y, e.z), V3(e.x, base + H + e.y, e.z), 0.3, 18);
  addPool(g, 0, d / 2 + 1.4, 5);
  g.userData.altura = 7.5;
  return g;
}

function makeRink() {
  const g = new THREE.Group();
  const ice = mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.18, 40), mat(0xbfe6ff, { roughness: 0.08, metalness: 0.1 }), 0, 0.12, 0); ice.scale.z = 0.85; g.add(ice);
  const rim = mesh(new THREE.TorusGeometry(4.3, 0.32, 10, 48), snowMat, 0, 0.18, 0); rim.rotation.x = Math.PI / 2; rim.scale.y = 0.85; g.add(rim);
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2, x = Math.cos(a) * 4.6, z = Math.sin(a) * 4.6 * 0.86;
    g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.6, 8), stripeMat, x, 0.8, z));
    const b = mesh(new THREE.SphereGeometry(0.16, 8, 8), bulbMat.clone(), x, 1.7, z); b.material.color.setRGB(...BULBS[i % 5]); g.add(b);
  }
  g.userData.altura = 4;
  return g;
}

function makePine(s = 1) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.25, 0.35, 1.2, 7), mat(0x5a3a26), 0, 0.6, 0));
  [[2.2, 3.0, 2.4, 0x1d4a3a], [1.7, 2.6, 3.9, 0x22573f], [1.15, 2.2, 5.2, 0x286347]].forEach(([r, h, y, c], i) => {
    g.add(mesh(new THREE.ConeGeometry(r, h, 9), mat(c, { roughness: 0.9 }), 0, y, 0));
    const ch = h * (i === 2 ? 0.6 : 0.45);
    g.add(mesh(new THREE.ConeGeometry(r * ch / h * 1.07, ch, 9), snowMat, 0, y + h / 2 - ch / 2 + 0.03, 0));
  });
  g.scale.setScalar(s);
  g.userData.altura = 6.5 * s;
  return g;
}

function makeSnowman() {
  const g = new THREE.Group(), coal = mat(0x1d1d24, { roughness: 0.5 });
  g.add(mesh(new THREE.SphereGeometry(0.95, 24, 18), snowMat, 0, 0.85, 0));
  g.add(mesh(new THREE.SphereGeometry(0.68, 24, 18), snowMat, 0, 2.15, 0));
  g.add(mesh(new THREE.SphereGeometry(0.48, 24, 18), snowMat, 0, 3.08, 0));
  for (const x of [-0.17, 0.17]) g.add(mesh(new THREE.SphereGeometry(0.06, 8, 8), coal, x, 3.18, 0.43));
  for (const y of [1.95, 2.25, 2.55]) g.add(mesh(new THREE.SphereGeometry(0.07, 8, 8), coal, 0, y, 0.66 - Math.abs(y - 2.15) * 0.25));
  const nose = mesh(new THREE.ConeGeometry(0.08, 0.55, 10), mat(0xf08a2e), 0, 3.05, 0.7); nose.rotation.x = Math.PI / 2; g.add(nose);
  g.add(mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.06, 20), coal, 0, 3.48, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.38, 0.4, 0.6, 20), coal, 0, 3.8, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.405, 0.405, 0.12, 20), mat(0xd8333a), 0, 3.58, 0));
  const scarf = mesh(new THREE.TorusGeometry(0.5, 0.13, 8, 20), mat(0xd8333a, { roughness: 0.9 }), 0, 2.68, 0); scarf.rotation.x = Math.PI / 2; g.add(scarf);
  const tail = mesh(rbox(0.25, 0.7, 0.1, 0.04), mat(0xd8333a, { roughness: 0.9 }), 0.3, 2.35, 0.45); tail.rotation.z = 0.2; g.add(tail);
  for (const s of [-1, 1]) { const arm = mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 6), mat(0x5a3a26), s * 1.05, 2.45, 0); arm.rotation.z = s * -1.0; g.add(arm); }
  g.scale.setScalar(0.75);
  g.userData.altura = 3.2;
  return g;
}

function makeLamp() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.3, 12), darkMat, 0, 0.15, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.14, 4.2, 12), new THREE.MeshStandardMaterial({ map: rep(stripeTex, 1, 4), roughness: 0.45 }), 0, 2.2, 0));
  g.add(mesh(rbox(0.55, 0.65, 0.55, 0.06), darkMat, 0, 4.55, 0));
  const b = mesh(new THREE.SphereGeometry(0.2, 12, 10), bulbMat.clone(), 0, 4.55, 0); b.material.color.setRGB(5, 3.2, 1.4); g.add(b);
  g.add(mesh(new THREE.ConeGeometry(0.48, 0.42, 4), darkMat, 0, 5.08, 0));
  g.add(mesh(new THREE.ConeGeometry(0.3, 0.25, 8), snowMat, 0, 5.24, 0));
  addPool(g, 0, 0, 4.5);
  g.userData.altura = 5.5;
  return g;
}

function makeGiftPile() {
  const g = new THREE.Group();
  [[-0.35, -0.2, 0.75, 0xd8333a, 0xffd166], [0.4, -0.1, 0.6, 0x2f9e5b, 0xffffff], [0, 0.4, 0.5, 0x4f7fe0, 0xffd166]].forEach(([x, z, s, c, r]) => { const gf = makeGift(s, c, r); gf.position.set(x, 0, z); gf.rotation.y = R(0, 2); g.add(gf); });
  const top = makeGift(0.42, 0xf2a93b, 0xd8333a); top.position.set(-0.3, 0.64, -0.2); top.rotation.y = 0.6; g.add(top);
  g.userData.altura = 1.8;
  return g;
}

function makeBench() {
  const g = new THREE.Group(), wm = mat(0x7a4a2a, { roughness: 0.85 });
  g.add(mesh(rbox(2.4, 0.12, 0.7, 0.04), wm, 0, 0.6, 0));
  g.add(mesh(rbox(2.4, 0.5, 0.1, 0.04), wm, 0, 1.0, -0.32));
  for (const x of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.1, 0.6, 0.6), darkMat, x, 0.3, 0));
  g.add(mesh(rbox(2.3, 0.14, 0.6, 0.06), snowMat, 0, 0.72, 0.02));
  return g;
}

function makeTree() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.5, 0.6, 1.4, 10), mat(0x5a3a26), 0, 0.7, 0));
  const tiers = [];
  for (let i = 0; i < 5; i++) {
    const r = 4.3 - i * 0.82, h = 3.3 - i * 0.18, y = 1.1 + i * 1.75 + h / 2;
    tiers.push({ r, h, base: y - h / 2 });
    g.add(mesh(new THREE.ConeGeometry(r, h, 14), mat([0x1a4d36, 0x1e5a3e, 0x226446, 0x266e4c, 0x2b7853][i], { roughness: 0.9 }), 0, y, 0));
  }
  const radiusAt = y => { let best = 0; for (const t of tiers) if (y >= t.base && y <= t.base + t.h) best = Math.max(best, t.r * (1 - (y - t.base) / t.h)); return best; };
  const top = tiers[4].base + tiers[4].h;
  const nB = 190, bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, nB), m4 = new THREE.Matrix4(), col = new THREE.Color();
  for (let i = 0; i < nB; i++) { const t = i / nB, y = 1.3 + t * (top - 1.8), a = t * Math.PI * 2 * 6.5, r = radiusAt(y) + 0.12; m4.makeTranslation(Math.cos(a) * r, y, Math.sin(a) * r); bulbs.setMatrixAt(i, m4); bulbs.setColorAt(i, col.setRGB(...(i % 3 === 0 ? [5, 3.6, 1.2] : [4.6, 3.0, 1.0]))); }
  bulbs.userData.noShadow = true; g.add(bulbs);
  const nO = 46, orn = new THREE.InstancedMesh(new THREE.SphereGeometry(0.24, 14, 10), new THREE.MeshStandardMaterial({ roughness: 0.18, metalness: 0.55 }), nO);
  const oc = [0xd8333a, 0xffc94d, 0x4f7fe0, 0xe8e8f0, 0xd8333a];
  for (let i = 0; i < nO; i++) { const y = R(1.6, top - 1.2), a = R(0, Math.PI * 2), r = radiusAt(y) + 0.05; m4.makeTranslation(Math.cos(a) * r, y - 0.15, Math.sin(a) * r); orn.setMatrixAt(i, m4); orn.setColorAt(i, col.set(oc[i % 5])); }
  g.add(orn);
  const st = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.42 : 1.0; i ? st.lineTo(Math.cos(a) * r, Math.sin(a) * r) : st.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  const starGeo = new THREE.ExtrudeGeometry(st, { depth: 0.25, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 2 }); starGeo.center();
  const star = mesh(starGeo, new THREE.MeshStandardMaterial({ color: 0xffd76a, emissive: 0xffb830, emissiveIntensity: 3, metalness: 0.4, roughness: 0.3 }), 0, top + 0.55, 0);
  g.add(star); g.userData.star = star;
  const gc = [[0xd8333a, 0xffd166], [0x2f9e5b, 0xffffff], [0x4f7fe0, 0xffd166], [0xf2a93b, 0xd8333a], [0xe8e8f0, 0xd8333a], [0x9b59d0, 0xffd166], [0xd8333a, 0xffffff], [0x2f9e5b, 0xffd166]];
  gc.forEach(([c, r], i) => { const a = i / gc.length * Math.PI * 2 + 0.3, gf = makeGift(R(0.6, 1.1), c, r); gf.position.set(Math.cos(a) * 4.6, 0.08, Math.sin(a) * 4.6); gf.rotation.y = R(0, 2); g.add(gf); });
  return g;
}

function makePlaza() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(4.8, 4.8, 0.12, 48), new THREE.MeshStandardMaterial({ map: cobbleTex, roughness: 0.9 }), 0, 0.06, 0));
  const rim = mesh(new THREE.TorusGeometry(4.95, 0.32, 10, 64), snowMat, 0, 0.12, 0); rim.rotation.x = Math.PI / 2; rim.scale.z = 0.5; g.add(rim);
  const tree = makeTree(); tree.scale.setScalar(0.66); g.add(tree);
  g.userData.star = tree.userData.star;
  for (const [x, z, r] of [[-3.6, -3.6, Math.PI / 4], [3.6, -3.6, -Math.PI / 4]]) { const b = makeBench(); b.position.set(x, 0, z); b.rotation.y = r + Math.PI; b.scale.setScalar(0.8); g.add(b); }
  g.userData.altura = 9;
  g.userData.luz = true;
  return g;
}

export const MODELOS = {
  praca: makePlaza, casa: makeHouse, fabrica: makeFactory, padaria: makeBakery, rinque: makeRink,
  pinheiro: () => makePine(0.62), boneco: makeSnowman, poste: makeLamp, presentes: makeGiftPile,
};
function criarModelo(tipo) {
  const o = MODELOS[tipo]();
  o.traverse(m => { if (m.isMesh) { m.castShadow = !m.userData.noShadow; m.receiveShadow = true; } });
  return o;
}

function makeElf(color = 0x2e9e5b) {
  const g = new THREE.Group();
  const skin = mat(0xf3c29b, { roughness: 0.6 }), green = mat(color, { roughness: 0.7 }), white = mat(0xf8f8f8, { roughness: 0.9 }), red = mat(0xd8333a, { roughness: 0.6 });
  const legs = [-0.14, 0.14].map(x => { const l = new THREE.Group(); l.position.set(x, 0.55, 0); l.add(mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.45, 8), mat(0x1f5a3a), 0, -0.22, 0)); const s = mesh(new THREE.SphereGeometry(0.13, 10, 8), mat(0x6b3a22), 0, -0.47, 0.05); s.scale.set(1, 0.6, 1.5); l.add(s); g.add(l); return l; });
  g.add(mesh(new THREE.CapsuleGeometry(0.3, 0.35, 4, 12), green, 0, 0.88, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.315, 0.315, 0.09, 16), mat(0x2b1d14), 0, 0.74, 0));
  g.add(mesh(new THREE.BoxGeometry(0.14, 0.11, 0.05), mat(0xf2c14e, { metalness: 0.6, roughness: 0.3 }), 0, 0.74, 0.31));
  const arms = [-1, 1].map(s => { const a = new THREE.Group(); a.position.set(s * 0.33, 1.08, 0); a.add(mesh(new THREE.CapsuleGeometry(0.08, 0.3, 3, 8), green, 0, -0.2, 0)); a.add(mesh(new THREE.SphereGeometry(0.09, 8, 8), skin, 0, -0.42, 0)); a.rotation.z = s * 0.25; g.add(a); return a; });
  g.add(mesh(new THREE.SphereGeometry(0.31, 20, 16), skin, 0, 1.5, 0));
  for (const s of [-1, 1]) { const ear = mesh(new THREE.ConeGeometry(0.08, 0.3, 8), skin, s * 0.33, 1.55, 0); ear.rotation.z = s * -1.25; g.add(ear); }
  for (const s of [-1, 1]) { g.add(mesh(new THREE.SphereGeometry(0.04, 8, 8), mat(0x1d1d24), s * 0.1, 1.54, 0.28)); g.add(mesh(new THREE.SphereGeometry(0.06, 8, 8), mat(0xf29a9a), s * 0.17, 1.43, 0.25)); }
  g.add(mesh(new THREE.SphereGeometry(0.055, 8, 8), mat(0xe8a982), 0, 1.47, 0.31));
  const hat = new THREE.Group(); hat.position.y = 1.66; hat.rotation.z = -0.25; g.add(hat);
  hat.add(mesh(new THREE.ConeGeometry(0.31, 0.78, 16), red, 0, 0.39, 0));
  const brim = mesh(new THREE.TorusGeometry(0.29, 0.07, 8, 20), white, 0, 0.02, 0); brim.rotation.x = Math.PI / 2; hat.add(brim);
  hat.add(mesh(new THREE.SphereGeometry(0.1, 10, 8), white, 0, 0.8, 0));
  g.userData = { arms, legs };
  g.scale.setScalar(1.15);
  return shadowAll(g);
}
const ELF_CORES = [0x2e9e5b, 0x3a8fd0, 0xc23b6a, 0xe0902a, 0x8a5cc8, 0x2bb3a6];

// ---------- cena ----------
export async function criarCena(canvas) {
  await Promise.race([document.fonts.load('700 80px Fredoka'), new Promise(r => setTimeout(r, 1500))]).catch(() => {});
  makeSignTex();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x1d3270, 0.0068);
  const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.5, 1200);

  // céu com aurora e estrelas
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform float uTime;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 zen = vec3(0.015, 0.035, 0.13), mid = vec3(0.05, 0.12, 0.36), hor = vec3(0.17, 0.31, 0.66);
        vec3 col = mix(hor, mid, smoothstep(0.0, 0.22, h)); col = mix(col, zen, smoothstep(0.22, 0.85, h));
        if (h < 0.0) col = hor * 0.85;
        float az = atan(d.z, d.x); float t = uTime * 0.05; float a = 0.0;
        for (int i = 0; i < 3; i++) { float fi = float(i);
          float c = 0.30 + 0.09 * sin(az * 2.0 + fi * 1.9 + t * 2.0) + 0.06 * noise(vec2(az * 3.0 + fi * 5.0, t));
          float band = exp(-pow((h - c) * (6.5 + fi * 2.5), 2.0));
          float cur = 0.45 + 0.55 * noise(vec2(az * 26.0 + fi * 13.0, t * 5.0 + h * 2.0));
          a += band * cur * (0.95 - fi * 0.25); }
        a *= smoothstep(0.04, 0.2, h);
        vec3 ac = mix(vec3(0.12, 1.0, 0.72), vec3(0.3, 0.75, 1.0), smoothstep(0.22, 0.45, h));
        ac = mix(ac, vec3(0.8, 0.45, 1.0), smoothstep(0.42, 0.62, h) * 0.55);
        col += ac * a * 0.85;
        vec2 sp = vec2(az * 110.0, h * 150.0); vec2 cell = floor(sp); float s = hash(cell); vec2 f = fract(sp) - 0.5;
        float star = step(0.986, s) * smoothstep(0.14, 0.0, length(f)) * smoothstep(0.1, 0.4, h);
        col += vec3(star) * (0.7 + 0.3 * sin(uTime * 2.0 + s * 60.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 48, 24), skyMat);
  scene.add(sky);

  scene.add(new THREE.HemisphereLight(0x8fb0ff, 0x24336e, 0.95));
  const moon = new THREE.DirectionalLight(0xb8ccff, 1.25);
  moon.position.set(-30, 50, 35); moon.castShadow = true;
  moon.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
  Object.assign(moon.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, near: 1, far: 160 });
  moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.04;
  scene.add(moon);
  const treeLight = new THREE.PointLight(0xffc46b, 110, 26, 2); scene.add(treeLight);

  // terreno: plano no meio (a vila), morros em volta
  const borda = MEIO * T;
  const hAt = (x, z) => {
    const d = Math.max(Math.abs(x), Math.abs(z)), S = THREE.MathUtils.smoothstep, dr = Math.hypot(x, z);
    const hill = S(dr, 40, 105) * 20 * (0.7 + 0.3 * Math.sin(x * 0.05 + z * 0.04));
    const n = Math.sin(x * 0.08) * Math.cos(z * 0.07) * 1.8 + Math.sin(x * 0.21 + z * 0.17) * 0.6;
    return hill + S(d, borda + 6, borda + 30) * n + S(d, borda + 1, borda + 6) * Math.sin(x * 0.35) * Math.sin(z * 0.3) * 0.25;
  };
  {
    const geo = new THREE.PlaneGeometry(460, 460, 230, 230); geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, hAt(p.getX(i), p.getZ(i)));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, mat(0xe4ecff, { roughness: 0.93 })); ground.receiveShadow = true; scene.add(ground);
  }
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2 + R(-0.15, 0.15), d = R(170, 220), h = R(45, 80);
    const m = mesh(new THREE.ConeGeometry(R(40, 60), h, 7, 1), mat(0xcfdcf8, { roughness: 1, flatShading: true }), Math.cos(a) * d, h / 2 - 2, Math.sin(a) * d);
    m.rotation.y = R(0, 3); scene.add(m);
  }

  // ruas
  for (const r of RUAS) {
    const w = r.w * T, h = r.h * T, c = centroLote(r.x, r.z, 1).add(V3((r.w - 1) * T / 2, 0, (r.h - 1) * T / 2));
    const alongX = r.w >= r.h, len = alongX ? w : h, wid = (alongX ? h : w) * 0.82;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(wid, len), new THREE.MeshStandardMaterial({ map: rep(roadTex, 1, len / 6), roughness: 0.95 }));
    m.rotation.x = -Math.PI / 2; if (alongX) m.rotation.z = Math.PI / 2; m.position.set(c.x, 0.03, c.z); m.receiveShadow = true; scene.add(m);
  }

  // cerca em volta da vila (com abertura na rua da frente)
  {
    const wm = mat(0x4a3324, { roughness: 0.9 }), posts = [], step = 2.5, e = borda + 1.2;
    for (let s = -e; s <= e + 0.01; s += step) { posts.push([s, -e], [-e, s], [e, s]); if (Math.abs(s) > 3) posts.push([s, e]); }
    const pGeo = rbox(0.28, 1.5, 0.28, 0.05), cGeo = rbox(0.38, 0.2, 0.38, 0.09);
    const ip = new THREE.InstancedMesh(pGeo, wm, posts.length), ic = new THREE.InstancedMesh(cGeo, snowMat, posts.length), m4 = new THREE.Matrix4();
    posts.forEach(([x, z], i) => { m4.makeTranslation(x, 0.75, z); ip.setMatrixAt(i, m4); m4.makeTranslation(x, 1.58, z); ic.setMatrixAt(i, m4); });
    ip.castShadow = true; scene.add(ip, ic);
    const rail = (x1, z1, x2, z2) => { const len = Math.hypot(x2 - x1, z2 - z1); for (const [y, mm, hh] of [[1.15, wm, 0.18], [0.6, wm, 0.18], [1.28, snowMat, 0.1]]) { const r = mesh(rbox(len, hh, 0.14, 0.04), mm, (x1 + x2) / 2, y, (z1 + z2) / 2); r.rotation.y = -Math.atan2(z2 - z1, x2 - x1); scene.add(r); } };
    rail(-e, -e, e, -e); rail(-e, -e, -e, e); rail(e, -e, e, e); rail(-e, e, -3.5, e); rail(3.5, e, e, e);
  }

  // floresta (instanciada)
  {
    const pts = [];
    while (pts.length < (coarse ? 380 : 620)) {
      const a = R(0, Math.PI * 2), d = R(borda + 6, 125), x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.max(Math.abs(x), Math.abs(z)) < borda + 5) continue;
      if (z > borda && Math.abs(x) < 6 && d < 55) continue;
      if (Math.abs(Math.atan2(z, x) - 0.86) < 0.55 && d < 65) continue;
      pts.push([x, z, R(1.0, 2.0) * (d > 60 ? 1.4 : 1)]);
    }
    const parts = [
      [new THREE.CylinderGeometry(0.25, 0.35, 1.2, 6), mat(0x5a3a26), 0.6, false],
      [new THREE.ConeGeometry(2.2, 3.0, 8), mat(0xffffff, { roughness: 0.9 }), 2.4, true],
      [new THREE.ConeGeometry(1.7, 2.6, 8), mat(0xffffff, { roughness: 0.9 }), 3.9, true],
      [new THREE.ConeGeometry(1.15, 2.2, 8), mat(0xffffff, { roughness: 0.9 }), 5.2, true],
      [new THREE.ConeGeometry(2.2 * 0.45 * 1.07, 1.35, 8), snowMat, 3.225, false],
      [new THREE.ConeGeometry(1.7 * 0.45 * 1.07, 1.17, 8), snowMat, 4.615, false],
      [new THREE.ConeGeometry(1.15 * 0.6 * 1.07, 1.32, 8), snowMat, 5.64, false],
    ];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), up = V3(0, 1, 0);
    const greens = [0x1b4636, 0x1f5140, 0x174030, 0x235a44];
    for (const [geo, m, py, tint] of parts) {
      const im = new THREE.InstancedMesh(geo, m, pts.length);
      pts.forEach(([x, z, s], i) => { q.setFromAxisAngle(up, (i * 2.399) % 6.28); m4.compose(V3(x, hAt(x, z) - 0.2 + py * s, z), q, V3(s, s, s)); im.setMatrixAt(i, m4); if (tint) im.setColorAt(i, c.set(greens[i % 4])); });
      im.castShadow = true; im.receiveShadow = true; scene.add(im);
    }
  }

  // neve caindo
  const flakeN = coarse ? 1800 : 3600;
  const flakeGeo = new THREE.BufferGeometry(), fp = new Float32Array(flakeN * 3), fs = new Float32Array(flakeN);
  for (let i = 0; i < flakeN; i++) { fp[i * 3] = R(-70, 70); fp[i * 3 + 1] = R(0, 45); fp[i * 3 + 2] = R(-70, 70); fs[i] = R(0.6, 1.6); }
  flakeGeo.setAttribute('position', new THREE.BufferAttribute(fp, 3));
  scene.add(new THREE.Points(flakeGeo, new THREE.PointsMaterial({ size: 0.32, map: flakeTex, transparent: true, depthWrite: false, opacity: 0.9 })));

  // fumaça das chaminés (pool fixo de sprites, redistribuído entre as chaminés que existem)
  const puffs = [];
  for (let i = 0; i < 54; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xc8d4f2, transparent: true, depthWrite: false, opacity: 0 }));
    s.userData = { life: (i % 9) / 9, drift: R(0.6, 1.2) }; scene.add(s); puffs.push(s);
  }
  let chimneys = [];

  // grade do modo construir
  const gradeGroup = new THREE.Group(); gradeGroup.visible = false; scene.add(gradeGroup);
  {
    const lines = [], y = 0.1;
    for (let i = 0; i <= TAMANHO; i++) { const p = (i - MEIO) * T; lines.push(p, y, -borda, p, y, borda, -borda, y, p, borda, y, p); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    gradeGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 })));
  }
  const footMat = new THREE.MeshBasicMaterial({ color: 0x5cd6a6, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false });
  const foot = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), footMat); foot.rotation.x = -Math.PI / 2; foot.visible = false; scene.add(foot);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.visible = false; scene.add(ring);

  // pós-processamento
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.45, 1.1);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // câmera: um dedo arrasta, dois dedos giram/zoom; no mouse, esquerdo arrasta e direito gira
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.screenSpacePanning = false;
  controls.minDistance = 14; controls.maxDistance = 95; controls.minPolarAngle = 0.4; controls.maxPolarAngle = 1.25;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.target.set(0, 0, 1);
  function enquadrar() {
    camera.aspect = innerWidth / innerHeight;
    camera.fov = camera.aspect < 1 ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(19)) / camera.aspect)) : 36;
    camera.updateProjectionMatrix();
  }
  enquadrar();
  camera.position.copy(controls.target).add(V3(34, 30, 42).multiplyScalar(camera.aspect < 1 ? 0.8 : 0.85));
  controls.update();

  // ---------- estado desenhado ----------
  const predios = new Map();    // id -> { obj, tipo, tam }
  const elfs = new Map();       // duende id -> { obj, alvo, ... }
  const raiz = new THREE.Group(); scene.add(raiz);
  let vilaAtual = null, praca = null;
  let fantasma = null;

  function posicionar(obj, p) {
    const tam = TIPOS[p.tipo].tam, c = centroLote(p.x, p.z, tam);
    obj.position.set(c.x, 0, c.z); obj.rotation.y = -(p.r || 0) * Math.PI / 2;
  }

  function sincronizar(vila) {
    vilaAtual = vila;
    const vivos = new Set();
    for (const p of vila.predios) {
      vivos.add(p.id);
      let e = predios.get(p.id);
      if (!e || e.tipo !== p.tipo) { if (e) raiz.remove(e.obj); const obj = criarModelo(p.tipo); obj.userData.predioId = p.id; raiz.add(obj); e = { obj, tipo: p.tipo }; predios.set(p.id, e); }
      posicionar(e.obj, p);
      e.p = p;
    }
    for (const [id, e] of predios) if (!vivos.has(id)) { raiz.remove(e.obj); predios.delete(id); }
    praca = vila.predios.find(p => p.tipo === 'praca') || null;
    if (praca) { const c = centroLote(praca.x, praca.z, 4); treeLight.position.set(c.x, 8.5, c.z); treeLight.visible = true; } else treeLight.visible = false;
    // chaminés
    raiz.updateMatrixWorld(true);
    chimneys = [];
    for (const e of predios.values()) for (const s of e.obj.userData.smoke || []) chimneys.push(e.obj.localToWorld(s.clone()));
    // duendes
    const vivosD = new Set();
    vila.duendes.forEach((d, i) => {
      vivosD.add(d.id);
      if (!elfs.has(d.id)) {
        const obj = makeElf(ELF_CORES[i % ELF_CORES.length]);
        const start = praca ? centroLote(praca.x, praca.z, 4) : V3(0, 0, 0);
        obj.position.copy(start).add(V3(R(-4, 4), 0, R(3, 5)));
        scene.add(obj); elfs.set(d.id, { obj, alvo: obj.position.clone(), troca: 0, idx: i });
      }
      elfs.get(d.id).d = d;
    });
    for (const [id, e] of elfs) if (!vivosD.has(id)) { scene.remove(e.obj); elfs.delete(id); }
  }

  // ponto onde o duende trabalha: na frente do prédio, lado a lado
  function postoDeTrabalho(p, n) {
    const tam = TIPOS[p.tipo].tam, c = centroLote(p.x, p.z, tam), a = -(p.r || 0) * Math.PI / 2;
    const local = V3((n - 1) * 1.1, 0, tam * T / 2 + 0.9);
    local.applyAxisAngle(V3(0, 1, 0), a);
    return { pos: c.add(local), rot: a };
  }

  // ---------- fantasma (construir/mover) ----------
  function setFantasma(tipo, x, z, r, valido) {
    if (!tipo) {
      if (fantasma) { scene.remove(fantasma.obj); fantasma = null; }
      foot.visible = false; return;
    }
    if (!fantasma || fantasma.tipo !== tipo) {
      if (fantasma) scene.remove(fantasma.obj);
      const obj = criarModelo(tipo);
      obj.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.transparent = true; m.material.opacity = 0.82; m.castShadow = false; } });
      scene.add(obj); fantasma = { obj, tipo };
    }
    const tam = TIPOS[tipo].tam, c = centroLote(x, z, tam);
    fantasma.obj.position.set(c.x, 0.6, c.z); fantasma.obj.rotation.y = -(r || 0) * Math.PI / 2;
    foot.visible = true; foot.position.set(c.x, 0.12, c.z); foot.scale.set(tam * T, tam * T, 1);
    footMat.color.set(valido ? 0x5cd6a6 : 0xff5a5f);
  }

  function setGrade(on) { gradeGroup.visible = on; }

  function setSelecionado(id) {
    const e = id && predios.get(id);
    if (!e) { ring.visible = false; return; }
    const tam = TIPOS[e.tipo].tam;
    ring.visible = true; ring.position.set(e.obj.position.x, 0.14, e.obj.position.z); ring.scale.setScalar(tam * T * 0.72);
  }
  // o prédio sendo movido some do lugar original enquanto o fantasma está ativo
  function esconder(id) { for (const [pid, e] of predios) e.obj.visible = pid !== id; }

  // ---------- picking ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), chao = new THREE.Plane(V3(0, 1, 0), 0);
  function setRay(cx, cy) { ndc.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); }
  function loteEm(cx, cy) {
    setRay(cx, cy);
    const p = ray.ray.intersectPlane(chao, V3());
    if (!p) return null;
    return { x: Math.floor(p.x / T + MEIO), z: Math.floor(p.z / T + MEIO), fx: p.x / T + MEIO, fz: p.z / T + MEIO };
  }
  function predioEm(cx, cy) {
    setRay(cx, cy);
    const hits = ray.intersectObjects(raiz.children, true);
    for (const h of hits) { let o = h.object; while (o && !o.userData.predioId) o = o.parent; if (o && o.visible) return o.userData.predioId; }
    return null;
  }
  function projetar(v) {
    const t = v.clone().project(camera);
    return { x: (t.x * 0.5 + 0.5) * innerWidth, y: (-t.y * 0.5 + 0.5) * innerHeight, visivel: t.z < 1 && Math.abs(t.x) < 1.1 && Math.abs(t.y) < 1.1 };
  }
  function topoDe(id) {
    const e = predios.get(id); if (!e) return null;
    return V3(e.obj.position.x, (e.obj.userData.altura || 5) + 1.2, e.obj.position.z);
  }
  function focar(id) {
    const e = predios.get(id); if (!e) return;
    const off = camera.position.clone().sub(controls.target);
    controls.target.set(e.obj.position.x, 0, e.obj.position.z + 2); camera.position.copy(controls.target).add(off);
  }

  // ---------- miniaturas pro menu ----------
  function miniaturas(tipos) {
    const tr = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    tr.setPixelRatio(1); tr.setSize(240, 180); tr.outputColorSpace = THREE.SRGBColorSpace; tr.toneMapping = THREE.ACESFilmicToneMapping;
    const s = new THREE.Scene(); s.add(new THREE.HemisphereLight(0xbcd0ff, 0x3a4a80, 2.2)); const dl = new THREE.DirectionalLight(0xffffff, 2); dl.position.set(5, 10, 8); s.add(dl);
    const cam = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 200), urls = {};
    for (const k of tipos) {
      const o = MODELOS[k](); o.traverse(m => { if (m.isMesh && m.material === poolMat) m.visible = false; });
      s.add(o); const box = new THREE.Box3().setFromObject(o), size = box.getSize(V3()), c = box.getCenter(V3()), dist = Math.max(size.x, size.y, size.z) * 2.1;
      cam.position.copy(c).add(V3(0.75, 0.55, 1).normalize().multiplyScalar(dist)); cam.lookAt(c);
      tr.render(s, cam); urls[k] = tr.domElement.toDataURL('image/png'); s.remove(o);
    }
    tr.dispose(); tr.forceContextLoss();
    return urls;
  }

  // ---------- loop ----------
  const clock = new THREE.Clock();
  const ouvintes = [];
  const limite = borda + 4;
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
    skyMat.uniforms.uTime.value = t; sky.position.copy(camera.position);
    controls.update();
    // não deixa a câmera fugir da vila
    const tg = controls.target, ox = THREE.MathUtils.clamp(tg.x, -limite, limite) - tg.x, oz = THREE.MathUtils.clamp(tg.z, -limite, limite) - tg.z;
    if (ox || oz) { tg.x += ox; tg.z += oz; camera.position.x += ox; camera.position.z += oz; }
    tg.y = 0;

    const p = flakeGeo.attributes.position.array, sp = reduceMotion ? 0.4 : 1;
    for (let i = 0; i < flakeN; i++) {
      p[i * 3 + 1] -= dt * 2.2 * fs[i] * sp; p[i * 3] += Math.sin(t * 0.7 + i) * dt * 0.4 * sp;
      if (p[i * 3 + 1] < 0) { p[i * 3 + 1] = 45; p[i * 3] = R(-70, 70) + tg.x; p[i * 3 + 2] = R(-70, 70) + tg.z; }
    }
    flakeGeo.attributes.position.needsUpdate = true;

    puffs.forEach((s, i) => {
      const src = chimneys[Math.floor(i / 9)];
      if (!src) { s.visible = false; return; }
      s.visible = true;
      const u = s.userData; u.life += dt * 0.18; if (u.life > 1) u.life -= 1;
      s.position.set(src.x + Math.sin(u.life * 4 + u.drift) * 0.6 + u.life * 2.2, src.y + u.life * 6, src.z - u.life * 0.8);
      const sc = 0.9 + u.life * 3.2; s.scale.set(sc, sc, 1); s.material.opacity = Math.sin(u.life * Math.PI) * 0.5;
    });

    for (const e of predios.values()) if (e.obj.userData.star) e.obj.userData.star.rotation.y = t * 0.6;
    if (fantasma) fantasma.obj.position.y = 0.6 + Math.sin(t * 3) * 0.25;
    if (ring.visible) ring.material.opacity = 0.65 + Math.sin(t * 4) * 0.25;

    // duendes: vão até o posto (ou passeiam pela praça) e trabalham
    if (vilaAtual) {
      const contagem = new Map();
      for (const e of elfs.values()) {
        const d = e.d, o = e.obj, u = o.userData;
        const pr = d.predio && predios.get(d.predio);
        let trabalhando = false;
        if (pr && pr.obj.visible) {
          const n = (contagem.get(d.predio) || 0) + 1; contagem.set(d.predio, n);
          const posto = postoDeTrabalho(pr.p, n); e.alvo.copy(posto.pos); e.rotTrabalho = posto.rot; trabalhando = true;
        } else if (t > e.troca) {
          const c = praca ? centroLote(praca.x, praca.z, 4) : V3(0, 0, 0), a = R(0, Math.PI * 2);
          e.alvo.set(c.x + Math.cos(a) * 6, 0, c.z + Math.sin(a) * 6); e.troca = t + R(4, 9);
        }
        const dx = e.alvo.x - o.position.x, dz = e.alvo.z - o.position.z, dist = Math.hypot(dx, dz);
        if (dist > 0.15) {
          const v = Math.min(dist, dt * 3.2);
          o.position.x += dx / dist * v; o.position.z += dz / dist * v;
          o.rotation.y = Math.atan2(dx, dz);
          o.position.y = Math.abs(Math.sin(t * 9 + e.idx)) * 0.08;
          u.legs.forEach((l, i) => l.rotation.x = Math.sin(t * 9 + i * Math.PI) * 0.6);
          u.arms.forEach((a, i) => a.rotation.x = Math.sin(t * 9 + i * Math.PI + Math.PI) * 0.5);
        } else {
          u.legs.forEach(l => l.rotation.x = 0);
          if (trabalhando) {
            o.rotation.y = e.rotTrabalho + Math.PI;
            u.arms[0].rotation.x = -0.5; u.arms[1].rotation.x = -1.2 - Math.abs(Math.sin(t * 5 + e.idx)) * 1.1;
            o.position.y = Math.abs(Math.sin(t * 5 + e.idx)) * 0.04;
          } else { u.arms.forEach(a => a.rotation.x = 0); o.position.y = 0; }
        }
      }
    }

    for (const fn of ouvintes) fn(dt);
    composer.render();
    requestAnimationFrame(frame);
  }

  addEventListener('resize', () => {
    enquadrar(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); bloom.resolution.set(innerWidth, innerHeight);
  });
  requestAnimationFrame(frame);

  return {
    sincronizar, setFantasma, setGrade, setSelecionado, esconder, loteEm, predioEm, projetar, topoDe, focar, miniaturas,
    aoQuadro: fn => ouvintes.push(fn),
    controls,
  };
}
