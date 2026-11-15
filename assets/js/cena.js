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
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { TAMANHO, RUAS, TIPOS, ITENS, MAPA_MIN, MAPA_MAX, TERRENOS } from './regras.js';

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
  t.userData.compartilhado = true;
  return t;
}
const rep = (t, x, y) => { const c = t.clone(); c.repeat.set(x, y); c.needsUpdate = true; c.userData.compartilhado = false; return c; };

// Libera da placa de vídeo um modelo que saiu de cena (sem isso a memória só cresce
// a cada enfeite/nível novo). Materiais, geometrias e texturas compartilhados ficam.
function liberar(obj) {
  obj.traverse(o => {
    if (o.geometry && !o.geometry.userData.compartilhado) o.geometry.dispose();
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) {
      if (m.userData.compartilhado) continue;
      for (const k of ['map', 'emissiveMap']) if (m[k] && !m[k].userData.compartilhado) m[k].dispose();
      m.dispose();
    }
    if (o.isInstancedMesh) o.dispose();
  });
}

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

// Casa: cresce com o nível (1: chalé, 2: ganha uma ala, 3: segundo andar e varanda) e
// mostra a decoração da fachada comprada (pisca-pisca, guirlanda, velas, jardim).
function candle() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.32, 8), mat(0xf6efe2), 0, 0.16, 0));
  const f = mesh(new THREE.SphereGeometry(0.07, 8, 6), bulbMat.clone(), 0, 0.38, 0); f.scale.y = 1.6; f.material.color.setRGB(5, 3, 1.2); g.add(f);
  return g;
}
// ---------- casa realista (estilo das fotos de referência, em noite de Natal) ----------
// Reboco/siding claro, telhado escuro com testeira preta, janelas pretas acesas,
// pórtico com colunas, garagem e varanda com grade. Cresce com o nível:
// 1 = casa térrea com frontão, 2 = ganha garagem, 3 = sobrado com varanda.
// Cada casa tem uma variante (cor da parede, do telhado e lado da garagem) tirada do id.
const sidingTex = tex(256, 256, (g, w, h) => {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 32) { const gr = g.createLinearGradient(0, y, 0, y + 32); gr.addColorStop(0, 'rgba(0,0,0,0.13)'); gr.addColorStop(0.14, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(255,255,255,0.04)'); g.fillStyle = gr; g.fillRect(0, y, w, 32); }
  for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(0,0,0,${R(0, 0.025)})`; g.fillRect(R(0, w), R(0, h), 2, 1); }
});
const rebocoTex = tex(256, 256, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(0,0,0,${R(0, 0.035)})`; g.fillRect(R(0, w), R(0, h), R(1, 3), R(1, 3)); } });
const telhaTex = tex(256, 256, (g, w, h) => {
  g.fillStyle = '#bdbdbd'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 16) for (let x = -32; x < w + 32; x += 32) {
    const off = (y / 16) % 2 ? 16 : 0; g.fillStyle = `hsl(0,0%,${70 + R(-12, 10)}%)`; g.fillRect(x + off + 1, y + 1, 30, 14);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + off, y + 13, 32, 3);
  }
});
const pedraTex = tex(256, 256, (g, w, h) => {
  g.fillStyle = '#cfc4ae'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 14; i++) { const x = R(0, w), y = R(0, h), r = R(22, 46); g.fillStyle = `hsl(38,${R(15, 28)}%,${R(70, 82)}%)`; g.beginPath(); for (let k = 0; k < 7; k++) { const a = k / 7 * 6.28, rr = r * R(0.7, 1.1); k ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.fill(); g.strokeStyle = 'rgba(80,60,40,0.3)'; g.lineWidth = 2; g.stroke(); }
});
const VARIANTES = [
  { parede: 0xf4f3ef, telhado: 0x4a4d55 }, { parede: 0xefe4d2, telhado: 0x4b3f38 },
  { parede: 0xe2e7ec, telhado: 0x3c4048 }, { parede: 0xf6f1e8, telhado: 0x5a3e36 }, { parede: 0xdfe3da, telhado: 0x3f4a44 },
];
const MR = {
  branco: mat(0xf5f5f2, { roughness: 0.6 }),
  preto: mat(0x17181c, { roughness: 0.45, metalness: 0.4 }),
  vidro: new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffa652, emissiveIntensity: 1.5, roughness: 0.2 }),
  calcada: mat(0xdcdcd8, { roughness: 0.9 }),
  pedra: new THREE.MeshStandardMaterial({ map: rep(pedraTex, 1, 1), roughness: 0.9 }),
  folha: mat(0x2f5a2c, { roughness: 0.95 }),
  folha2: mat(0x24472a, { roughness: 0.95 }),
  garagem: mat(0x1d1f24, { roughness: 0.5, metalness: 0.3 }),
  lampada: new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 3.6, 2), toneMapped: false }),
  ledBranco: new THREE.MeshBasicMaterial({ color: new THREE.Color(4.5, 3.6, 2.2), toneMapped: false }),
};
const matParede = new Map(), matReboco = new Map(), matTelha = new Map();
const deCor = (mapa, cor, criar) => { if (!mapa.has(cor)) mapa.set(cor, criar()); return mapa.get(cor); };
function hashId(id) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }

function mR(geo, m, x = 0, y = 0, z = 0) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); return o; }
const caixa = (w, h, d, m, x, y, z) => mR(new THREE.BoxGeometry(w, h, d), m, x, y, z);

function janelaR(w, h, cols, rows) {
  const g = new THREE.Group();
  g.add(mR(new THREE.PlaneGeometry(w, h), MR.vidro, 0, 0, 0.01));
  g.add(caixa(w + 0.16, 0.12, 0.14, MR.preto, 0, h / 2, 0.05)); g.add(caixa(w + 0.16, 0.12, 0.14, MR.preto, 0, -h / 2, 0.05));
  g.add(caixa(0.12, h, 0.14, MR.preto, -w / 2, 0, 0.05)); g.add(caixa(0.12, h, 0.14, MR.preto, w / 2, 0, 0.05));
  for (let i = 1; i < cols; i++) g.add(caixa(0.05, h, 0.08, MR.preto, -w / 2 + i * w / cols, 0, 0.04));
  for (let i = 1; i < rows; i++) g.add(caixa(w, 0.05, 0.08, MR.preto, 0, -h / 2 + i * h / rows, 0.04));
  g.add(caixa(w + 0.4, 0.1, 0.3, MR.branco, 0, -h / 2 - 0.1, 0.12));
  g.add(caixa(w + 0.5, 0.14, 0.42, snowMat, 0, -h / 2 - 0.02, 0.16));
  return g;
}
function lanternaR() {
  const g = new THREE.Group();
  g.add(caixa(0.22, 0.36, 0.22, MR.preto, 0, 0, 0.2));
  g.add(mR(new THREE.BoxGeometry(0.15, 0.25, 0.15), MR.lampada, 0, 0, 0.2));
  return g;
}
// frontão (cumeeira ao longo de z, triângulo virado pra frente) com telhado, neve e testeira preta
function frontaoR({ w, d, h, beiral = 0.45, parede, telha }) {
  const g = new THREE.Group(), a = w / 2, th = Math.atan2(h, a), L = Math.hypot(a, h) + beiral;
  const tri = new THREE.Shape(); tri.moveTo(-a, 0); tri.lineTo(a, 0); tri.lineTo(0, h); tri.closePath();
  g.add(mR(new THREE.ExtrudeGeometry(tri, { depth: d, bevelEnabled: false }), parede, 0, 0, -d / 2));
  for (const s of [-1, 1]) {
    const cx = s * (a + beiral * Math.cos(th)) / 2, cy = (h - beiral * Math.sin(th)) / 2, nx = s * Math.sin(th), ny = Math.cos(th);
    const agua = caixa(L, 0.16, d + beiral * 2, telha, cx + nx * 0.08, cy + ny * 0.08, 0); agua.rotation.z = -s * th; g.add(agua);
    const nv = caixa(L, 0.2, d + beiral * 2, snowMat, cx + nx * 0.26, cy + ny * 0.26, 0); nv.rotation.z = -s * th; g.add(nv);
    for (const zz of [d / 2 + beiral + 0.02, -d / 2 - beiral - 0.02]) { const fx = caixa(L + 0.1, 0.32, 0.12, MR.preto, cx + nx * 0.05, cy + ny * 0.05, zz); fx.rotation.z = -s * th; g.add(fx); }
  }
  g.userData.beiral = { a, th, beiral, h, d };
  return g;
}
function telhadoXR(o) { const g = frontaoR({ ...o, w: o.d, d: o.w }); g.rotation.y = Math.PI / 2; return g; }
// LEDs presos na testeira do frontão (coordenadas locais do grupo pai do frontão)
function ledsFrontao(pai, fr) {
  const { a, th, beiral, h, d } = fr.userData.beiral, b = fr.position, z = b.z + d / 2 + beiral + 0.1;
  const e = V3(b.x - (a + beiral * Math.cos(th)), b.y - beiral * Math.sin(th) - 0.12, z), topo = V3(b.x, b.y + h + 0.02, z), dd = V3(b.x + a + beiral * Math.cos(th), e.y, z);
  ledsLinha(pai, e, topo, 22); ledsLinha(pai, topo, dd, 22);
}
function ledsLinha(pai, p0, p1, n, mat_ = MR.ledBranco) {
  const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 6, 4), mat_, n + 1), m4 = new THREE.Matrix4();
  for (let i = 0; i <= n; i++) { const p = p0.clone().lerp(p1, i / n); m4.makeTranslation(p.x, p.y, p.z); im.setMatrixAt(i, m4); }
  im.userData.noShadow = true; pai.add(im);
}
function guirlandaR(r = 0.4) {
  const g = new THREE.Group(), verde = mat(0x24502e, { roughness: 0.95 }), laco = mat(0xb3202a, { roughness: 0.5 });
  g.add(mR(new THREE.TorusGeometry(r, r * 0.3, 8, 20), verde));
  g.add(mR(new THREE.SphereGeometry(r * 0.24, 8, 8), laco, 0, -r, 0.08));
  return g;
}
function arbustoR(r, cor = MR.folha) {
  const geo = new THREE.IcosahedronGeometry(r, 2), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + Math.sin(x * 9) * Math.sin(y * 11) * Math.sin(z * 7) * 0.08; p.setXYZ(i, x * k, y * k * 0.88, z * k); }
  geo.computeVertexNormals();
  return mR(geo, cor);
}
function conePinheiro(r, h, cor = MR.folha2) {
  const geo = new THREE.ConeGeometry(r, h, 18, 8), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + Math.sin(y * 6 + Math.atan2(z, x) * 5) * 0.07; p.setXYZ(i, x * k, y, z * k); }
  geo.computeVertexNormals();
  const o = mR(geo, cor); o.position.y = h / 2; return o;
}
function posteJardim() {
  const g = new THREE.Group();
  g.add(mR(new THREE.CylinderGeometry(0.05, 0.07, 1.4, 8), MR.preto, 0, 0.7, 0));
  g.add(caixa(0.22, 0.3, 0.22, MR.preto, 0, 1.5, 0));
  g.add(mR(new THREE.BoxGeometry(0.16, 0.22, 0.16), MR.lampada, 0, 1.5, 0));
  return g;
}
function carroEsportivo(cor) {
  const g = new THREE.Group();
  const lado = new THREE.Shape();
  lado.moveTo(-2.2, 0.25); lado.lineTo(2.1, 0.25); lado.quadraticCurveTo(2.35, 0.3, 2.3, 0.55); lado.quadraticCurveTo(1.8, 0.75, 0.9, 0.85);
  lado.quadraticCurveTo(0.2, 1.3, -0.7, 1.25); lado.quadraticCurveTo(-1.6, 1.1, -2.15, 0.85); lado.quadraticCurveTo(-2.3, 0.5, -2.2, 0.25);
  g.add(mR(new THREE.ExtrudeGeometry(lado, { depth: 1.7, bevelEnabled: true, bevelThickness: 0.18, bevelSize: 0.16, bevelSegments: 3, curveSegments: 10 }), mat(cor, { roughness: 0.25, metalness: 0.5 }), 0, 0, -0.85));
  const vid = new THREE.Shape(); vid.moveTo(0.75, 0.9); vid.quadraticCurveTo(0.15, 1.27, -0.65, 1.22); vid.quadraticCurveTo(-1.3, 1.1, -1.55, 0.95); vid.lineTo(0.75, 0.9);
  g.add(mR(new THREE.ExtrudeGeometry(vid, { depth: 1.5, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 2 }), vidroMat, 0, 0.03, -0.75));
  const aro = mat(0xd8dade, { metalness: 1, roughness: 0.25 });
  for (const x of [-1.4, 1.45]) for (const z of [-0.95, 0.95]) {
    const r = mR(new THREE.CylinderGeometry(0.38, 0.38, 0.28, 16), pneuMat, x, 0.38, z); r.rotation.x = Math.PI / 2; g.add(r);
    const a = mR(new THREE.CylinderGeometry(0.25, 0.25, 0.3, 10), aro, x, 0.38, z); a.rotation.x = Math.PI / 2; g.add(a);
  }
  for (const z of [-0.6, 0.6]) g.add(mR(new THREE.SphereGeometry(0.1, 8, 6), MR.lampada, 2.35, 0.55, z));
  g.add(caixa(1.6, 0.15, 0.9, snowMat, -0.4, 1.32, 0));
  return g;
}

function makeHouse(p = {}) {
  const nv = p.nv || 1, it = p.itens || {}, hv = hashId(p.id || 'vitrine'), var_ = VARIANTES[hv % VARIANTES.length];
  const s = (hv >> 3) % 2 ? 1 : -1; // lado da garagem
  const parede = deCor(matParede, var_.parede, () => new THREE.MeshStandardMaterial({ map: rep(sidingTex, 3, 1.5), color: var_.parede, roughness: 0.85 }));
  const reboco = deCor(matReboco, var_.parede, () => new THREE.MeshStandardMaterial({ map: rep(rebocoTex, 2, 2), color: var_.parede, roughness: 0.9 }));
  const telha = deCor(matTelha, var_.telhado, () => new THREE.MeshStandardMaterial({ map: rep(telhaTex, 2, 2), color: var_.telhado, roughness: 0.8 }));
  const casa = new THREE.Group(); // em unidades "de referência"; no fim escala 0.5 pra caber em 3x3 lotes
  const base = 0.35, janelas = [], leds = !!it.pisca;
  const ala = new THREE.Group();
  // ala principal com frontão grande
  const alaX = nv === 1 ? 0 : nv === 2 ? -3.4 * s : -4.6 * s;
  ala.position.x = alaX; casa.add(ala);
  ala.add(caixa(5.6, 4.6, 8, reboco, 0, base + 2.3, 0));
  const fr = frontaoR({ w: 5.6, d: 8, h: 2.8, parede, telha }); fr.position.y = base + 4.6; ala.add(fr);
  ala.add(caixa(5.8, 0.18, 0.25, MR.branco, 0, 4.0, 4.05));
  const portaNaAla = nv === 1;
  const xsJ = portaNaAla ? [-1.7, 1.7] : [-1.6, 0, 1.6];
  for (const x of xsJ) { const j = janelaR(1.2, 2.6, 2, 4); j.position.set(x, 2.3, 4.02); ala.add(j); janelas.push([ala, x, 2.3 - 1.3, 4.02]); }
  for (const x of [-2.75, 2.75]) ala.add(caixa(0.4, 4.4, 0.4, MR.branco, x, base + 2.2, 4.0));
  if (leds) ledsFrontao(ala, fr);
  // entrada (pórtico com colunas e porta de vidro alta)
  const ent = new THREE.Group(); casa.add(ent);
  if (portaNaAla) ent.position.set(0, 0, 4.0); else if (nv === 2) ent.position.set(alaX + 3.6 * s, 0, 3.4); else ent.position.set(-2.0 * s + 2.2 * s, 0, 3.0);
  const porta = janelaR(1.6, 3.0, 2, 4); porta.position.set(0, base + 1.5, 0.05); ent.add(porta);
  for (const x of [-1.25, 1.25]) { ent.add(caixa(0.4, 3.9, 0.4, MR.branco, x, base + 1.95, 1.4)); ent.add(caixa(0.6, 0.8, 0.6, MR.branco, x, base + 0.4, 1.4)); }
  ent.add(caixa(3.2, 0.3, 1.9, MR.branco, 0, base + 4.0, 0.75));
  ent.add(caixa(3.4, 0.12, 2.1, MR.preto, 0, base + 4.2, 0.75));
  ent.add(caixa(3.5, 0.2, 2.2, snowMat, 0, base + 4.32, 0.75));
  ent.add(caixa(2.8, 0.2, 2.0, MR.calcada, 0, base + 0.1, 1.0));
  if (it.guirlanda) { const gl = guirlandaR(0.4); gl.position.set(0, base + 2.4, 0.2); ent.add(gl); }
  if (leds) ledsLinha(ent, V3(-1.6, base + 4.05, 1.75), V3(1.6, base + 4.05, 1.75), 16);
  // garagem (nível 2+) e segundo andar com varanda (nível 3)
  let bloco = null, fr2 = null;
  if (nv >= 2) {
    bloco = new THREE.Group(); casa.add(bloco);
    const doisAndares = nv >= 3, H = doisAndares ? 7.0 : 4.4, W = doisAndares ? 9.6 : 6.4;
    bloco.position.set(doisAndares ? 2.2 * s : 2.6 * s, 0, doisAndares ? -0.6 : -0.4);
    bloco.add(caixa(W, H, doisAndares ? 8.4 : 7.4, reboco, 0, base + H / 2, 0));
    const dz = doisAndares ? 4.2 : 3.7;
    const gx = doisAndares ? 2.3 * s : 0.6 * s;
    const gar = new THREE.Group(); gar.position.set(gx, 0, dz + 0.01); bloco.add(gar);
    gar.add(caixa(4.6, 2.9, 0.12, MR.garagem, 0, base + 1.45, 0));
    for (let i = 1; i < 5; i++) gar.add(caixa(4.6, 0.03, 0.14, MR.preto, 0, base + i * 0.58, 0.02));
    gar.add(caixa(5.1, 0.25, 0.3, MR.branco, 0, base + 3.05, 0.1));
    for (const x of [-2.55, 2.55]) gar.add(caixa(0.4, 3.2, 0.4, MR.branco, x, base + 1.6, 0.1));
    const lant = lanternaR(); lant.position.set(-2.95, base + 2.3, 0.1); gar.add(lant);
    const lant2 = lanternaR(); lant2.position.set(2.95, base + 2.3, 0.1); gar.add(lant2);
    if (leds) ledsLinha(gar, V3(-2.5, base + 3.22, 0.3), V3(2.5, base + 3.22, 0.3), 26);
    const tx = telhadoXR({ w: W, d: doisAndares ? 8.4 : 7.4, h: doisAndares ? 2.2 : 1.8, parede, telha }); tx.position.y = base + H; bloco.add(tx);
    if (doisAndares) {
      bloco.add(caixa(W + 0.2, 0.2, 8.6, MR.branco, 0, 3.9, 0));
      fr2 = frontaoR({ w: 5.2, d: 3, h: 2.4, parede, telha }); fr2.position.set(gx, base + H, 3.0); bloco.add(fr2);
      if (leds) ledsFrontao(bloco, fr2);
      // varanda com grade de ferro sobre a garagem
      const va = new THREE.Group(); va.position.set(gx, 4.0, dz); bloco.add(va);
      va.add(caixa(5.4, 0.2, 1.4, MR.branco, 0, 0, 0.5));
      va.add(caixa(5.5, 0.12, 1.5, snowMat, 0, 0.14, 0.5));
      const barras = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.9, 0.03), MR.preto, 40), m4 = new THREE.Matrix4();
      for (let i = 0; i < 40; i++) { m4.makeTranslation(-2.6 + i * 0.133, 0.55, 1.15); barras.setMatrixAt(i, m4); }
      va.add(barras);
      va.add(caixa(5.4, 0.06, 0.06, MR.preto, 0, 1.0, 1.15));
      const pf = janelaR(2.4, 2.1, 4, 3); pf.position.set(0, 1.15, 0.02); va.add(pf);
      if (leds && it.pisca >= 2) ledsLinha(va, V3(-2.7, 1.06, 1.2), V3(2.7, 1.06, 1.2), 30, bulbMat);
      for (const x of [-2.8 * s, -0.8 * s]) { const j = janelaR(1.1, 1.6, 2, 2); j.position.set(x, 5.6, dz + 0.02); bloco.add(j); janelas.push([bloco, x, 4.8, dz + 0.02]); }
    }
  }
  if (leds && it.pisca >= 2) { // contorno das janelas da ala em colorido
    for (const [alvo, x, y, z] of janelas) { ledsLinha(alvo, V3(x - 0.7, y + 2.75, z + 0.18), V3(x + 0.7, y + 2.75, z + 0.18), 8, bulbMat); }
  }
  if (it.velas) for (const [alvo, x, y, z] of janelas) { const c = candle(); c.scale.setScalar(1.6); c.position.set(x, y - 0.05, z + 0.32); alvo.add(c); }
  // chaminé
  const chX = alaX - 1.6 * s * (nv === 1 ? -1 : 1);
  casa.add(caixa(0.8, 2.6, 0.8, MR.branco, chX, base + 6.9, -2.2));
  casa.add(caixa(1.0, 0.25, 1.0, MR.preto, chX, base + 8.3, -2.2));
  // base, caminho e jardim (lote vai até z = +9.5 nas unidades da casa)
  casa.add(caixa(nv === 1 ? 7.0 : 14.6, 0.35, 9.2, MR.calcada, nv === 1 ? 0 : 0.6 * s * (nv === 2 ? -1.2 : 1), 0.17, 0));
  const xPorta = ent.position.x;
  casa.add(caixa(2.0, 0.08, 5.0, MR.pedra, xPorta, 0.04, 7.2));
  if (nv >= 2) { const pc = caixa(5.2, 0.06, 5.2, MR.pedra, bloco.position.x + (nv >= 3 ? 2.3 * s : 0.6 * s), 0.03, 7.0); casa.add(pc); }
  const lant3 = lanternaR(); lant3.position.set(xPorta - 1.0, base + 2.6, ent.position.z + 0.06); casa.add(lant3);
  const lant4 = lanternaR(); lant4.position.set(xPorta + 1.0, base + 2.6, ent.position.z + 0.06); casa.add(lant4);
  // arbustos sempre (bordinha baixa); o jardim de inverno acrescenta topiarias, ciprestes, postes e o carro
  const xs = []; for (let x = -7; x <= 7; x += 1.2) if (Math.abs(x - xPorta) > 1.4 && (nv < 2 || Math.abs(x - (bloco.position.x + (nv >= 3 ? 2.3 * s : 0.6 * s))) > 2.8)) xs.push(x);
  for (const x of xs) { if (nv === 1 && Math.abs(x) > 3.6) continue; const b = arbustoR(R(0.45, 0.6)); b.position.set(x, 0.5, 5.4); casa.add(b); const n = arbustoR(0.35, snowMat); n.scale.y = 0.35; n.position.set(x, 0.95, 5.4); casa.add(n); }
  if (it.jardim) {
    for (const dx of [-1.6, 1.6]) { const c = conePinheiro(0.6, 2.8); c.position.set(xPorta + dx, 0, 6.2); casa.add(c); const n = conePinheiro(0.22, 0.6, snowMat); n.position.set(xPorta + dx, 2.3, 6.2); casa.add(n); }
    for (const dx of [-1.3, 1.3]) { const pj = posteJardim(); pj.position.set(xPorta + dx, 0, 8.6); casa.add(pj); }
    if (it.jardim >= 2) {
      const ci = new THREE.Group(); ci.position.set(-6.6 * s, 0, 3); casa.add(ci);
      ci.add(mR(new THREE.CylinderGeometry(0.12, 0.15, 0.8, 8), mat(0x4a3322), 0, 0.4, 0));
      const cc = conePinheiro(1.2, 8); cc.position.y = 4.4; ci.add(cc);
      if (nv >= 2) { const car = carroEsportivo([0xc0182c, 0x1d3a6e, 0x202226, 0xe8e8ea][hv % 4]); car.position.set(bloco.position.x + (nv >= 3 ? 2.3 * s : 0.6 * s), 0.05, 7.4); car.rotation.y = Math.PI / 2 + (s > 0 ? 0 : Math.PI); casa.add(car); }
    }
  }
  casa.scale.setScalar(0.5); casa.position.z = -1.0;
  const g = new THREE.Group(); g.add(casa);
  fundir(casa);
  addPool(g, xPorta * 0.5, 2.6, 5);
  g.userData.smoke = [V3(chX * 0.5, (base + 8.6) * 0.5, -2.2 * 0.5 - 1.0)];
  g.userData.altura = nv >= 3 ? 6.4 : 5;
  return g;
}

// ---------- modelos 3D prontos (.glb) ----------
// Carregam em segundo plano; enquanto não chegam, o prédio usa o modelo feito por código.
// Cada modelo pronto é preparado uma vez (medidas, janelas, beirais, telhado) e depois
// clonado por prédio, dividindo geometria e materiais.
const PRONTOS = {};
let aoCarregarPronto = () => {};
function carregarPronto(nome, url, preparar) {
  const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder);
  l.load(url, (g) => { try { PRONTOS[nome] = preparar(g.scene); aoCarregarPronto(nome); } catch (e) { console.warn('modelo pronto', nome, e); } }, undefined, (e) => console.warn('modelo pronto', nome, e));
}
// posições de uma malha em Float32, já no espaço da raiz do modelo (os .glb vêm quantizados)
function posicoesEm(raiz, m) {
  const g = m.geometry, pos = g.attributes.position, idx = g.index, v = new THREE.Vector3(), out = [];
  m.updateWorldMatrix(true, false);
  const mt = new THREE.Matrix4().copy(raiz.matrixWorld).invert().multiply(m.matrixWorld);
  const n = idx ? idx.count : pos.count;
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mt); out.push(v.x, v.y, v.z); }
  return out; // triângulos soltos (3 vértices cada)
}
const LUZ_JANELA = new THREE.MeshStandardMaterial({ color: 0x2b2116, emissive: 0xffb45e, emissiveIntensity: 0.85, roughness: 0.25, metalness: 0.2 });
LUZ_JANELA.userData.compartilhado = true;

function prepararCasa3(cena) {
  const raiz = new THREE.Group(); raiz.add(cena); raiz.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(cena), c = box.getCenter(new THREE.Vector3());
  cena.position.set(-c.x, -box.min.y, -c.z); raiz.updateMatrixWorld(true);
  const tam = box.getSize(new THREE.Vector3());
  let telhado = null; const vidros = [];
  cena.traverse(o => {
    if (!o.isMesh) return;
    o.geometry.userData.compartilhado = true;
    const m = o.material; m.userData.compartilhado = true;
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) if (m[k]) m[k].userData.compartilhado = true;
    if (/vidro/i.test(m.name)) { o.material = LUZ_JANELA; vidros.push(o); }
    if (/roof/i.test(m.name)) telhado = o;
  });
  // neve: os triângulos do telhado virados pra cima, levantados um pouco
  const tri = telhado ? posicoesEm(raiz, telhado) : [];
  const neve = [], a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (let i = 0; i < tri.length; i += 9) {
    a.set(tri[i], tri[i + 1], tri[i + 2]); b.set(tri[i + 3], tri[i + 4], tri[i + 5]); d.set(tri[i + 6], tri[i + 7], tri[i + 8]);
    nrm.subVectors(b, a).cross(d.clone().sub(a)).normalize();
    if (nrm.y < 0.35) continue;
    for (const p of [a, b, d]) neve.push(p.x + nrm.x * 0.12, p.y + nrm.y * 0.12, p.z + nrm.z * 0.12);
  }
  const neveGeo = new THREE.BufferGeometry(); neveGeo.setAttribute('position', new THREE.Float32BufferAttribute(neve, 3)); neveGeo.computeVertexNormals(); neveGeo.userData.compartilhado = true;
  // beirais: arestas de borda do telhado, horizontais, com o resto do triângulo acima
  const chave = (x, y, z) => `${Math.round(x * 50)},${Math.round(y * 50)},${Math.round(z * 50)}`;
  const arestas = new Map();
  for (let i = 0; i < tri.length; i += 9) {
    const vs = [0, 1, 2].map(k => [tri[i + k * 3], tri[i + k * 3 + 1], tri[i + k * 3 + 2]]);
    for (let k = 0; k < 3; k++) {
      const p = vs[k], q = vs[(k + 1) % 3], r = vs[(k + 2) % 3];
      const kp = chave(...p), kq = chave(...q), ch = kp < kq ? kp + '|' + kq : kq + '|' + kp;
      const e = arestas.get(ch); if (e) e.n++; else arestas.set(ch, { n: 1, p, q, r });
    }
  }
  const beirais = [];
  for (const { n, p, q, r } of arestas.values()) {
    if (n !== 1) continue;
    const comp = Math.hypot(q[0] - p[0], q[2] - p[2]);
    if (comp < 0.4 || Math.abs(q[1] - p[1]) > 0.05 * comp) continue;
    if (r[1] < Math.max(p[1], q[1]) + 0.05) continue; // cumeeira, não beiral
    beirais.push([new THREE.Vector3(...p), new THREE.Vector3(...q)]);
  }
  // janelas: grupos de vidro virados pra frente (+z); a porta é o mais baixo e alto
  const paineis = [];
  for (const o of vidros) {
    const t = posicoesEm(raiz, o);
    for (let i = 0; i < t.length; i += 9) {
      a.set(t[i], t[i + 1], t[i + 2]); b.set(t[i + 3], t[i + 4], t[i + 5]); d.set(t[i + 6], t[i + 7], t[i + 8]);
      nrm.subVectors(b, a).cross(d.clone().sub(a)).normalize();
      if (Math.abs(nrm.z) < 0.8) continue;
      const bb = new THREE.Box3().setFromPoints([a, b, d]);
      const junto = paineis.find(x => x.box.clone().expandByScalar(0.35).intersectsBox(bb));
      if (junto) junto.box.union(bb); else paineis.push({ box: bb });
    }
  }
  for (let mudou = true; mudou;) { mudou = false; for (let i = 0; i < paineis.length && !mudou; i++) for (let j = i + 1; j < paineis.length; j++) if (paineis[i].box.clone().expandByScalar(0.35).intersectsBox(paineis[j].box)) { paineis[i].box.union(paineis[j].box); paineis.splice(j, 1); mudou = true; break; } }
  const frente = paineis.filter(x => x.box.max.z > tam.z * 0.1);
  frente.sort((x, y) => x.box.min.y - y.box.min.y || (y.box.max.y - y.box.min.y) - (x.box.max.y - x.box.min.y));
  const porta = frente.length && frente[0].box.min.y < tam.y * 0.25 ? frente.shift() : null;
  // ponto alto do telhado pra chaminé (raio de cima pra baixo, um pouco atrás da cumeeira)
  const ray = new THREE.Raycaster(), alvos = telhado ? [telhado] : [];
  let chamine = null;
  for (let x = -tam.x * 0.3; x <= tam.x * 0.1 && telhado; x += tam.x * 0.05) for (let z = -tam.z * 0.35; z <= 0; z += tam.z * 0.05) {
    ray.set(V3(x, 50, z).applyMatrix4(raiz.matrixWorld), V3(0, -1, 0)); const h = ray.intersectObjects(alvos, false)[0];
    if (h) { const y = raiz.worldToLocal(h.point.clone()).y; if (!chamine || y > chamine.y + 0.3) chamine = V3(x, y, z); }
  }
  if (chamine) { // desce do pico pra ficar encostada no telhado
    chamine.z -= tam.z * 0.12; ray.set(V3(chamine.x, 50, chamine.z).applyMatrix4(raiz.matrixWorld), V3(0, -1, 0));
    const h = ray.intersectObjects(alvos, false)[0]; if (h) chamine.y = raiz.worldToLocal(h.point.clone()).y;
  }
  return { cena, tam, neveGeo, beirais, janelas: frente.map(x => x.box), porta: porta && porta.box, chamine };
}
carregarPronto('casa3', '/assets/modelos/casa3.glb', prepararCasa3);

// Casa nível 3 com o modelo pronto ("American House", AleixoAlonso, CC BY 4.0) e os enfeites
// de fachada do jogo presos no próprio modelo.
function makeCasaPronta(p = {}) {
  const P = PRONTOS.casa3, it = p.itens || {}, hv = hashId(p.id || 'vitrine');
  const k = 7.4 / P.tam.x, espelho = (hv >> 3) % 2 ? -1 : 1;
  const g = new THREE.Group(), casa = new THREE.Group(); g.add(casa);
  casa.scale.set(k * espelho, k, k); casa.position.z = -0.3;
  casa.add(P.cena.clone());
  const neve = new THREE.Mesh(P.neveGeo, snowMat); neve.userData.noShadow = true; casa.add(neve);
  const W = (v) => V3(v.x * k * espelho, v.y * k, v.z * k - 0.3); // modelo → prédio
  // chaminé de tijolo
  if (P.chamine) {
    const ch = W(P.chamine), alt = 1.25;
    g.add(caixa(0.45, alt, 0.45, tijolo, ch.x, ch.y + alt / 2 - 0.35, ch.z));
    g.add(caixa(0.58, 0.1, 0.58, MR.preto, ch.x, ch.y + alt - 0.3, ch.z));
    g.userData.smoke = [V3(ch.x, ch.y + alt - 0.2, ch.z)];
  }
  // pisca-pisca nos beirais: 1 = só os da frente, quente; 2 = todos, colorido
  if (it.pisca) {
    const pts = [];
    for (const [a, b] of P.beirais) {
      const A = W(a), B = W(b), meio = A.clone().add(B).multiplyScalar(0.5);
      if (it.pisca < 2 && meio.z < 0.2) continue;
      const n = Math.max(2, Math.round(A.distanceTo(B) / 0.28));
      for (let i = 0; i <= n; i++) pts.push(A.clone().lerp(B, i / n).add(V3(0, -0.05, 0)));
    }
    const colorido = it.pisca >= 2, im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.055, 6, 4), colorido ? bulbMat : ledQuente, pts.length), m4 = new THREE.Matrix4();
    const CORES = [0xff3b3b, 0x3bff6a, 0x3b8bff, 0xffd23b, 0xff7bf0];
    pts.forEach((q, i) => { m4.makeTranslation(q.x, q.y, q.z); im.setMatrixAt(i, m4); if (colorido) im.setColorAt(i, new THREE.Color(CORES[i % CORES.length]).multiplyScalar(2.2)); });
    im.userData.noShadow = true; g.add(im);
  }
  if (it.guirlanda && P.porta) { const c = W(P.porta.getCenter(V3())), gl = guirlandaR(0.24); gl.position.set(c.x, W(P.porta.max).y + 0.12, W(P.porta.max).z + 0.06); g.add(gl); }
  if (it.velas) for (const bx of P.janelas) { const c = W(bx.getCenter(V3())), v = candle(); v.scale.setScalar(0.9); v.position.set(c.x, W(bx.min).y + 0.02, W(bx.max).z + 0.05); g.add(v); }
  // jardim: arbustos com neve na frente; nível 2 do jardim põe pinheiros, postes e o carro
  const frenteZ = P.tam.z / 2 * k - 0.3, portaX = P.porta ? W(P.porta.getCenter(V3())).x : 0;
  for (let x = -3.4; x <= 3.4; x += 0.6) {
    if (Math.abs(x - portaX) < 0.9 || x * espelho > 0.6) continue; // não tampa a porta nem a garagem
    const b = arbustoR(0.26); b.position.set(x, 0.25, frenteZ + 0.35); g.add(b);
    const n = arbustoR(0.18, snowMat); n.scale.y = 0.35; n.position.set(x, 0.47, frenteZ + 0.35); g.add(n);
  }
  if (it.jardim) {
    for (const dx of [-0.9, 0.9]) { const pj = posteJardim(); pj.scale.setScalar(0.6); pj.position.set(portaX + dx, 0, frenteZ + 1.0); g.add(pj); }
    if (it.jardim >= 2) {
      for (const x of [-3.5 * espelho]) { const c = conePinheiro(0.45, 2.4); c.position.set(x, 0, frenteZ - 0.4); g.add(c); }
      const car = carroEsportivo([0xc0182c, 0x1d3a6e, 0x202226, 0xe8e8ea][hv % 4]); car.scale.setScalar(0.3); car.position.set(1.9 * espelho, 0.03, frenteZ + 1.1); car.rotation.y = Math.PI / 2; g.add(car);
    }
  }
  addPool(g, portaX, frenteZ + 0.6, 2.5);
  g.userData.altura = P.tam.y * k + 1.2;
  return g;
}

// Junta as malhas estáticas de um grupo por material (menos chamadas de desenho no celular).
// Instâncias (LEDs, grades) ficam como estão.
function fundir(grupo) {
  grupo.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(grupo.matrixWorld).invert(), porMat = new Map(), remover = [];
  grupo.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh) return;
    const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    geo.clearGroups();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!porMat.has(o.material)) porMat.set(o.material, []);
    porMat.get(o.material).push(geo);
    remover.push(o);
  });
  for (const o of remover) { o.parent.remove(o); o.geometry.dispose(); }
  const vazios = []; grupo.traverse(o => { if (o !== grupo && o.isGroup && !o.children.length) vazios.push(o); });
  for (const o of vazios) o.parent && o.parent.remove(o);
  for (const [m, geos] of porMat) {
    const junto = mergeGeometries(geos, false); geos.forEach(g => g.dispose());
    if (!junto) continue;
    const mm = new THREE.Mesh(junto, m); mm.castShadow = true; mm.receiveShadow = true;
    if (m === MR.lampada || m === MR.vidro) mm.castShadow = false;
    grupo.add(mm);
  }
}


// Junta as peças paradas de um prédio que têm material equivalente (mesma cor, textura,
// acabamento...), pra placa de vídeo desenhar poucas peças por prédio. Não mexe em nada
// citado no userData (partes animadas como a roda-gigante, a estrela, o guindaste) nem
// em peças com cor por vértice ou instanciadas.
const texChave = (t) => t ? [t.source.uuid, t.repeat.x, t.repeat.y, t.offset.x, t.offset.y, t.rotation, t.wrapS, t.wrapT].join(',') : '';
function assinatura(m) {
  const cor = (c) => c ? [c.r, c.g, c.b].map(x => x.toFixed(3)).join(',') : '';
  return [m.type, cor(m.color), cor(m.emissive), m.emissiveIntensity, m.roughness, m.metalness,
    texChave(m.map), texChave(m.emissiveMap), texChave(m.normalMap), m.transparent, m.opacity, m.side,
    m.flatShading, m.depthWrite, m.alphaTest, m.toneMapped, m.envMapIntensity].join('|');
}
function otimizar(raiz) {
  const protegidos = new Set();
  const marcar = (x, fundo = 0) => {
    if (!x || typeof x !== 'object' || fundo > 3) return;
    if (x.isObject3D) { x.traverse(o => protegidos.add(o)); return; }
    if (x.isMaterial) { protegidos.add(x); return; }
    for (const k of Object.keys(x)) marcar(x[k], fundo + 1);
  };
  raiz.traverse(o => { for (const [k, val] of Object.entries(o.userData)) if (k !== 'noShadow') marcar(val); });
  raiz.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(raiz.matrixWorld).invert(), grupos = new Map(), remover = [];
  raiz.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || protegidos.has(o) || Array.isArray(o.material)) return;
    const m = o.material;
    if (m.vertexColors || o.geometry.morphAttributes.position || !o.geometry.attributes.position) return;
    const chave = (protegidos.has(m) ? m.uuid : assinatura(m)) + '|' + !!o.userData.noShadow + '|' + o.castShadow;
    if (!grupos.has(chave)) grupos.set(chave, { m, noShadow: !!o.userData.noShadow, cast: o.castShadow, lista: [] });
    grupos.get(chave).lista.push(o);
  });
  for (const g of grupos.values()) {
    if (g.lista.length < 2) continue;
    const geos = g.lista.map(o => {
      const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      geo.clearGroups();
      geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      return geo;
    });
    const junto = mergeGeometries(geos, false); geos.forEach(x => x.dispose());
    if (!junto) continue;
    const mm = new THREE.Mesh(junto, g.m); mm.castShadow = g.cast; mm.receiveShadow = true; if (g.noShadow) mm.userData.noShadow = true;
    raiz.add(mm);
    remover.push(...g.lista);
  }
  // as peças antigas saem; geometria só é liberada se não for compartilhada com outros modelos
  for (const o of remover) { o.parent.remove(o); if (!o.geometry.userData.compartilhado) o.geometry.dispose(); }
  return raiz;
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

// Cone com contorno de galhos (pontas irregulares e borda caída), pra pinheiros realistas.
function coneGalhos(r, h, segs = 14, seed = 0) {
  const geo = new THREE.ConeGeometry(r, h, segs * 2, 3), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ang = Math.atan2(z, x), baixo = (h / 2 - y) / h;
    const ponta = (Math.round((ang + Math.PI) / (Math.PI * 2) * segs * 2) % 2 === 0) ? 1.12 : 0.9;
    const k = (ponta + Math.sin(ang * 5 + seed) * 0.05) * (0.85 + 0.15 * baixo);
    p.setXYZ(i, x * k, y - (baixo > 0.95 && ponta > 1 ? h * 0.06 : 0), z * k);
  }
  geo.computeVertexNormals();
  return geo;
}
// Pinheiros de verdade (sem bolas): clássico, abeto (alto e fino) e espruce azul.
// Aceitam pisca-pisca: nível 1 branco quente, nível 2 colorido.
const PINHEIROS = {
  pinheiro: { h: 6.2, r: 2.2, tiers: 5, cores: [0x1d4a3a, 0x22573f, 0x286347] },
  abeto: { h: 7.6, r: 1.5, tiers: 7, cores: [0x183f30, 0x1d4a39, 0x235442] },
  espruce: { h: 6.6, r: 2.0, tiers: 6, cores: [0x36615f, 0x3d6d6b, 0x467a79] },
};
const ledQuente = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.0, 1.15), toneMapped: false });
function makePinheiroReal(tipo = 'pinheiro', it = {}, s = 1) {
  const c = PINHEIROS[tipo] || PINHEIROS.pinheiro, g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.22, 0.32, 1.3, 7), mat(0x5a3a26), 0, 0.65, 0));
  const topoTronco = 0.9, H = c.h - topoTronco;
  for (let i = 0; i < c.tiers; i++) {
    const t = i / c.tiers, r = c.r * (1 - t * 0.85), th = H / c.tiers * 1.75, y = topoTronco + t * (H - th * 0.55) + th / 2;
    g.add(mesh(coneGalhos(r, th, 9 + (i % 3), i * 1.7), mat(c.cores[i % 3], { roughness: 0.92 }), 0, y, 0));
    const ch = th * 0.42;
    g.add(mesh(coneGalhos(r * 0.42 * 1.04, ch, 9, i), snowMat, 0, y + th / 2 - ch / 2 + 0.02, 0));
  }
  const n = it.luzes ? (tipo === 'abeto' ? 56 : 48) : 0;
  if (n) {
    const colorido = it.luzes >= 2, im = new THREE.InstancedMesh(bulbGeo, colorido ? bulbMat : ledQuente, n), m4 = new THREE.Matrix4(), cor = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const t = i / n, y = topoTronco + 0.3 + t * (H - 0.7), env = c.r * (1 - (y - topoTronco) / H) * 0.95 + 0.12, a = t * Math.PI * 2 * 5;
      m4.makeTranslation(Math.cos(a) * env, y, Math.sin(a) * env); im.setMatrixAt(i, m4);
      if (colorido) im.setColorAt(i, cor.setRGB(...BULBS[i % 5]));
    }
    im.userData.noShadow = true; g.add(im);
  }
  g.scale.setScalar(s);
  g.userData.altura = c.h * s;
  return g;
}
function makePine(s = 1) { return makePinheiroReal('pinheiro', {}, s); }

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

// Árvore da praça: começa só verde (com neve) e ganha os enfeites comprados.
function makeTree(it = {}) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.5, 0.6, 1.4, 10), mat(0x5a3a26), 0, 0.7, 0));
  const tiers = [];
  for (let i = 0; i < 5; i++) {
    const r = 4.3 - i * 0.82, h = 3.3 - i * 0.18, y = 1.1 + i * 1.75 + h / 2;
    tiers.push({ r, h, base: y - h / 2 });
    g.add(mesh(coneGalhos(r, h, 12, i), mat([0x1a4d36, 0x1e5a3e, 0x226446, 0x266e4c, 0x2b7853][i], { roughness: 0.9 }), 0, y, 0));
    const ch = h * 0.32; g.add(mesh(new THREE.ConeGeometry(r * 0.32 * 1.05, ch, 14), snowMat, 0, y + h / 2 - ch / 2 + 0.02, 0));
  }
  const radiusAt = y => { let best = 0; for (const t of tiers) if (y >= t.base && y <= t.base + t.h) best = Math.max(best, t.r * (1 - (y - t.base) / t.h)); return best; };
  const top = tiers[4].base + tiers[4].h;
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  const det = mulberry32(5), Rd = (a, b) => a + (b - a) * det();
  const nB = [0, 70, 130, 190][it.luzes || 0];
  if (nB) {
    const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, nB);
    const voltas = 6.5 * nB / 190;
    for (let i = 0; i < nB; i++) { const t = i / nB, y = 1.3 + t * (top - 1.8), a = t * Math.PI * 2 * Math.max(3, voltas), r = radiusAt(y) + 0.12; m4.makeTranslation(Math.cos(a) * r, y, Math.sin(a) * r); bulbs.setMatrixAt(i, m4); bulbs.setColorAt(i, col.setRGB(...((it.luzes || 0) >= 3 ? BULBS[i % 5] : (i % 3 === 0 ? [5, 3.6, 1.2] : [4.6, 3.0, 1.0])))); }
    bulbs.userData.noShadow = true; g.add(bulbs);
  }
  const nO = [0, 16, 32, 46][it.bolas || 0];
  if (nO) {
    const orn = new THREE.InstancedMesh(new THREE.SphereGeometry(0.24, 14, 10), new THREE.MeshStandardMaterial({ roughness: 0.18, metalness: 0.55 }), nO);
    const oc = [0xd8333a, 0xffc94d, 0x4f7fe0, 0xe8e8f0, 0xd8333a];
    for (let i = 0; i < nO; i++) { const y = Rd(1.6, top - 1.2), a = Rd(0, Math.PI * 2), r = radiusAt(y) + 0.05; m4.makeTranslation(Math.cos(a) * r, y - 0.15, Math.sin(a) * r); orn.setMatrixAt(i, m4); orn.setColorAt(i, col.set(oc[i % 5])); }
    g.add(orn);
  }
  for (let k = 0; k < (it.festao || 0); k++) {
    const pts = [];
    for (let i = 0; i <= 120; i++) { const t = i / 120, y = 1.6 + t * (top - 2.6), a = t * Math.PI * 2 * 4 + k * Math.PI, r = radiusAt(y) + 0.18; pts.push(V3(Math.cos(a) * r, y, Math.sin(a) * r)); }
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 240, 0.09, 6), new THREE.MeshStandardMaterial({ color: k ? 0xd8333a : 0xffcf5a, metalness: 0.7, roughness: 0.3, emissive: k ? 0x300000 : 0x3a2600 })));
  }
  if (it.estrela) {
    const st = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.42 : 1.0; i ? st.lineTo(Math.cos(a) * r, Math.sin(a) * r) : st.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    const starGeo = new THREE.ExtrudeGeometry(st, { depth: 0.25, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 2 }); starGeo.center();
    const star = mesh(starGeo, new THREE.MeshStandardMaterial({ color: 0xffd76a, emissive: 0xffb830, emissiveIntensity: 3, metalness: 0.4, roughness: 0.3 }), 0, top + 0.55, 0);
    g.add(star); g.userData.star = star;
  } else {
    g.add(mesh(new THREE.ConeGeometry(0.12, 0.6, 8), mat(0x2b7853), 0, top + 0.2, 0));
  }
  const gc = [[0xd8333a, 0xffd166], [0x2f9e5b, 0xffffff], [0x4f7fe0, 0xffd166], [0xf2a93b, 0xd8333a], [0xe8e8f0, 0xd8333a], [0x9b59d0, 0xffd166], [0xd8333a, 0xffffff], [0x2f9e5b, 0xffd166], [0xffc94d, 0xd8333a]];
  const nG = [0, 3, 6, 9][it.presentes || 0];
  for (let i = 0; i < nG; i++) { const [c, r] = gc[i], a = i / 9 * Math.PI * 2 + 0.3, gf = makeGift(Rd(0.6, 1.1), c, r); gf.position.set(Math.cos(a) * 4.6, 0.08, Math.sin(a) * 4.6); gf.rotation.y = Rd(0, 2); g.add(gf); }
  return g;
}

function makePlaza(p = {}) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(4.8, 4.8, 0.12, 48), new THREE.MeshStandardMaterial({ map: cobbleTex, roughness: 0.9 }), 0, 0.06, 0));
  const rim = mesh(new THREE.TorusGeometry(4.95, 0.32, 10, 64), snowMat, 0, 0.12, 0); rim.rotation.x = Math.PI / 2; rim.scale.z = 0.5; g.add(rim);
  const tree = makeTree(p.itens || {}); tree.scale.setScalar(0.66); g.add(tree);
  g.userData.star = tree.userData.star;
  for (const [x, z, r] of [[-3.6, -3.6, Math.PI / 4], [3.6, -3.6, -Math.PI / 4]]) { const b = makeBench(); b.position.set(x, 0, z); b.rotation.y = r + Math.PI; b.scale.setScalar(0.8); g.add(b); }
  const it = p.itens || {};
  g.userData.brilho = (it.luzes || 0) * 35 + (it.estrela ? 45 : 0) + (it.festao || 0) * 8;
  g.userData.altura = 9;
  return g;
}

// ---------- construções do nível 4 ao 20 (mesmo estilo realista natalino) ----------
const _placas = new Map();
function placaTexto(texto, fundo = '#fff4dc', cor = '#9e1f28') {
  const k = texto + fundo + cor;
  if (!_placas.has(k)) {
    const t = tex(1024, 200, (g, w, h) => {
      g.fillStyle = fundo; g.fillRect(0, 0, w, h);
      g.strokeStyle = cor; g.lineWidth = 12; g.strokeRect(12, 12, w - 24, h - 24);
      g.fillStyle = cor; g.textAlign = 'center'; g.textBaseline = 'middle';
      let tam = 104; g.font = `700 ${tam}px Fredoka, Nunito, sans-serif`;
      while (g.measureText(texto).width > w - 80 && tam > 40) { tam -= 6; g.font = `700 ${tam}px Fredoka, Nunito, sans-serif`; }
      g.fillText(texto, w / 2, h / 2 + 6);
    });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.userData.compartilhado = true;
    _placas.set(k, new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.4, roughness: 0.6 }));
  }
  return _placas.get(k);
}
function placa(pai, texto, w, x, y, z, fundo, cor) {
  pai.add(caixa(w + 0.3, w * 0.24, 0.18, MR.preto, x, y, z));
  pai.add(mR(new THREE.PlaneGeometry(w, w * 0.195), placaTexto(texto, fundo, cor), x, y, z + 0.1));
}
const _toldos = new Map();
function toldoMat(c1, c2) {
  const k = c1 + c2;
  if (!_toldos.has(k)) { const t = tex(128, 32, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? c2 : c1; g.fillRect(i * 16, 0, 16, h); } }); t.userData.compartilhado = true; _toldos.set(k, new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, side: THREE.DoubleSide })); }
  return _toldos.get(k);
}
function toldo(pai, w, x, y, z, c1 = '#c8202a', c2 = '#f6f2ec') {
  const t = mR(new THREE.PlaneGeometry(w, 1.1), toldoMat(c1, c2), x, y, z + 0.45); t.rotation.x = -0.9; pai.add(t);
  pai.add(caixa(w, 0.18, 0.12, snowMat, x, y + 0.42, z + 0.12));
}
const tintas = { creme: 0xefe4d2, branco: 0xf4f3ef, cinza: 0xe2e7ec, rosa: 0xf3d9d6, verde: 0xdfe8dc, azul: 0xdbe6f1, vermelho: 0xa53a32 };
const paredeDe = (cor) => deCor(matReboco, cor, () => new THREE.MeshStandardMaterial({ map: rep(rebocoTex, 2, 2), color: cor, roughness: 0.9 }));
const telhaDe = (cor) => deCor(matTelha, cor, () => new THREE.MeshStandardMaterial({ map: rep(telhaTex, 2, 2), color: cor, roughness: 0.8 }));
const tijolo = new THREE.MeshStandardMaterial({ map: rep(brickTex, 3, 2), roughness: 0.9 });

// prédio comercial de 1 ou 2 andares: vitrine grande, toldo listrado, placa, frontão
function predioComercial({ w, d, H, cor, telhado = 0x4a4d55, nome, toldo1, toldo2, andares = 1, paredeMat }) {
  const g = new THREE.Group(), parede = paredeMat || paredeDe(cor), telha = telhaDe(telhado), base = 0.3;
  g.add(caixa(w + 0.4, base, d + 0.4, MR.calcada, 0, base / 2, 0));
  g.add(caixa(w, H, d, parede, 0, base + H / 2, 0));
  const fr = frontaoR({ w, d, h: Math.min(2.6, w * 0.32), parede, telha }); fr.position.y = base + H; g.add(fr);
  const zf = d / 2 + 0.01;
  const vit = janelaR(w * 0.62, 2.2, 4, 2); vit.position.set(-w * 0.12, base + 1.5, zf); g.add(vit);
  const porta = janelaR(1.2, 2.5, 1, 3); porta.position.set(w * 0.33, base + 1.35, zf); g.add(porta);
  toldo(g, w * 0.95, 0, base + 2.7, zf, toldo1, toldo2);
  if (andares >= 2) for (const x of [-w * 0.3, 0, w * 0.3]) { const j = janelaR(1.0, 1.4, 2, 2); j.position.set(x, base + H - 1.4, zf); g.add(j); }
  placa(g, nome, Math.min(w * 0.8, 6), 0, base + (andares >= 2 ? H - 2.9 : H - 0.2), zf + 0.1);
  for (const x of [-w / 2 - 0.15, w / 2 + 0.15]) { const l = lanternaR(); l.position.set(x, base + 2.4, zf - 0.1); g.add(l); }
  ledsFrontao(g, fr);
  g.userData.zf = zf; g.userData.H = H + base;
  return g;
}
function finalizar(g, altura, chamines = []) { fundir(g); const out = new THREE.Group(); out.add(g); out.userData.altura = altura; out.userData.smoke = chamines; return out; }

function makeCorreio() {
  const g = predioComercial({ w: 6.4, d: 5.2, H: 3.6, cor: tintas.vermelho, telhado: 0x2f3a34, nome: 'Correio do Papai Noel', toldo1: '#1f6a43', toldo2: '#f6f2ec', paredeMat: tijolo });
  const caixaC = new THREE.Group(); caixaC.position.set(-2.4, 0.3, 3.4); g.add(caixaC);
  caixaC.add(caixa(0.7, 1.1, 0.6, mat(0xc8202a, { roughness: 0.4 }), 0, 0.85, 0));
  caixaC.add(mR(new THREE.CylinderGeometry(0.35, 0.35, 0.6, 12, 1, false, 0, Math.PI), mat(0xc8202a, { roughness: 0.4 }), 0, 1.4, 0).rotateZ(Math.PI / 2).rotateY(Math.PI / 2));
  caixaC.add(caixa(0.5, 0.06, 0.62, MR.preto, 0, 1.15, 0));
  for (let i = 0; i < 6; i++) { const c = caixa(0.5, 0.35, 0.05, mat(0xf6f1e4), 1.6 + R(-0.6, 0.6), 0.5 + i * 0.07, 3.3 + R(-0.2, 0.2)); c.rotation.y = R(-0.5, 0.5); g.add(c); }
  return finalizar(g, 7.5, [V3(1.6, 7, -1)]);
}
function makeConfeitaria() {
  const g = predioComercial({ w: 6.6, d: 5.4, H: 3.8, cor: tintas.rosa, telhado: 0x5a3e36, nome: 'Confeitaria', toldo1: '#d85a86', toldo2: '#fff4f6' });
  // cupcake gigante no telhado
  const cup = new THREE.Group(); cup.position.set(0, 7.1, 0); g.add(cup);
  cup.add(mR(new THREE.CylinderGeometry(0.9, 0.7, 0.9, 16), mat(0xc98a4b), 0, 0.45, 0));
  cup.add(mR(new THREE.SphereGeometry(0.95, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xf7b8cc, { roughness: 0.5 }), 0, 0.9, 0));
  cup.add(mR(new THREE.SphereGeometry(0.22, 10, 8), mat(0xc8202a, { roughness: 0.3 }), 0, 1.95, 0));
  return finalizar(g, 9.5);
}
function makeLoja() {
  const g = predioComercial({ w: 6.8, d: 5.6, H: 5.6, cor: tintas.azul, telhado: 0x3c4048, nome: 'Loja de Brinquedos', toldo1: '#2f5fb0', toldo2: '#ffd166', andares: 2 });
  // presente gigante no telhado
  const gf = makeGift(1.6, 0xc8202a, 0xffd166); gf.position.set(0, 8.1, 0.5); g.add(gf);
  // ursinho na vitrine
  const urso = new THREE.Group(); urso.position.set(-1.6, 0.9, 2.5); g.add(urso);
  const pelo = mat(0x9a6a3e, { roughness: 1 });
  urso.add(mR(new THREE.SphereGeometry(0.42, 12, 10), pelo, 0, 0.4, 0)); urso.add(mR(new THREE.SphereGeometry(0.3, 12, 10), pelo, 0, 0.95, 0));
  for (const x of [-0.2, 0.2]) urso.add(mR(new THREE.SphereGeometry(0.11, 8, 6), pelo, x, 1.2, 0));
  return finalizar(g, 11);
}
function makeEstacao() {
  const g = new THREE.Group(), parede = paredeDe(tintas.creme), telha = telhaDe(0x3a3f47), base = 0.3;
  g.add(caixa(9.6, base, 9.6, MR.calcada, 0, base / 2, 0));
  g.add(caixa(7.6, 4.2, 4.6, parede, 0, base + 2.1, -1.6));
  const fr = frontaoR({ w: 7.6, d: 4.6, h: 2.2, parede, telha }); fr.position.set(0, base + 4.2, -1.6); g.add(fr); ledsFrontao(g, fr);
  for (const x of [-2.5, 0, 2.5]) { const j = janelaR(1.4, 2.4, 2, 3); j.position.set(x, base + 1.7, 0.71); g.add(j); }
  placa(g, 'Estação Vila de Natal', 5.6, 0, base + 3.7, 0.85);
  // plataforma coberta
  g.add(caixa(9.4, 0.5, 3.2, MR.calcada, 0, 0.55, 2.6));
  g.add(caixa(9.6, 0.15, 3.6, MR.preto, 0, 3.9, 2.6)); g.add(caixa(9.7, 0.2, 3.7, snowMat, 0, 4.05, 2.6));
  for (const x of [-4.2, -1.4, 1.4, 4.2]) g.add(caixa(0.18, 3.2, 0.18, MR.preto, x, 2.3, 3.9));
  ledsLinha(g, V3(-4.7, 3.75, 4.45), V3(4.7, 3.75, 4.45), 30, bulbMat);
  // torre do relógio
  const torre = new THREE.Group(); torre.position.set(3.9, 0, -3.2); g.add(torre);
  torre.add(caixa(1.6, 7.6, 1.6, parede, 0, base + 3.8, 0));
  torre.add(mR(new THREE.CylinderGeometry(0.6, 0.6, 0.1, 24), mat(0xfff8e6, { emissive: 0xffe8b0, emissiveIntensity: 0.8 }), 0, base + 6.6, 0.82).rotateX(Math.PI / 2));
  torre.add(mR(new THREE.ConeGeometry(1.3, 1.8, 4), telha, 0, base + 8.5, 0).rotateY(Math.PI / 4));
  for (const x of [-2.2, 0, 2.2]) { const b = makeGift(0.5, [0xc8202a, 0x2f9e5b, 0x2f5fb0][Math.abs(x) % 3 | 0], 0xffd166); b.position.set(x - 1, 0.8, 3.0); g.add(b); }
  return finalizar(g, 10);
}
function makeMercado() {
  const g = new THREE.Group();
  g.add(caixa(9.6, 0.15, 9.6, MR.pedra, 0, 0.08, 0));
  const cores = [['#c8202a', '#f6f2ec'], ['#1f6a43', '#f6f2ec'], ['#2f5fb0', '#ffd166'], ['#d85a86', '#fff4f6']];
  [[-2.6, -2.4, 0], [2.6, -2.4, 0], [-2.6, 2.4, Math.PI], [2.6, 2.4, Math.PI]].forEach(([x, z, r], i) => {
    const b = new THREE.Group(); b.position.set(x, 0, z); b.rotation.y = r; g.add(b);
    b.add(caixa(3.6, 1.0, 1.4, mat(0x8a5a3c), 0, 0.5, 0.6));
    for (const xx of [-1.7, 1.7]) b.add(caixa(0.12, 2.6, 0.12, mat(0x6b4226), xx, 1.3, 1.25));
    const tl = mR(new THREE.PlaneGeometry(3.8, 2.0), toldoMat(...cores[i]), 0, 2.7, 0.55); tl.rotation.x = -1.05; b.add(tl);
    b.add(caixa(3.9, 0.15, 1.9, snowMat, 0, 3.15, 0.35));
    for (let k = 0; k < 5; k++) { const gf = makeGift(R(0.25, 0.4), [0xc8202a, 0x2f9e5b, 0xffc94d, 0x4f7fe0][k % 4], 0xffffff); gf.position.set(-1.3 + k * 0.65, 1.0, 0.7); b.add(gf); }
    ledsLinha(b, V3(-1.8, 3.25, 1.3), V3(1.8, 3.25, 1.3), 16, bulbMat);
  });
  const arv = makePinheiroReal('espruce', { luzes: 2 }, 0.55); g.add(arv);
  return finalizar(g, 5);
}
function makeRenas() {
  const g = new THREE.Group(), luz = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1d6, emissiveIntensity: 2.2, roughness: 0.4 });
  [[-0.9, 0.4, 0.5], [1.0, -0.4, -0.3]].forEach(([x, z, r], i) => {
    const rn = makeRena(false); rn.traverse(o => { if (o.isMesh) o.material = luz; }); rn.position.set(x, 0, z); rn.rotation.y = r; rn.scale.setScalar(i ? 0.9 : 1.1); g.add(rn);
  });
  g.add(caixa(4.4, 0.12, 4.4, snowMat, 0, 0.06, 0));
  return finalizar(g, 3);
}
function makePista() {
  const g = new THREE.Group(), gelo = mat(0xcfe9ff, { roughness: 0.08, metalness: 0.1 });
  // rampa de neve com pista de gelo que desce
  const rampa = new THREE.Shape(); rampa.moveTo(-4.6, 0); rampa.lineTo(4.6, 0); rampa.lineTo(4.6, 0.3); rampa.quadraticCurveTo(-0.5, 0.6, -3.4, 4.2); rampa.lineTo(-4.6, 4.2); rampa.closePath();
  g.add(mR(new THREE.ExtrudeGeometry(rampa, { depth: 4.0, bevelEnabled: false }), snowMat, 0, 0, -2.0));
  const curva = new THREE.CatmullRomCurve3([V3(-3.6, 4.3, 0), V3(-1.6, 2.4, 0), V3(1, 0.9, 0), V3(4.4, 0.45, 0)]);
  g.add(mR(new THREE.TubeGeometry(curva, 40, 0.55, 8, false), gelo));
  g.add(caixa(1.6, 1.6, 2.2, mat(0x8a5a3c), -4.0, 5.0, 0));
  g.add(caixa(1.9, 0.25, 2.5, snowMat, -4.0, 5.9, 0));
  for (let i = 0; i < 8; i++) { const t = i / 7, p = curva.getPoint(t); for (const s of [-1.2, 1.2]) { g.add(mR(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6), stripeMat, p.x, p.y + 0.6, s)); g.add(mR(new THREE.SphereGeometry(0.12, 8, 6), bulbMat, p.x, p.y + 1.25, s)); } }
  const tr = new THREE.Group(); tr.position.set(3.4, 0.55, 0); tr.rotation.y = Math.PI / 2; g.add(tr);
  tr.add(caixa(0.8, 0.35, 1.6, mat(0xc8202a, { roughness: 0.4 }), 0, 0.2, 0));
  return finalizar(g, 6);
}
// Igreja branca com torre, no estilo das casas (cabe num lote 4x4, frente pra +z).
function makeIgreja() {
  const g = new THREE.Group();
  const par = new THREE.MeshStandardMaterial({ map: rep(rebocoTex, 2, 2), color: 0xf2efe8, roughness: 0.9 }), tel = new THREE.MeshStandardMaterial({ map: rep(telhaTex, 2, 2), color: 0x3c4048, roughness: 0.8 });
  const ouro = mat(0xe8b13a, { metalness: 0.8, roughness: 0.3 });
  g.add(caixa(9.4, 0.25, 9.4, MR.pedra, 0, 0.12, 0));
  // nave
  g.add(caixa(4.8, 4.2, 6.6, par, 0, 2.35, -1.2));
  const fr = frontaoR({ w: 4.8, d: 6.6, h: 2.6, parede: par, telha: tel }); fr.position.set(0, 4.45, -1.2); g.add(fr);
  for (const zz of [-3.2, -1.2, 0.8]) for (const sx of [-1, 1]) { const j = janelaR(0.7, 2.0, 1, 3); j.position.set(sx * 2.41, 2.4, zz); j.rotation.y = sx * Math.PI / 2; g.add(j); }
  // torre na frente
  g.add(caixa(2.2, 8.4, 2.2, par, 0, 4.45, 2.6));
  g.add(caixa(2.5, 0.3, 2.5, MR.preto, 0, 8.7, 2.6));
  const sino = new THREE.Group(); sino.position.set(0, 7.3, 2.6); g.add(sino);
  for (const sx of [-1, 1]) { const a = caixa(0.05, 1.1, 0.7, MR.preto, sx * 1.11, 0, 0); sino.add(a); const b = caixa(0.7, 1.1, 0.05, MR.preto, 0, 0, sx * 1.11); sino.add(b); }
  sino.add(mR(new THREE.CylinderGeometry(0.22, 0.4, 0.6, 12), ouro, 0, -0.1, 0));
  g.add(mR(new THREE.ConeGeometry(1.75, 4.2, 4), tel, 0, 10.95, 2.6).rotateY(Math.PI / 4));
  g.add(caixa(0.14, 1.4, 0.14, ouro, 0, 13.7, 2.6)); g.add(caixa(0.8, 0.14, 0.14, ouro, 0, 13.85, 2.6));
  // porta, degraus e lanternas
  const porta = janelaR(1.2, 2.3, 2, 3); porta.position.set(0, 1.4, 3.72); g.add(porta);
  const rosa = mR(new THREE.CircleGeometry(0.45, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.6, 0.9), toneMapped: false }), 0, 4.2, 3.72); g.add(rosa);
  for (let i = 0; i < 3; i++) g.add(caixa(2.6 - i * 0.3, 0.18, 0.5, MR.pedra, 0, 0.3 + i * 0.18, 4.45 - i * 0.3));
  for (const sx of [-1, 1]) { const l = lanternaR(); l.position.set(sx * 0.95, 2.0, 3.55); g.add(l); const pj = posteJardim(); pj.position.set(sx * 3.6, 0.25, 4.2); g.add(pj); }
  ledsFrontao(g, fr);
  ledsLinha(g, V3(-1.15, 8.95, 3.75), V3(1.15, 8.95, 3.75), 10, ledQuente);
  for (const sx of [-1, 1]) for (const zz of [2.4, 0.4]) { const a = arbustoR(0.55); a.position.set(sx * 3.1, 0.6, zz); g.add(a); }
  return finalizar(g, 14);
}

function makePresepio() {
  const g = new THREE.Group(), madeira = mat(0x7a4a2a, { roughness: 0.9 }), palha = mat(0xc9a25a, { roughness: 1 }), pele = mat(0xe8bf98);
  g.add(caixa(4.8, 0.15, 4.6, mat(0xb08a56, { roughness: 1 }), 0, 0.08, 0));
  // estábulo
  for (const x of [-1.8, 1.8]) for (const z of [-1.6, 0.4]) g.add(caixa(0.2, 2.6, 0.2, madeira, x, 1.3, z));
  const tri = new THREE.Shape(); tri.moveTo(-2.2, 0); tri.lineTo(2.2, 0); tri.lineTo(0, 1.2); tri.closePath();
  g.add(mR(new THREE.ExtrudeGeometry(tri, { depth: 2.4, bevelEnabled: false }), madeira, 0, 2.6, -1.8));
  g.add(caixa(4.6, 0.2, 2.6, snowMat, 0, 3.0, -0.5));
  g.add(caixa(3.6, 1.8, 0.15, madeira, 0, 1.0, -1.65));
  g.add(caixa(3.4, 0.08, 1.9, palha, 0, 0.19, -0.6));
  const figura = (x, z, cor, h, ry = 0) => { const f = new THREE.Group(); f.position.set(x, 0.15, z); f.rotation.y = ry; f.add(mR(new THREE.ConeGeometry(0.3 * h / 1.3, h, 10), mat(cor, { roughness: 0.9 }), 0, h / 2, 0)); f.add(mR(new THREE.SphereGeometry(0.17 * h / 1.3, 10, 8), pele, 0, h + 0.1, 0)); g.add(f); return f; };
  // Maria (manto azul com véu), José (cajado) e o menino na manjedoura
  const maria = figura(-0.85, -0.5, 0x3a5a9e, 1.2, 0.4); maria.add(mR(new THREE.SphereGeometry(0.2, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.8), mat(0xe9eef8), 0, 1.33, -0.02));
  const jose = figura(0.85, -0.5, 0x7a4a2a, 1.4, -0.4); jose.add(caixa(0.06, 1.8, 0.06, madeira, 0.35, 0.9, 0.1));
  g.add(caixa(0.7, 0.3, 0.4, madeira, 0, 0.3, -0.4)); g.add(caixa(0.6, 0.06, 0.3, palha, 0, 0.47, -0.4));
  g.add(mR(new THREE.SphereGeometry(0.14, 8, 6), mat(0xf6f1e4), 0, 0.55, -0.4)); g.add(mR(new THREE.SphereGeometry(0.09, 8, 6), pele, 0.12, 0.6, -0.4));
  // boi e burrinho no fundo
  const bicho = (x, cor, orelha) => { const b = new THREE.Group(); b.position.set(x, 0.15, -1.2); g.add(b); b.add(caixa(0.9, 0.5, 0.45, mat(cor), 0, 0.6, 0)); b.add(caixa(0.35, 0.35, 0.3, mat(cor), x < 0 ? 0.55 : -0.55, 0.85, 0.1)); for (const lx of [-0.3, 0.3]) for (const lz of [-0.15, 0.15]) b.add(caixa(0.1, 0.4, 0.1, mat(cor), lx, 0.2, lz)); b.add(caixa(0.06, orelha, 0.06, mat(cor), x < 0 ? 0.6 : -0.6, 1.05 + orelha / 2, 0.05)); return b; };
  bicho(-1.25, 0x8a8a90, 0.3); bicho(1.25, 0x6b4a32, 0.12);
  // três reis magos chegando, com coroas e presentes
  const coroa = mat(0xe8b13a, { metalness: 0.8, roughness: 0.3 });
  [[-1.5, 1.4, 0x8e2a4a], [0, 1.75, 0x2f6a4a], [1.5, 1.4, 0x5a3a8e]].forEach(([x, z, cor]) => {
    const r = figura(x, z, cor, 1.35, Math.PI + (x ? -x * 0.25 : 0));
    r.add(mR(new THREE.CylinderGeometry(0.15, 0.13, 0.14, 8), coroa, 0, 1.6, 0));
    r.add(caixa(0.22, 0.18, 0.22, coroa, 0, 0.75, -0.3));
  });
  // pastor com ovelhinhas ao lado
  const pastor = figura(2.05, 0.9, 0x8a6a3a, 1.2, -1.2); pastor.add(caixa(0.06, 1.6, 0.06, madeira, 0.3, 0.8, 0));
  for (const [x, z] of [[1.7, 1.9], [2.2, 1.7], [-2.1, 0.6]]) { g.add(mR(new THREE.SphereGeometry(0.22, 10, 8), mat(0xf4f1ea, { roughness: 1 }), x, 0.42, z)); g.add(mR(new THREE.SphereGeometry(0.1, 8, 6), mat(0x2a2a2e), x + 0.2, 0.48, z)); }
  // estrela guia e luz quente dentro do estábulo
  const brilho = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4, 1.5), toneMapped: false });
  const estrela = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? 0.16 : 0.42; estrela[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); }
  g.add(mR(new THREE.ExtrudeGeometry(estrela, { depth: 0.08, bevelEnabled: false }), brilho, 0, 4.4, -0.5));
  g.add(mR(new THREE.BoxGeometry(0.16, 0.24, 0.16), MR.lampada, 0, 2.4, -0.7));
  return finalizar(g, 4.8);
}
function makeRoda() {
  const g = new THREE.Group(), aco = mat(0xe8e8ee, { metalness: 0.6, roughness: 0.3 });
  g.add(caixa(9.6, 0.2, 9.6, MR.pedra, 0, 0.1, 0));
  for (const z of [-1.2, 1.2]) for (const s of [-1, 1]) { const b = caixa(0.25, 7.6, 0.25, aco, s * 1.9, 3.6, z); b.rotation.z = s * 0.26; g.add(b); }
  g.add(caixa(1.6, 1.2, 1.6, mat(0x8a5a3c), 3.6, 0.8, 3.2));
  const estatica = finalizar(g, 10);
  // a roda gira (fica fora do fundir)
  const roda = new THREE.Group(); roda.position.set(0, 7.0, 0); estatica.add(roda);
  for (const z of [-1.0, 1.0]) roda.add(mR(new THREE.TorusGeometry(4.2, 0.12, 8, 48), aco, 0, 0, z));
  const raios = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 8.4, 0.08), aco, 16), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let i = 0; i < 16; i++) { q.setFromAxisAngle(V3(0, 0, 1), i / 16 * Math.PI * 2); m4.compose(V3(0, 0, i % 2 ? 1 : -1), q, V3(1, 1, 1)); raios.setMatrixAt(i, m4); }
  roda.add(raios);
  const cab = []; const coresC = [0xc8202a, 0x2f9e5b, 0xffc94d, 0x2f5fb0];
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, c = new THREE.Group(); c.position.set(Math.cos(a) * 4.2, Math.sin(a) * 4.2, 0); c.add(mR(new THREE.BoxGeometry(1.0, 0.9, 1.4), mat(coresC[i % 4], { roughness: 0.4 }), 0, -0.6, 0)); c.add(caixa(1.1, 0.12, 1.5, snowMat, 0, -0.08, 0)); roda.add(c); cab.push(c); }
  const lu = new THREE.InstancedMesh(bulbGeo, bulbMat, 48), cc = new THREE.Color();
  for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2; m4.makeTranslation(Math.cos(a) * 4.2, Math.sin(a) * 4.2, 1.15); lu.setMatrixAt(i, m4); lu.setColorAt(i, cc.setRGB(...BULBS[i % 5])); }
  lu.userData.noShadow = true; roda.add(lu);
  estatica.userData.gira = { obj: roda, eixo: 'z', vel: 0.15, cabines: cab };
  estatica.userData.altura = 12.5;
  return estatica;
}
function makeChafariz() {
  const g = new THREE.Group(), pedra = mat(0xb9bec8, { roughness: 0.9 }), gelo = new THREE.MeshPhysicalMaterial({ color: 0xbfe6ff, roughness: 0.05, transmission: 0.3, thickness: 0.5, emissive: 0x335577, emissiveIntensity: 0.4 });
  g.add(mR(new THREE.CylinderGeometry(2.0, 2.2, 0.7, 32), pedra, 0, 0.35, 0));
  g.add(mR(new THREE.CylinderGeometry(1.8, 1.8, 0.1, 32), gelo, 0, 0.66, 0));
  g.add(mR(new THREE.CylinderGeometry(0.3, 0.4, 1.8, 12), pedra, 0, 1.4, 0));
  g.add(mR(new THREE.CylinderGeometry(1.0, 0.8, 0.3, 24), pedra, 0, 2.3, 0));
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; const c = mR(new THREE.ConeGeometry(0.08, R(0.5, 0.9), 6), gelo, Math.cos(a) * 0.95, 1.9, Math.sin(a) * 0.95); c.rotation.x = Math.PI; g.add(c); }
  g.add(mR(new THREE.ConeGeometry(0.35, 1.2, 10), gelo, 0, 3.0, 0));
  g.add(mR(new THREE.TorusGeometry(2.05, 0.18, 8, 32), snowMat, 0, 0.72, 0).rotateX(Math.PI / 2));
  return finalizar(g, 4);
}
function makeTeatro() {
  const g = new THREE.Group(), parede = paredeDe(tintas.vermelho), branco = MR.branco, base = 0.4;
  g.add(caixa(9.8, base, 9.4, MR.calcada, 0, base / 2, 0));
  g.add(caixa(8.6, 6.2, 7.0, parede, 0, base + 3.1, -0.8));
  // frontão clássico com colunas
  for (let i = 0; i < 6; i++) g.add(mR(new THREE.CylinderGeometry(0.28, 0.32, 5.2, 14), branco, -3.5 + i * 1.4, base + 2.6 + 0.4, 3.4));
  g.add(caixa(9.0, 0.6, 2.2, branco, 0, base + 5.9, 3.0));
  const tri = new THREE.Shape(); tri.moveTo(-4.5, 0); tri.lineTo(4.5, 0); tri.lineTo(0, 1.8); tri.closePath();
  g.add(mR(new THREE.ExtrudeGeometry(tri, { depth: 2.2, bevelEnabled: false }), branco, 0, base + 6.2, 1.9));
  g.add(caixa(9.2, 0.2, 2.4, snowMat, 0, base + 6.25, 3.0));
  for (let i = 0; i < 3; i++) { const j = janelaR(1.2, 2.8, 1, 3); j.position.set(-2.2 + i * 2.2, base + 1.6, 2.71); g.add(j); }
  placa(g, 'Teatro de Natal', 5.6, 0, base + 4.6, 2.8, '#1d1d24', '#ffd166');
  ledsLinha(g, V3(-4.5, base + 6.25, 4.15), V3(0, base + 8.0, 4.15), 24, bulbMat); ledsLinha(g, V3(0, base + 8.0, 4.15), V3(4.5, base + 6.25, 4.15), 24, bulbMat);
  g.add(caixa(9.0, 0.4, 7.4, telhaDe(0x2f3a34), 0, base + 6.5, -0.8));
  return finalizar(g, 10);
}
function makeArvoreGigante() {
  const g = new THREE.Group(), t = makeTree({ luzes: 3, bolas: 3, festao: 2, presentes: 3, estrela: 1 }); t.scale.setScalar(0.55); g.add(t);
  g.add(mR(new THREE.CylinderGeometry(2.4, 2.4, 0.2, 32), mat(0xb9bec8), 0, 0.1, 0));
  g.userData.altura = 8.5; g.userData.star = t.userData.star;
  return g;
}
function makeCastelo() {
  const g = new THREE.Group(), gelo = new THREE.MeshPhysicalMaterial({ color: 0xcdeeff, roughness: 0.1, metalness: 0.0, clearcoat: 1, emissive: 0x4a7aa8, emissiveIntensity: 0.35 }), azul = mat(0x6ea8d8, { roughness: 0.3 });
  g.add(caixa(9.6, 0.3, 9.6, snowMat, 0, 0.15, 0));
  g.add(caixa(5.6, 4.6, 4.6, gelo, 0, 2.6, -0.6));
  for (const [x, z, h] of [[-3.2, -3, 7.5], [3.2, -3, 7.5], [-3.2, 2.4, 6], [3.2, 2.4, 6], [0, -0.6, 9.5]]) {
    g.add(mR(new THREE.CylinderGeometry(0.9, 1.0, h, 16), gelo, x, h / 2 + 0.3, z));
    g.add(mR(new THREE.ConeGeometry(1.15, 2.2, 16), azul, x, h + 1.4, z));
    g.add(mR(new THREE.SphereGeometry(0.16, 8, 6), bulbMat, x, h + 2.6, z));
  }
  for (let i = 0; i < 7; i++) g.add(caixa(0.6, 0.6, 0.6, gelo, -2.4 + i * 0.8, 5.2, 1.7));
  const porta = mR(new THREE.PlaneGeometry(1.6, 2.4), MR.vidro, 0, 1.5, 1.71); g.add(porta);
  ledsLinha(g, V3(-2.8, 4.95, 1.85), V3(2.8, 4.95, 1.85), 24, ledQuente);
  return finalizar(g, 12.5);
}
function makeArco() {
  const g = new THREE.Group();
  const curva = new THREE.EllipseCurve(0, 0, 2.2, 3.6, 0, Math.PI, false);
  const pts = curva.getPoints(40).map(p => V3(p.x, p.y, 0));
  g.add(mR(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.12, 6), MR.preto, 0, 0.2, 0));
  const lu = new THREE.InstancedMesh(bulbGeo, bulbMat, 60), m4 = new THREE.Matrix4(), cc = new THREE.Color();
  curva.getPoints(59).forEach((p, i) => { m4.makeTranslation(p.x, p.y + 0.2, 0.15); lu.setMatrixAt(i, m4); lu.setColorAt(i, cc.setRGB(...BULBS[i % 5])); });
  lu.userData.noShadow = true; g.add(lu);
  for (const x of [-2.2, 2.2]) { const p = makePinheiroReal('abeto', { luzes: 1 }, 0.35); p.position.set(x * 1.35, 0, 0); g.add(p); }
  g.add(caixa(4.8, 0.1, 1.6, snowMat, 0, 0.05, 0));
  g.userData.altura = 4.4;
  return g;
}
function makePousada() {
  const g = predioComercial({ w: 8.6, d: 6.6, H: 7.4, cor: tintas.verde, telhado: 0x3f4a44, nome: 'Pousada da Neve', toldo1: '#1f6a43', toldo2: '#f6f2ec', andares: 2 });
  for (const x of [-2.8, 0, 2.8]) { const j = janelaR(1.0, 1.4, 2, 2); j.position.set(x, 3.9, 3.31); g.add(j); }
  for (const x of [-3, 3]) g.add(caixa(0.8, 2.6, 0.8, MR.branco, x, 10.3, -1.8));
  return finalizar(g, 11.5, [V3(-3, 11.8, -1.8), V3(3, 11.8, -1.8)]);
}
function makeEstatua() {
  const g = new THREE.Group(), pedra = mat(0xc9ccd4, { roughness: 0.8 }), bronze = mat(0xb08848, { metalness: 0.8, roughness: 0.35 });
  g.add(caixa(3.4, 0.3, 3.4, MR.pedra, 0, 0.15, 0));
  g.add(caixa(1.8, 1.8, 1.8, pedra, 0, 1.2, 0));
  g.add(caixa(2.1, 0.25, 2.1, snowMat, 0, 2.2, 0));
  const noel = new THREE.Group(); noel.position.y = 2.3; noel.scale.setScalar(1.6); g.add(noel);
  noel.add(mR(new THREE.SphereGeometry(0.55, 16, 12), bronze, 0, 0.6, 0));
  noel.add(mR(new THREE.SphereGeometry(0.32, 14, 12), bronze, 0, 1.35, 0));
  noel.add(mR(new THREE.ConeGeometry(0.3, 0.6, 14), bronze, 0, 1.8, 0).rotateZ(0.4));
  noel.add(mR(new THREE.SphereGeometry(0.45, 10, 8), bronze, -0.55, 0.9, -0.2));
  for (const x of [-1.6, 1.6]) { const l = posteJardim(); l.position.set(x, 0.3, 1.4); g.add(l); }
  return finalizar(g, 6);
}
function makeOficina() {
  const g = new THREE.Group(), parede = paredeDe(tintas.vermelho), telha = telhaDe(0x2f3a34), base = 0.4;
  g.add(caixa(9.8, base, 9.8, MR.calcada, 0, base / 2, 0));
  g.add(caixa(9.0, 6.0, 7.2, tijolo, 0, base + 3.0, -0.6));
  const fr = frontaoR({ w: 9.0, d: 7.2, h: 3.4, parede, telha }); fr.position.set(0, base + 6.0, -0.6); g.add(fr); ledsFrontao(g, fr);
  const porta = new THREE.Group(); porta.position.set(0, 0, 3.01); g.add(porta);
  porta.add(caixa(3.4, 3.6, 0.2, mat(0x6b3a22), 0, base + 1.8, 0));
  porta.add(mR(new THREE.PlaneGeometry(3.0, 0.8), MR.vidro, 0, base + 4.0, 0.12));
  for (const x of [-3.2, 3.2]) { const j = janelaR(1.6, 2.2, 2, 3); j.position.set(x, base + 2.0, 3.01); g.add(j); }
  for (const x of [-3, 0, 3]) { const j = janelaR(1.2, 1.3, 2, 2); j.position.set(x, base + 4.9, 3.01); g.add(j); }
  placa(g, 'Oficina do Papai Noel', 6.2, 0, base + 6.0, 3.2, '#fff4dc', '#9e1f28');
  for (const x of [-3, 3]) { g.add(mR(new THREE.CylinderGeometry(0.6, 0.66, 5, 18), stripeMat, x, base + 8.5, -2.6)); g.add(mR(new THREE.CylinderGeometry(0.8, 0.8, 0.3, 18), snowMat, x, base + 11.1, -2.6)); }
  const gf = makeGift(1.2, 0x2f9e5b, 0xffd166); gf.position.set(3.8, 0.4, 4.0); g.add(gf);
  const gf2 = makeGift(0.9, 0xc8202a, 0xffd166); gf2.position.set(-3.9, 0.4, 4.2); g.add(gf2);
  return finalizar(g, 13, [V3(-3, base + 11.4, -2.6), V3(3, base + 11.4, -2.6)]);
}

// padaria realista: loja de esquina com vitrine, toldo, biscoito gigante e chaminé do forno
function makePadariaReal() {
  const g = predioComercial({ w: 6.4, d: 5.2, H: 3.8, cor: tintas.creme, telhado: 0x5a3e36, nome: 'Padaria de Biscoitos', toldo1: '#8a5a3c', toldo2: '#f6e7cf' });
  const bisc = new THREE.Group(); bisc.position.set(0, 7.0, 0.4); g.add(bisc);
  bisc.add(mR(new THREE.CylinderGeometry(1.0, 1.0, 0.25, 28), mat(0xc98a4b, { roughness: 0.9 }), 0, 0, 0).rotateX(Math.PI / 2));
  for (const [x, y] of [[-0.35, 0.25], [0.3, -0.1], [-0.05, -0.45], [0.4, 0.45], [-0.5, -0.2]]) bisc.add(mR(new THREE.SphereGeometry(0.1, 6, 6), mat(0x4a2a14), x, y, 0.14));
  g.add(caixa(0.8, 2.4, 0.8, tijolo, 2.2, 6.4, -1.3)); g.add(caixa(1.0, 0.2, 1.0, snowMat, 2.2, 7.7, -1.3));
  for (let i = 0; i < 4; i++) { const p = mR(new THREE.CylinderGeometry(0.22, 0.2, 0.12, 14), mat(0xd9a066), -2.1 + i * 0.45, 1.25, 2.68); p.rotation.x = Math.PI / 2; g.add(p); }
  return finalizar(g, 9, [V3(2.2, 8.2, -1.3)]);
}
// rinque realista: gelo com muretas brancas, refletores, cabine de aluguel de patins e pinheiros com pisca
function makeRinqueReal() {
  const g = new THREE.Group(), gelo = new THREE.MeshStandardMaterial({ color: 0xa8d8ff, roughness: 0.05, metalness: 0.2, emissive: 0x16344f, emissiveIntensity: 0.5 }), mureta = mat(0xf4f4f2, { roughness: 0.6 });
  g.add(caixa(9.6, 0.15, 9.6, snowMat, 0, 0.07, 0));
  g.add(mR(rbox(7.6, 0.12, 5.6, 0.05), gelo, 0, 0.2, -0.8));
  for (const [w, d, x, z] of [[7.8, 0.15, 0, -3.65], [7.8, 0.15, 0, 2.05], [0.15, 5.8, -3.9, -0.8], [0.15, 5.8, 3.9, -0.8]]) { g.add(caixa(w, 0.6, d, mureta, x, 0.5, z)); g.add(caixa(w, 0.1, d, mat(0xc8202a), x, 0.82, z)); }
  for (const [x, z] of [[-4.3, -4], [4.3, -4], [-4.3, 2.4], [4.3, 2.4]]) {
    g.add(mR(new THREE.CylinderGeometry(0.07, 0.09, 4.4, 8), MR.preto, x, 2.2, z));
    g.add(caixa(0.6, 0.3, 0.3, MR.preto, x * 0.92, 4.4, z * 0.92));
    g.add(mR(new THREE.BoxGeometry(0.45, 0.2, 0.05), MR.lampada, x * 0.92, 4.38, z * 0.92 + (z > 0 ? -0.16 : 0.16)));
  }
  ledsLinha(g, V3(-4.3, 4.1, -4), V3(4.3, 4.1, -4), 26, bulbMat); ledsLinha(g, V3(-4.3, 4.1, 2.4), V3(4.3, 4.1, 2.4), 26, bulbMat);
  const cab = new THREE.Group(); cab.position.set(2.6, 0, 3.6); g.add(cab);
  cab.add(caixa(2.4, 2.2, 1.6, paredeDe(tintas.vermelho), 0, 1.25, 0));
  cab.add(caixa(2.7, 0.2, 1.9, snowMat, 0, 2.45, 0));
  const jan = janelaR(1.2, 0.8, 2, 1); jan.position.set(0, 1.5, 0.81); cab.add(jan);
  placa(cab, 'Patins', 1.8, 0, 2.15, 0.9);
  for (const x of [-3.6, -2.4]) { const p = makePinheiroReal('abeto', { luzes: 1 }, 0.42); p.position.set(x, 0, 3.7); g.add(p); }
  // patinadores (pessoinhas no gelo) são os moradores; aqui só uma placa de pista
  return finalizar(g, 4.6);
}
// carro comum realista (sedã/utilitário), com neve no teto e às vezes um pinheiro amarrado
function makeCarReal(cor, comArvore, suv) {
  const g = new THREE.Group(), lata = mat(cor, { roughness: 0.3, metalness: 0.45 });
  const lado = new THREE.Shape(), alto = suv ? 0.25 : 0;
  lado.moveTo(-2.1, 0.3); lado.lineTo(2.05, 0.3); lado.quadraticCurveTo(2.25, 0.32, 2.2, 0.75); lado.lineTo(1.35, 0.9 + alto * 0.4);
  lado.lineTo(0.75, 1.45 + alto); lado.lineTo(-1.3, 1.45 + alto); lado.lineTo(-1.95, 0.95 + alto * 0.5); lado.quadraticCurveTo(-2.2, 0.85, -2.1, 0.3);
  g.add(mR(new THREE.ExtrudeGeometry(lado, { depth: 1.6, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 2, curveSegments: 8 }), lata, 0, 0, -0.8));
  const vid = new THREE.Shape(); vid.moveTo(1.25, 0.95 + alto * 0.4); vid.lineTo(0.7, 1.38 + alto); vid.lineTo(-1.22, 1.38 + alto); vid.lineTo(-1.8, 0.98 + alto * 0.5); vid.closePath();
  g.add(mR(new THREE.ExtrudeGeometry(vid, { depth: 1.66, bevelEnabled: false }), vidroMat, 0, 0, -0.83));
  for (const x of [-1.35, 1.35]) for (const z of [-0.82, 0.82]) { const w = mR(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 14), pneuMat, x, 0.36, z); w.rotation.x = Math.PI / 2; g.add(w); }
  for (const z of [-0.55, 0.55]) { g.add(mR(new THREE.SphereGeometry(0.1, 8, 6), MR.lampada, 2.22, 0.62, z)); g.add(mR(new THREE.BoxGeometry(0.05, 0.1, 0.32), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.2), toneMapped: false }), -2.18, 0.7, z)); }
  g.add(caixa(2.0, 0.14, 1.5, snowMat, -0.25, 1.55 + alto, 0));
  if (comArvore) { const p = makePinheiroReal('pinheiro', {}, 0.18); p.rotation.z = Math.PI / 2; p.position.set(0.7, 1.75 + alto, 0); g.add(p); }
  const feixe = mR(new THREE.PlaneGeometry(4, 2.2), poolMat, 3.1, 0.06, 0); feixe.rotation.x = -Math.PI / 2; feixe.userData.noShadow = true; g.add(feixe);
  g.scale.setScalar(0.62);
  const out = new THREE.Group(); out.add(g); return out;
}

export const MODELOS = {
  praca: makePlaza, casa: (p) => (p && (p.nv || 1) >= 3 && PRONTOS.casa3 ? makeCasaPronta(p) : makeHouse(p)), fabrica: makeFactory, padaria: makePadariaReal, rinque: makeRinqueReal,
  correio: makeCorreio, confeitaria: makeConfeitaria, loja: makeLoja, estacao: makeEstacao, mercado: makeMercado, renas: makeRenas,
  pista: makePista, presepio: makePresepio, igreja: makeIgreja, roda: makeRoda, chafariz: makeChafariz, teatro: makeTeatro, arvoreGigante: makeArvoreGigante,
  castelo: makeCastelo, arco: makeArco, pousada: makePousada, estatua: makeEstatua, oficina: makeOficina,
  pinheiro: (p) => makePinheiroReal('pinheiro', p?.itens || {}, 0.6), abeto: (p) => makePinheiroReal('abeto', p?.itens || {}, 0.6), espruce: (p) => makePinheiroReal('espruce', p?.itens || {}, 0.6), boneco: makeSnowman, poste: makeLamp, presentes: makeGiftPile,
};
// p = o prédio (nível e itens mudam o modelo). Sem p, sai a versão "de vitrine" pro menu.
function criarModelo(tipo, p) {
  let o;
  if (p && p.obra && p.obra.tipo === 'construir') { o = makeCanteiro(TIPOS[tipo].tam); o.userData.altura = TIPOS[tipo].tam >= 3 ? 7 : 2.5; }
  else {
    o = MODELOS[tipo](p || undefined);
    if (p && p.obra && p.obra.tipo === 'melhorar') { const a = makeAndaime(TIPOS[tipo].tam * T * 0.95, (o.userData.altura || 6) - 0.5); o.add(a); }
  }
  o.traverse(m => { if (m.isMesh) { m.castShadow = !m.userData.noShadow; m.receiveShadow = true; } });
  return otimizar(o);
}
const chaveModelo = (p) => `${p.tipo}|${p.nv || 1}|${JSON.stringify(p.itens || {})}|${p.obra && p.obra.tipo !== 'enfeite' ? p.obra.tipo : ''}`;

const MAX_ELFOS = 30;
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
  g.userData = { arms, legs, hat };
  g.scale.setScalar(0.85);
  shadowAll(g);
  return otimizar(g);
}
// Duende construtor: capacete amarelo e martelo.
function makeConstrutor() {
  const g = makeElf(0xe0902a);
  g.userData.hat.visible = false;
  const amarelo = mat(0xffc629, { roughness: 0.4 });
  g.add(mesh(new THREE.SphereGeometry(0.34, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), amarelo, 0, 1.62, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 16), amarelo, 0, 1.63, 0.05));
  const martelo = new THREE.Group(); martelo.position.set(0, -0.45, 0.08);
  martelo.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), mat(0x8a5a3c), 0, -0.1, 0.12).rotateX(Math.PI / 2));
  martelo.add(mesh(new THREE.BoxGeometry(0.12, 0.12, 0.26), darkMat, 0, -0.1, 0.32));
  g.userData.arms[1].add(martelo);
  return shadowAll(g);
}

// Canteiro de obra (prédio sendo construído) e andaime (prédio sendo aumentado).
const madeiraObra = () => mat(0xb07a48, { roughness: 0.85 });
function makeAndaime(lado, altura) {
  const g = new THREE.Group(), m = madeiraObra(), h = lado / 2;
  for (const x of [-h, h]) for (const z of [-h, h]) g.add(mesh(new THREE.BoxGeometry(0.16, altura, 0.16), m, x, altura / 2, z));
  for (let y = 1.6; y < altura; y += 1.8) {
    for (const z of [-h, h]) g.add(mesh(new THREE.BoxGeometry(lado, 0.12, 0.5), m, 0, y, z));
    for (const x of [-h, h]) g.add(mesh(new THREE.BoxGeometry(0.5, 0.12, lado), m, x, y, 0));
  }
  const diag = mesh(new THREE.BoxGeometry(0.08, Math.hypot(lado, altura), 0.08), m, 0, altura / 2, h); diag.rotation.z = Math.atan2(lado, altura); g.add(diag);
  return g;
}
function makeCanteiro(tam) {
  const g = new THREE.Group(), L = tam * T * 0.9;
  g.add(mesh(rbox(L, 0.12, L, 0.05), mat(0x8a6a50, { roughness: 1 }), 0, 0.06, 0));
  if (tam === 1) {
    g.add(mesh(rbox(0.8, 0.6, 0.8, 0.05), madeiraObra(), 0, 0.42, 0));
    return g;
  }
  const alt = tam >= 4 ? 5 : 3.8;
  g.add(makeAndaime(L * 0.7, alt));
  g.add(mesh(rbox(L * 0.66, 0.4, L * 0.66, 0.05), mat(0x9aa1b0, { roughness: 0.95 }), 0, 0.3, 0));
  // pilha de tábuas e caixotes
  for (let i = 0; i < 4; i++) g.add(mesh(new THREE.BoxGeometry(2.2, 0.14, 0.4), madeiraObra(), -L * 0.32, 0.2 + i * 0.15, L * 0.38 - i * 0.05));
  for (const [x, z] of [[L * 0.36, L * 0.36], [L * 0.28, L * 0.42]]) g.add(mesh(rbox(0.7, 0.7, 0.7, 0.05), mat(0x8a5a3c), x, 0.47, z));
  // cones listrados
  for (const [x, z] of [[-L * 0.45, L * 0.45], [L * 0.45, -L * 0.45]]) { const c = mesh(new THREE.ConeGeometry(0.25, 0.7, 12), stripeMat, x, 0.47, z); g.add(c); }
  // guindaste
  const am = mat(0xffc629, { roughness: 0.4 }), gu = new THREE.Group(); gu.position.set(L * 0.38, 0, -L * 0.38); g.add(gu);
  gu.add(mesh(new THREE.BoxGeometry(0.35, alt + 2.5, 0.35), am, 0, (alt + 2.5) / 2, 0));
  const braco = mesh(new THREE.BoxGeometry(L * 0.9, 0.25, 0.25), am, -L * 0.3, alt + 2.4, 0); gu.add(braco);
  gu.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 2, 4), darkMat, -L * 0.6, alt + 1.4, 0));
  const carga = mesh(new THREE.BoxGeometry(0.8, 0.5, 0.8), madeiraObra(), -L * 0.6, alt + 0.2, 0); gu.add(carga);
  g.userData.guindaste = gu;
  addPool(g, 0, L * 0.4, 4);
  return g;
}
const ELF_CORES = [0x2e9e5b, 0x3a8fd0, 0xc23b6a, 0xe0902a, 0x8a5cc8, 0x2bb3a6];

// ---------- interior da casa ----------
// Uma sala em corte (chão + duas paredes) com um lugar fixo pra cada móvel. Cada
// móvel tem 3 níveis que mudam o visual. A cena é separada da vila e troca no render.
const woodFloorTex = tex(256, 256, (g, w, h) => {
  const n = 6, ph = h / n;
  for (let i = 0; i < n; i++) { g.fillStyle = `hsl(28,${R(40, 50)}%,${R(30, 38)}%)`; g.fillRect(0, i * ph, w, ph); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, i * ph, w, 2); const off = R(0, w); g.fillRect(off, i * ph, 2, ph); }
}, [3, 3]);
const wallpaperTex = tex(256, 256, (g, w, h) => {
  g.fillStyle = '#7a2e2e'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,220,170,0.12)'; for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 12, h);
  g.fillStyle = 'rgba(255,230,180,0.25)'; for (let y = 16; y < h; y += 48) for (let x = 22; x < w; x += 32) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
}, [3, 2]);
const xadrezTex = tex(64, 64, (g) => { g.fillStyle = '#2f7a46'; g.fillRect(0, 0, 64, 64); g.fillStyle = 'rgba(216,51,58,0.75)'; g.fillRect(0, 24, 64, 16); g.fillRect(24, 0, 16, 64); g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(0, 30, 64, 4); g.fillRect(30, 0, 4, 64); }, [2, 2]);
const tapeteTex = tex(256, 256, (g, w) => {
  g.fillStyle = '#b8322f'; g.fillRect(0, 0, w, w);
  g.strokeStyle = '#f2d38a'; g.lineWidth = 10; g.strokeRect(16, 16, w - 32, w - 32);
  g.strokeStyle = '#2f7a46'; g.lineWidth = 6; g.strokeRect(36, 36, w - 72, w - 72);
  g.fillStyle = '#f2d38a'; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(w / 2, w / 2, 20 + i * 18, 0, 7); g.lineWidth = 3; g.strokeStyle = i % 2 ? '#f2d38a' : '#ffffff'; g.stroke(); }
});

const MOVEIS_POS = {
  lareira: { x: -1.2, z: -4.35, r: 0 },
  sofa: { x: 0.6, z: 1.9, r: Math.PI },
  mesa: { x: 0.2, z: -0.6, r: 0 },
  tapete: { x: 0.2, z: -0.4, r: 0 },
  cama: { x: -3.5, z: 2.4, r: Math.PI / 2 },
  estante: { x: -4.4, z: -1.6, r: Math.PI / 2 },
  poltrona: { x: 3.0, z: -1.2, r: -Math.PI / 2.6 },
  arvorinha: { x: 3.7, z: -3.7, r: 0 },
};

function fabric(n, cores) { return mat(cores[n - 1], { roughness: 0.95 }); }
const MOVEIS = {
  lareira(n) {
    const g = new THREE.Group(), pedra = mat(0x9aa1b0, { roughness: 0.95 });
    g.add(mesh(rbox(2.8, 2.4, 0.9, 0.08), pedra, 0, 1.2, 0));
    g.add(mesh(rbox(3.2, 0.25, 1.1, 0.05), mat(0x5a3420), 0, 2.45, 0.05));
    g.add(mesh(new THREE.BoxGeometry(1.5, 1.2, 0.5), mat(0x15100c), 0, 0.75, 0.25));
    const fogo = new THREE.Group(); fogo.position.set(0, 0.25, 0.35);
    [[0, 0.55, 0.28, [5, 1.6, 0.3]], [-0.25, 0.4, 0.2, [5, 2.6, 0.6]], [0.25, 0.42, 0.2, [5, 2.2, 0.5]]].forEach(([x, h, r, c]) => { const f = mesh(new THREE.ConeGeometry(r, h, 8), bulbMat.clone(), x, h / 2, 0); f.material.color.setRGB(...c); fogo.add(f); });
    for (const x of [-0.3, 0.3]) { const l = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.8, 6), mat(0x5a3a26), x * 0.6, 0.08, 0); l.rotation.z = Math.PI / 2 + x; fogo.add(l); }
    g.add(fogo); g.userData.fogo = fogo;
    if (n >= 2) for (const x of [-0.9, 0, 0.9]) { const m = new THREE.Group(); m.position.set(x, 2.25, 0.55); m.add(mesh(rbox(0.35, 0.6, 0.12, 0.04), mat(0xd8333a), 0, -0.3, 0)); m.add(mesh(rbox(0.38, 0.14, 0.14, 0.04), snowMat, 0, -0.02, 0)); m.add(mesh(rbox(0.3, 0.18, 0.12, 0.04), mat(0xd8333a), 0.12, -0.6, 0)); g.add(m); }
    if (n >= 3) {
      const pts = []; for (let i = 0; i <= 20; i++) { const t = i / 20; pts.push(V3(-1.5 + t * 3, 2.55 - Math.sin(t * Math.PI) * 0.3, 0.55)); }
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.12, 6), mat(0x2f7a46, { roughness: 0.9 })));
      for (const x of [-1.2, 1.2]) { const c = candle(); c.position.set(x, 2.58, 0.1); g.add(c); }
    }
    return g;
  },
  sofa(n) {
    const g = new THREE.Group(), tec = fabric(n, [0x8a6a4a, 0xb02a35, 0x9e2030]), w = n >= 3 ? 3.4 : 2.8;
    g.add(mesh(rbox(w, 0.5, 1.2, 0.15), tec, 0, 0.45, 0));
    g.add(mesh(rbox(w, 1, 0.3, 0.12), tec, 0, 1.0, -0.5));
    for (const s of [-1, 1]) g.add(mesh(rbox(0.3, 0.75, 1.2, 0.12), tec, s * (w / 2 - 0.1), 0.65, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.25, 6), mat(0x3a2414), sx * (w / 2 - 0.2), 0.12, sz * 0.45));
    if (n >= 2) for (const x of [-0.8, 0.8]) { const c = mesh(rbox(0.6, 0.55, 0.2, 0.1), mat(x < 0 ? 0xf2d38a : 0x2f7a46, { roughness: 0.95 }), x, 1.0, -0.25); c.rotation.x = -0.25; g.add(c); }
    if (n >= 3) { const m = mesh(rbox(1.2, 0.08, 1.3, 0.04), new THREE.MeshStandardMaterial({ map: xadrezTex, roughness: 0.95 }), 0.9, 0.75, 0.05); m.rotation.z = 0.1; g.add(m); }
    return g;
  },
  mesa(n) {
    const g = new THREE.Group(), madeira = mat(0x6b4226, { roughness: 0.7 });
    g.add(mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.1, 24), madeira, 0, 0.62, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.6, 10), madeira, 0, 0.3, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.4, 0.45, 0.06, 16), madeira, 0, 0.03, 0));
    const caneca = mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.24, 12), mat(0xd8333a), 0.35, 0.79, 0.2); g.add(caneca);
    if (n >= 2) {
      g.add(mesh(new THREE.CylinderGeometry(0.35, 0.3, 0.04, 20), mat(0xffffff, { roughness: 0.4 }), -0.25, 0.69, -0.1));
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 12), mat(0xc98a4b), -0.25 + Math.cos(a) * 0.17, 0.73 + (i % 2) * 0.03, -0.1 + Math.sin(a) * 0.17)); }
      g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.3, 12), mat(0xf8f8f8, { roughness: 0.3 }), 0.4, 0.82, -0.3));
    }
    if (n >= 3) {
      g.add(mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.28, 20), mat(0x6b3a22), 0.05, 0.81, 0.4));
      g.add(mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.06, 20), mat(0xfff7f0), 0.05, 0.96, 0.4));
      const c = candle(); c.scale.setScalar(0.7); c.position.set(0.05, 0.99, 0.4); g.add(c);
    }
    return g;
  },
  tapete(n) {
    const g = new THREE.Group();
    if (n === 1) g.add(mesh(rbox(2.4, 0.03, 1.6, 0.01), mat(0xd8c3a0, { roughness: 1 }), 0, 0.015, 0));
    else if (n === 2) g.add(mesh(rbox(3.4, 0.03, 2.4, 0.01), new THREE.MeshStandardMaterial({ map: tapeteTex, roughness: 1 }), 0, 0.015, 0));
    else { const c = mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.03, 40), new THREE.MeshStandardMaterial({ map: tapeteTex, roughness: 1 }), 0, 0.015, 0); g.add(c); }
    return g;
  },
  cama(n) {
    const g = new THREE.Group(), madeira = mat(0x6b4226, { roughness: 0.7 });
    g.add(mesh(rbox(1.8, 0.4, 2.8, 0.06), madeira, 0, 0.3, 0));
    g.add(mesh(rbox(1.9, 1.3, 0.2, 0.06), madeira, 0, 0.75, -1.4));
    g.add(mesh(rbox(1.7, 0.3, 2.6, 0.12), mat(0xf6f1e8, { roughness: 0.95 }), 0, 0.65, 0));
    g.add(mesh(rbox(1.2, 0.22, 0.5, 0.1), mat(0xffffff, { roughness: 0.95 }), 0, 0.88, -1));
    if (n >= 2) g.add(mesh(rbox(1.8, 0.12, 1.8, 0.05), n >= 3 ? new THREE.MeshStandardMaterial({ map: xadrezTex, roughness: 0.95 }) : mat(0xb02a35, { roughness: 0.95 }), 0, 0.84, 0.4));
    if (n >= 3) for (const sx of [-1, 1]) for (const sz of [-1, 1]) { g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8), madeira, sx * 0.85, 1.4, sz * 1.3)); }
    return g;
  },
  estante(n) {
    const g = new THREE.Group(), madeira = mat(0x5a3420, { roughness: 0.8 });
    g.add(mesh(new THREE.BoxGeometry(2.2, 2.8, 0.08), mat(0x2a1a10), 0, 1.4, -0.31));
    for (const x of [-1.05, 1.05]) g.add(mesh(new THREE.BoxGeometry(0.1, 2.8, 0.7), madeira, x, 1.4, 0));
    for (const y of [0.05, 2.75]) g.add(mesh(new THREE.BoxGeometry(2.2, 0.1, 0.7), madeira, 0, y, 0));
    const cores = [0xd8333a, 0x2f7a46, 0xf2d38a, 0x4f7fe0, 0x8a5cc8, 0xe0902a];
    const prateleiras = [0.55, 1.35, 2.15];
    prateleiras.forEach((y, k) => {
      g.add(mesh(new THREE.BoxGeometry(2, 0.06, 0.5), madeira, 0, y - 0.32, 0.12));
      const qtd = k < n ? 8 : 2;
      for (let i = 0; i < qtd; i++) { const h = 0.45 + ((i * 7) % 3) * 0.07; g.add(mesh(new THREE.BoxGeometry(0.14, h, 0.36), mat(cores[(i + k) % 6], { roughness: 0.8 }), -0.85 + i * 0.17, y - 0.29 + h / 2, 0.15)); }
    });
    if (n >= 3) { const gf = makeGift(0.35, 0xd8333a, 0xffd166); gf.position.set(0.7, 2.15 - 0.29, 0.15); g.add(gf); }
    return g;
  },
  poltrona(n) {
    const g = new THREE.Group(), tec = fabric(n, [0x4f6a8a, 0x2f7a46, 0x2f7a46]);
    g.add(mesh(rbox(1.3, 0.5, 1.2, 0.15), tec, 0, 0.45, 0));
    g.add(mesh(rbox(1.3, 1.3, 0.3, 0.12), tec, 0, 1.1, -0.5));
    for (const s of [-1, 1]) g.add(mesh(rbox(0.25, 0.8, 1.2, 0.1), tec, s * 0.6, 0.7, 0));
    if (n >= 2) g.add(mesh(rbox(0.7, 0.6, 0.2, 0.1), mat(0xd8333a, { roughness: 0.95 }), 0, 1.05, -0.3));
    if (n >= 3) {
      const lampada = new THREE.Group(); lampada.position.set(1.1, 0, -0.4);
      lampada.add(mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.06, 12), darkMat, 0, 0.03, 0));
      lampada.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 2, 8), darkMat, 0, 1, 0));
      lampada.add(mesh(new THREE.CylinderGeometry(0.3, 0.45, 0.5, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0xf2d38a, emissive: 0xffb050, emissiveIntensity: 1.6, side: THREE.DoubleSide }), 0, 2.1, 0));
      g.add(lampada);
    }
    return g;
  },
  arvorinha(n) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.4, 0.32, 0.5, 12), mat(0xd8333a), 0, 0.25, 0));
    const t = makeTree({ luzes: n >= 2 ? 1 : 0, bolas: n, estrela: n >= 3 ? 1 : 0, presentes: n >= 3 ? 1 : 0 });
    t.scale.setScalar(0.28); t.position.y = 0.4; g.add(t);
    return g;
  },
};

function criarSala() {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x120c14);
  s.add(new THREE.HemisphereLight(0xffe2c0, 0x3a2418, 1.1));
  const sol = new THREE.DirectionalLight(0xffd6a8, 0.8); sol.position.set(6, 10, 8); sol.castShadow = true;
  sol.shadow.mapSize.set(1024, 1024); Object.assign(sol.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 }); s.add(sol);
  const fogoLuz = new THREE.PointLight(0xff8a3a, 0, 9, 2); fogoLuz.position.set(MOVEIS_POS.lareira.x, 1, MOVEIS_POS.lareira.z + 1); s.add(fogoLuz);
  const S = 5;
  const chao = mesh(rbox(S * 2, 0.3, S * 2, 0.05), new THREE.MeshStandardMaterial({ map: woodFloorTex, roughness: 0.8 }), 0, -0.15, 0); chao.receiveShadow = true; s.add(chao);
  const paredeM = new THREE.MeshStandardMaterial({ map: wallpaperTex, roughness: 0.9 });
  const fundo = mesh(new THREE.BoxGeometry(S * 2, 5, 0.3), paredeM, 0, 2.5, -S - 0.15); fundo.receiveShadow = true; s.add(fundo);
  const lado = mesh(new THREE.BoxGeometry(0.3, 5, S * 2), paredeM, -S - 0.15, 2.5, 0); lado.receiveShadow = true; s.add(lado);
  const roda = mat(0x5a3420); s.add(mesh(new THREE.BoxGeometry(S * 2, 0.3, 0.1), roda, 0, 0.15, -S + 0.02)); s.add(mesh(new THREE.BoxGeometry(0.1, 0.3, S * 2), roda, -S + 0.02, 0.15, 0));
  // janela com a noite lá fora
  const jan = new THREE.Group(); jan.position.set(2.2, 2.6, -S + 0.02);
  jan.add(mesh(new THREE.PlaneGeometry(1.8, 1.6), new THREE.MeshBasicMaterial({ color: 0x2b4a9a }), 0, 0, 0.01));
  for (let i = 0; i < 14; i++) jan.add(mesh(new THREE.CircleGeometry(0.03, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), R(-0.8, 0.8), R(-0.7, 0.7), 0.02));
  const fr = mat(0xf1ece2); [[0, 0.85, 2.1, 0.14], [0, -0.85, 2.1, 0.14], [-0.98, 0, 0.14, 1.8], [0.98, 0, 0.14, 1.8], [0, 0, 0.07, 1.6], [0, 0, 1.8, 0.07]].forEach(([x, y, w, h]) => jan.add(mesh(new THREE.BoxGeometry(w, h, 0.12), fr, x, y, 0.06)));
  jan.add(mesh(rbox(2.3, 0.15, 0.35, 0.06), fr, 0, -0.95, 0.15));
  s.add(jan);
  // pisca-pisca na parede de fundo
  const fio = new THREE.Group(); addString(fio, V3(-S + 0.3, 4.6, -S + 0.2), V3(S - 0.3, 4.6, -S + 0.2), 0.5, 26); addString(fio, V3(-S + 0.2, 4.6, -S + 0.3), V3(-S + 0.2, 4.6, S - 0.3), 0.5, 26); s.add(fio);
  // marcadores dos lugares vazios
  const marcaM = new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false });
  const marcas = {};
  for (const [k, pos] of Object.entries(MOVEIS_POS)) { if (k === 'tapete') continue; const m = mesh(new THREE.RingGeometry(0.55, 0.65, 32), marcaM, pos.x, 0.03, pos.z); m.rotation.x = -Math.PI / 2; s.add(m); marcas[k] = m; }
  return { scene: s, fogoLuz, marcas, moveis: new Map(), raiz: new THREE.Group() };
}

// ---------- vida da vila: carros, trem, moradores, Papai Noel ----------
const vidroMat = mat(0x1d2a4a, { roughness: 0.15, metalness: 0.4 });
const pneuMat = mat(0x1a1a22, { roughness: 0.9 });
function farol(g, x, y, z, cor, s = 0.12) { const b = mesh(new THREE.SphereGeometry(s, 8, 6), bulbMat.clone(), x, y, z); b.material.color.setRGB(...cor); b.userData.noShadow = true; g.add(b); return b; }

function makeCar(cor, comArvore) {
  const g = new THREE.Group(), lata = mat(cor, { roughness: 0.35, metalness: 0.3 });
  g.add(mesh(rbox(2.6, 0.7, 1.3, 0.25, 3), lata, 0, 0.6, 0));
  g.add(mesh(rbox(1.5, 0.62, 1.16, 0.22, 3), vidroMat, -0.15, 1.15, 0));
  g.add(mesh(rbox(1.35, 0.14, 1.05, 0.06), lata, -0.15, 1.5, 0));
  g.add(mesh(rbox(1.3, 0.16, 1.0, 0.07), snowMat, -0.15, 1.6, 0));
  for (const x of [-0.85, 0.85]) for (const z of [-0.62, 0.62]) { const w = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.22, 14), pneuMat, x, 0.3, z); w.rotation.x = Math.PI / 2; g.add(w); }
  for (const z of [-0.42, 0.42]) { farol(g, 1.31, 0.68, z, [5, 4.6, 3.2]); farol(g, -1.31, 0.68, z, [4, 0.3, 0.3], 0.09); }
  const feixe = mesh(new THREE.PlaneGeometry(4, 2.2), poolMat, 3.1, 0.06, 0); feixe.rotation.x = -Math.PI / 2; feixe.userData.noShadow = true; g.add(feixe);
  if (comArvore) { const p = makePine(0.2); p.rotation.z = Math.PI / 2; p.position.set(0.6, 1.85, 0); g.add(p); }
  return g;
}

function makeLocomotiva() {
  const g = new THREE.Group(), preto = mat(0x1d1d24, { roughness: 0.5, metalness: 0.4 }), vermelho = mat(0xb8242c, { roughness: 0.4, metalness: 0.2 }), ouro = mat(0xe8b13a, { metalness: 0.7, roughness: 0.3 });
  g.add(mesh(rbox(5.2, 0.5, 1.8, 0.1), preto, 0, 0.9, 0));
  const caldeira = mesh(new THREE.CylinderGeometry(0.8, 0.8, 3.2, 20), vermelho, 0.9, 1.9, 0); caldeira.rotation.z = Math.PI / 2; g.add(caldeira);
  for (const x of [-0.1, 0.9, 1.9]) { const a = mesh(new THREE.TorusGeometry(0.82, 0.06, 6, 20), ouro, x, 1.9, 0); a.rotation.y = Math.PI / 2; g.add(a); }
  g.add(mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.2, 20), preto, 2.55, 1.9, 0).rotateZ(Math.PI / 2));
  g.add(mesh(new THREE.CylinderGeometry(0.3, 0.22, 1.1, 12), preto, 1.9, 3.1, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.45, 0.3, 0.3, 12), preto, 1.9, 3.7, 0));
  g.add(mesh(rbox(1.8, 2.2, 1.9, 0.1), vermelho, -1.6, 2.1, 0));
  g.add(mesh(rbox(2.2, 0.2, 2.2, 0.08), preto, -1.6, 3.3, 0));
  g.add(mesh(rbox(2.2, 0.25, 2.2, 0.1), snowMat, -1.6, 3.45, 0));
  for (const z of [-0.96, 0.96]) g.add(mesh(new THREE.PlaneGeometry(0.9, 0.7), glowMat, -1.6, 2.4, z * 1.001).rotateY(z > 0 ? 0 : Math.PI));
  farol(g, 2.7, 2.5, 0, [5, 4.4, 2.6], 0.22);
  const limpa = mesh(new THREE.ConeGeometry(0.9, 0.9, 4), ouro, 2.9, 0.7, 0); limpa.rotation.z = -Math.PI / 2; limpa.scale.set(1, 0.7, 1.1); g.add(limpa);
  for (const x of [-1.6, 0.2, 1.6]) for (const z of [-0.95, 0.95]) { const r = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.15, 16), vermelho, x, 0.6, z); r.rotation.x = Math.PI / 2; g.add(r); }
  g.userData.chamine = V3(1.9, 4, 0);
  return g;
}
function makeVagao(carga) {
  const g = new THREE.Group(), madeira = mat(0x6b4226, { roughness: 0.8 }), preto = mat(0x1d1d24, { roughness: 0.5, metalness: 0.4 });
  g.add(mesh(rbox(3.6, 0.35, 1.8, 0.08), preto, 0, 0.85, 0));
  g.add(mesh(rbox(3.6, 0.7, 1.8, 0.08), madeira, 0, 1.35, 0));
  for (const x of [-1.1, 1.1]) for (const z of [-0.95, 0.95]) { const r = mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.15, 14), preto, x, 0.55, z); r.rotation.x = Math.PI / 2; g.add(r); }
  if (carga === 'arvore') { const p = makePine(0.45); p.position.set(0, 1.7, 0); g.add(p); }
  else [[-1, 0.3, 0.9, 0xd8333a, 0xffd166], [0.1, -0.2, 0.8, 0x2f9e5b, 0xffffff], [1.1, 0.25, 0.7, 0x4f7fe0, 0xffd166], [0.2, 0.4, 0.5, 0xf2a93b, 0xd8333a]].forEach(([x, z, s, c, r]) => { const gf = makeGift(s, c, r); gf.position.set(x, 1.7, z); gf.rotation.y = x; g.add(gf); });
  addString(g, V3(-1.8, 1.75, 0.92), V3(1.8, 1.75, 0.92), 0.15, 10);
  return g;
}
function makeTrem() {
  const g = new THREE.Group(), loco = makeLocomotiva(); g.add(loco);
  ['presentes', 'arvore', 'presentes', 'arvore'].forEach((c, i) => { const v = makeVagao(c); v.position.x = -5.4 - i * 4; g.add(v); });
  g.userData.chamine = loco.userData.chamine;
  return g;
}

function makePessoa(casaco, gorro) {
  const g = new THREE.Group(), skin = mat([0xf3c29b, 0xd9a07a, 0x9c6a48][Math.floor(rnd() * 3)], { roughness: 0.6 }), c = mat(casaco, { roughness: 0.85 });
  const legs = [-0.14, 0.14].map(x => { const l = new THREE.Group(); l.position.set(x, 0.75, 0); l.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.65, 8), mat(0x2a3048), 0, -0.32, 0)); const b = mesh(new THREE.SphereGeometry(0.13, 8, 6), mat(0x3a2414), 0, -0.68, 0.05); b.scale.set(1, 0.6, 1.4); l.add(b); g.add(l); return l; });
  g.add(mesh(new THREE.CapsuleGeometry(0.32, 0.55, 4, 12), c, 0, 1.15, 0));
  const arms = [-1, 1].map(s => { const a = new THREE.Group(); a.position.set(s * 0.36, 1.45, 0); a.add(mesh(new THREE.CapsuleGeometry(0.09, 0.42, 3, 8), c, 0, -0.26, 0)); a.add(mesh(new THREE.SphereGeometry(0.09, 8, 8), mat(0xd8333a), 0, -0.52, 0)); a.rotation.z = s * 0.15; g.add(a); return a; });
  const cachecol = mesh(new THREE.TorusGeometry(0.22, 0.08, 8, 16), mat(gorro, { roughness: 0.9 }), 0, 1.62, 0); cachecol.rotation.x = Math.PI / 2; g.add(cachecol);
  g.add(mesh(new THREE.SphereGeometry(0.28, 18, 14), skin, 0, 1.92, 0));
  for (const s of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.035, 6, 6), mat(0x1d1d24), s * 0.1, 1.95, 0.25));
  const touca = mesh(new THREE.SphereGeometry(0.3, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(gorro, { roughness: 0.9 }), 0, 1.98, 0); g.add(touca);
  g.add(mesh(new THREE.SphereGeometry(0.1, 8, 8), snowMat, 0, 2.3, 0));
  const caixa = makeGift(0.45, 0xd8333a, 0xffd166); caixa.position.set(0, 0.95, 0.42); caixa.visible = false; g.add(caixa);
  g.userData = { legs, arms, caixa };
  return shadowAll(g);
}

function makeEscada() {
  const g = new THREE.Group(), m = mat(0x8a5a3c, { roughness: 0.8 });
  for (const x of [-0.35, 0.35]) g.add(mesh(new THREE.BoxGeometry(0.1, 4.2, 0.1), m, x, 2.1, 0));
  for (let i = 0; i < 8; i++) g.add(mesh(new THREE.BoxGeometry(0.7, 0.07, 0.08), m, 0, 0.35 + i * 0.5, 0));
  return shadowAll(g);
}

function makeRena(nariz) {
  const g = new THREE.Group(), pelo = mat(0x7a4a2a, { roughness: 0.9 }), chifre = mat(0xd8c3a0);
  const corpo = mesh(new THREE.CapsuleGeometry(0.32, 0.9, 4, 10), pelo, 0, 1.0, 0); corpo.rotation.z = Math.PI / 2; g.add(corpo);
  for (const x of [-0.4, 0.4]) for (const z of [-0.18, 0.18]) g.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.7, 6), pelo, x, 0.45, z));
  const pescoco = mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.6, 8), pelo, 0.65, 1.35, 0); pescoco.rotation.z = -0.6; g.add(pescoco);
  g.add(mesh(new THREE.SphereGeometry(0.22, 12, 10), pelo, 0.9, 1.65, 0));
  g.add(mesh(new THREE.SphereGeometry(0.12, 8, 8), pelo, 1.1, 1.6, 0));
  if (nariz) farol(g, 1.22, 1.6, 0, [6, 0.4, 0.3], 0.09); else g.add(mesh(new THREE.SphereGeometry(0.06, 6, 6), mat(0x1d1d24), 1.21, 1.6, 0));
  for (const z of [-0.12, 0.12]) { const c = mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.5, 5), chifre, 0.85, 2.0, z); c.rotation.x = z * 3; g.add(c); const r = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.25, 5), chifre, 0.95, 2.1, z * 1.6); r.rotation.z = -0.8; g.add(r); }
  return g;
}
function makeTreno() {
  const g = new THREE.Group(), vermelho = mat(0xc8202a, { roughness: 0.35, metalness: 0.2 }), ouro = mat(0xe8b13a, { metalness: 0.7, roughness: 0.3 });
  const treno = new THREE.Group(); g.add(treno);
  treno.add(mesh(rbox(2.2, 0.8, 1.3, 0.25, 3), vermelho, 0, 0.8, 0));
  treno.add(mesh(rbox(0.5, 1.2, 1.3, 0.2, 3), vermelho, -1.0, 1.1, 0));
  for (const z of [-0.6, 0.6]) {
    treno.add(mesh(new THREE.BoxGeometry(2.8, 0.08, 0.1), ouro, 0.1, 0.2, z));
    const ponta = mesh(new THREE.TorusGeometry(0.3, 0.05, 6, 12, Math.PI), ouro, 1.5, 0.5, z); ponta.rotation.z = -Math.PI / 2; treno.add(ponta);
    treno.add(mesh(new THREE.BoxGeometry(2.2, 0.08, 0.06), ouro, 0, 1.2, z * 1.09));
  }
  // Papai Noel
  const noel = new THREE.Group(); noel.position.set(-0.3, 1.0, 0); treno.add(noel);
  noel.add(mesh(new THREE.SphereGeometry(0.55, 16, 12), vermelho, 0, 0.5, 0));
  noel.add(mesh(new THREE.TorusGeometry(0.5, 0.08, 6, 20), mat(0x1d1d24), 0, 0.45, 0).rotateX(Math.PI / 2));
  noel.add(mesh(new THREE.SphereGeometry(0.3, 14, 12), mat(0xf3c29b), 0.05, 1.2, 0));
  const barba = mesh(new THREE.SphereGeometry(0.3, 12, 10), snowMat, 0.18, 1.0, 0); barba.scale.set(0.8, 1.1, 1); noel.add(barba);
  noel.add(mesh(new THREE.ConeGeometry(0.3, 0.6, 14), vermelho, -0.05, 1.6, 0).rotateZ(0.5));
  noel.add(mesh(new THREE.TorusGeometry(0.27, 0.07, 6, 16), snowMat, 0, 1.4, 0).rotateX(Math.PI / 2));
  noel.add(mesh(new THREE.SphereGeometry(0.1, 8, 8), snowMat, -0.35, 1.85, 0));
  const braco = mesh(new THREE.CapsuleGeometry(0.1, 0.5, 3, 8), vermelho, 0.45, 0.8, 0.3); braco.rotation.z = -1.2; noel.add(braco);
  for (const z of [-0.18, 0.18]) noel.add(mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.45, 8), mat(0x1d1d24), 0, -0.05, z));
  const bolsa = mesh(new THREE.SphereGeometry(0.32, 12, 10), new THREE.MeshStandardMaterial({ color: 0xffc94d, metalness: 0.6, roughness: 0.3, emissive: 0x3a2600 }), 0.55, 0.55, 0.35);
  bolsa.add(mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.18, 8), mat(0xc98f1a), 0, 0.32, 0)); bolsa.visible = false; noel.add(bolsa);
  noel.userData.bolsa = bolsa;
  // saco de presentes
  const saco = mesh(new THREE.SphereGeometry(0.6, 12, 10), mat(0x8a5a3c, { roughness: 0.95 }), -1.0, 1.9, 0); saco.scale.set(1, 1.1, 1); treno.add(saco);
  const gf = makeGift(0.4, 0x2f9e5b, 0xffd166); gf.position.set(-1.0, 2.4, 0.2); treno.add(gf);
  // renas
  const renas = [];
  [[3.2, -0.5, false], [3.2, 0.5, false], [5.2, -0.5, false], [5.2, 0.5, false], [7.2, 0, true]].forEach(([x, z, n]) => { const r = makeRena(n); r.position.set(x, -0.2, z); r.scale.setScalar(0.85); g.add(r); renas.push(r); });
  for (const z of [-0.5, 0.5]) { const pts = [V3(1.0, 1.1, z * 0.8), V3(7.4, 1.2, 0)]; g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 4, 0.025, 4), ouro)); }
  g.userData = { renas, treno, noel, assento: noel.position.clone() };
  return shadowAll(g);
}

// ---------- cena ----------
export async function criarCena(canvas) {
  for (const m of [snowMat, glowMat, frameMat, darkMat, stripeMat, bulbMat, wireMat, poolMat, vidroMat, pneuMat]) m.userData.compartilhado = true;
  bulbGeo.userData.compartilhado = true;
  await Promise.race([document.fonts.load('700 80px Fredoka'), new Promise(r => setTimeout(r, 1500))]).catch(() => {});
  makeSignTex();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));
  renderer.setSize(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight, false);
  renderer.info.autoReset = false; // conta os desenhos do quadro inteiro (bloom tem várias passadas)
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // no celular a sombra é refeita a cada 2 quadros (quase metade dos desenhos é dela)
  renderer.shadowMap.autoUpdate = false; let quadroSombra = 0;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x1d3270, 0.0068);
  const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.5, 1200);

  // céu com aurora e estrelas
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uTime: { value: 0 }, uClaro: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform float uTime; uniform float uClaro;
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
        col += ac * a * (0.6 + 0.6 * uClaro);
        vec2 sp = vec2(az * 110.0, h * 150.0); vec2 cell = floor(sp); float s = hash(cell); vec2 f = fract(sp) - 0.5;
        float star = step(0.986, s) * smoothstep(0.14, 0.0, length(f)) * smoothstep(0.1, 0.4, h);
        col += vec3(star) * (0.7 + 0.3 * sin(uTime * 2.0 + s * 60.0)) * (0.35 + 0.65 * uClaro);
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
  const borda = (MAPA_MAX - MEIO) * T; // mapa completo, com os terrenos de expansão
  // a rua principal atravessa a vila e segue pela floresta; o trem passa lá no fundo
  const RUA_Z = centroLote(0, RUAS[0].z, 1).z, TRILHO_Z = -(MAPA_MAX - MEIO) * T - 10, TRILHO_Y = 0.4;
  const hAt = (x, z) => {
    const d = Math.max(Math.abs(x), Math.abs(z)), S = THREE.MathUtils.smoothstep, dr = Math.hypot(x, z);
    const hill = S(dr, borda * 1.45, borda * 1.45 + 80) * 20 * (0.7 + 0.3 * Math.sin(x * 0.05 + z * 0.04));
    const n = Math.sin(x * 0.08) * Math.cos(z * 0.07) * 1.8 + Math.sin(x * 0.21 + z * 0.17) * 0.6;
    let h = hill + S(d, borda + 6, borda + 30) * n + S(d, borda + 1, borda + 6) * Math.sin(x * 0.35) * Math.sin(z * 0.3) * 0.25;
    h *= S(Math.abs(z - RUA_Z), 3, 8);
    const kt = 1 - S(Math.abs(z - TRILHO_Z), 3.5, 10);
    return h + (TRILHO_Y - h) * kt;
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
  const calcadas = new THREE.Group();
  RUAS.forEach((r, i) => {
    const w = r.w * T, h = r.h * T, c = centroLote(r.x, r.z, 1).add(V3((r.w - 1) * T / 2, 0, (r.h - 1) * T / 2));
    const alongX = r.w >= r.h, wid = (alongX ? h : w) * 0.72;
    let len = alongX ? w : h;
    if (r === RUAS[0]) { len = 320; c.x = 0; }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(wid, len), new THREE.MeshStandardMaterial({ map: rep(roadTex, 1, len / 6), roughness: 0.95 }));
    m.rotation.x = -Math.PI / 2; if (alongX) m.rotation.z = Math.PI / 2; m.position.set(c.x, 0.03 + i * 0.003, c.z); m.receiveShadow = true; scene.add(m);
    // calçadas dos dois lados (guia branca com neve)
    for (const sd of [-1, 1]) {
      const off = (wid / 2 + 0.22) * sd, cw = alongX ? len : 0.44, cd = alongX ? 0.44 : len;
      calcadas.add(caixa(cw, 0.12, cd, MR.calcada, c.x + (alongX ? 0 : off), 0.06, c.z + (alongX ? off : 0)));
    }
  });
  fundir(calcadas); scene.add(calcadas);

  // postes de rua (pretos, com lanterna) ao longo da rua principal
  {
    const postes = new THREE.Group(), RZ = centroLote(0, RUAS[0].z, 1).z;
    for (let x = -110; x <= 110; x += 12) for (const sd of [-1, 1]) {
      const pp = new THREE.Group(); pp.position.set(x + (sd > 0 ? 6 : 0), 0, RZ + sd * 1.55); pp.scale.setScalar(2.1);
      pp.add(mR(new THREE.CylinderGeometry(0.05, 0.07, 1.6, 8), MR.preto, 0, 0.8, 0));
      pp.add(caixa(0.24, 0.32, 0.24, MR.preto, 0, 1.75, 0));
      pp.add(mR(new THREE.BoxGeometry(0.17, 0.24, 0.17), MR.lampada, 0, 1.75, 0));
      pp.add(mR(new THREE.ConeGeometry(0.21, 0.16, 4), MR.preto, 0, 1.98, 0).rotateY(Math.PI / 4));
      pp.add(mR(new THREE.ConeGeometry(0.14, 0.1, 8), snowMat, 0, 2.08, 0));
      postes.add(pp);
    }
    fundir(postes); scene.add(postes);
  }

  // cerca em volta da vila (com abertura na rua da frente)
  {
    const wm = mat(0x4a3324, { roughness: 0.9 }), posts = [], step = 2.5, e = borda + 1.2;
    for (let s = -e; s <= e + 0.01; s += step) { posts.push([s, -e]); if (Math.abs(s - RUA_Z) > 3) posts.push([-e, s], [e, s]); if (Math.abs(s) > 3) posts.push([s, e]); }
    const pGeo = rbox(0.28, 1.5, 0.28, 0.05), cGeo = rbox(0.38, 0.2, 0.38, 0.09);
    const ip = new THREE.InstancedMesh(pGeo, wm, posts.length), ic = new THREE.InstancedMesh(cGeo, snowMat, posts.length), m4 = new THREE.Matrix4();
    posts.forEach(([x, z], i) => { m4.makeTranslation(x, 0.75, z); ip.setMatrixAt(i, m4); m4.makeTranslation(x, 1.58, z); ic.setMatrixAt(i, m4); });
    ip.castShadow = true; scene.add(ip, ic);
    const rail = (x1, z1, x2, z2) => { const len = Math.hypot(x2 - x1, z2 - z1); for (const [y, mm, hh] of [[1.15, wm, 0.18], [0.6, wm, 0.18], [1.28, snowMat, 0.1]]) { const r = mesh(rbox(len, hh, 0.14, 0.04), mm, (x1 + x2) / 2, y, (z1 + z2) / 2); r.rotation.y = -Math.atan2(z2 - z1, x2 - x1); scene.add(r); } };
    rail(-e, -e, e, -e); rail(-e, e, -3.5, e); rail(3.5, e, e, e);
    for (const x of [-e, e]) { rail(x, -e, x, RUA_Z - 3.2); rail(x, RUA_Z + 3.2, x, e); }
  }

  // floresta (instanciada)
  {
    const pts = [];
    while (pts.length < (coarse ? 380 : 620)) {
      const a = R(0, Math.PI * 2), d = R(borda + 6, 150), x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.max(Math.abs(x), Math.abs(z)) < borda + 5) continue;
      if (Math.abs(z - RUA_Z) < 6.5 || (z > TRILHO_Z - 7.5 && z < -borda - 3)) continue;
      if (Math.abs(z - RUA_Z) < 17 && Math.abs(x) > borda + 6 && Math.abs(x) < borda + 82) continue; // bairro vizinho
      if (z > borda && Math.abs(x) < 6 && d < 55) continue;
      if (Math.abs(Math.atan2(z, x) - 0.86) < 0.55 && d < 65) continue;
      pts.push([x, z, R(1.0, 2.0) * (d > 60 ? 1.4 : 1)]);
    }
    const parts = [
      [new THREE.CylinderGeometry(0.25, 0.35, 1.2, 6), mat(0x5a3a26), 0.6, false],
      [coneGalhos(2.2, 3.0, 8, 1), mat(0xffffff, { roughness: 0.9 }), 2.4, true],
      [coneGalhos(1.7, 2.6, 8, 2), mat(0xffffff, { roughness: 0.9 }), 3.9, true],
      [coneGalhos(1.15, 2.2, 7, 3), mat(0xffffff, { roughness: 0.9 }), 5.2, true],
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

  // bairro vizinho: casas iluminadas e uma igreja dos dois lados da estrada, fora da cerca
  {
    const RZ = centroLote(0, RUAS[0].z, 1).z;
    let k = 0;
    for (const lado of [-1, 1]) for (let i = 0; i < 5; i++) for (const sd of [-1, 1]) {
      const x = lado * (borda + 14 + i * 11), z = RZ + sd * 9;
      const casa = makeHouse({ id: 'viz' + (k++), nv: 1 + ((i + k) % 3), itens: { pisca: 1 + (k % 2), guirlanda: 1, jardim: k % 3 ? 1 : 2 } });
      casa.position.set(x, hAt(x, z), z); casa.rotation.y = sd > 0 ? Math.PI : 0; casa.scale.setScalar(1.15);
      casa.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
      scene.add(casa);
    }
    // igreja com torre (o mesmo modelo que o jogador pode construir)
    const x = -(borda + 74), z = RZ - 11, ig = makeIgreja();
    ig.position.set(x, hAt(x, z), z); ig.scale.setScalar(1.3); ig.rotation.y = Math.PI / 2;
    ig.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    scene.add(ig);
  }

  // trilho e trem
  {
    const trilhoM = mat(0x6a7080, { metalness: 0.6, roughness: 0.4 });
    for (const dz of [-0.75, 0.75]) scene.add(mesh(new THREE.BoxGeometry(420, 0.12, 0.12), trilhoM, 0, TRILHO_Y + 0.28, TRILHO_Z + dz));
    const n = 280, dorm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.16, 2.2), mat(0x4a3324, { roughness: 0.9 }), n), m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) { m4.makeTranslation(-210 + i * 1.5, TRILHO_Y + 0.15, TRILHO_Z); dorm.setMatrixAt(i, m4); }
    dorm.receiveShadow = true; scene.add(dorm);
  }
  const trem = makeTrem(); trem.position.set(-200, TRILHO_Y + 0.05, TRILHO_Z); trem.scale.setScalar(1.25); scene.add(trem);
  const fumacaTrem = [];
  for (let i = 0; i < 12; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xdfe6f6, transparent: true, depthWrite: false, opacity: 0 })); s.userData.life = i / 12; scene.add(s); fumacaTrem.push(s); }

  // carros na rua principal (dois sentidos)
  const carros = [];
  [[0xd8333a, true, 1, 0], [0x1d3a6e, false, -1, 1], [0x2f9e5b, false, 1, 0], [0xf2a93b, true, -1, 0], [0x202226, false, 1, 1], [0xc0182c, false, -1, 1], [0xe8e8ea, false, 1, 1], [0x8a5cc8, true, -1, 0]].forEach(([cor, arv, sent, esportivo], i) => {
    const c = esportivo ? (() => { const g = new THREE.Group(), e = carroEsportivo(cor); e.scale.setScalar(0.62); g.add(e); const f = mesh(new THREE.PlaneGeometry(4, 2.2), poolMat, 3.1, 0.06, 0); f.rotation.x = -Math.PI / 2; g.add(f); return g; })() : makeCarReal(cor, arv, i % 3 === 2);
    c.traverse(m => { if (m.isMesh) m.castShadow = !m.userData.noShadow; });
    c.userData.sentido = sent; c.userData.vel = R(7, 10); c.position.set(-150 + i * 40, 0, RUA_Z + sent * 0.75); c.rotation.y = sent > 0 ? 0 : Math.PI;
    scene.add(c); carros.push(c);
  });

  // moradores (passeiam; quando tem enfeite pra pôr na árvore, vão lá pendurar)
  const escada = makeEscada(); escada.visible = false; scene.add(escada);
  const moradores = [[0xb8242c, 0xf2f2f2], [0x2f5d9e, 0xffc94d], [0x3a7a4a, 0xd8333a], [0x8a5cc8, 0xf2f2f2]].map(([c, g], i) => {
    const o = makePessoa(c, g); o.scale.setScalar(0.85); o.position.set(R(-15, 15), 0, RUA_Z + R(-1.5, 1.5)); scene.add(o);
    return { obj: o, alvo: o.position.clone(), troca: 0, idx: i };
  });

  // Papai Noel
  const treno = makeTreno(); treno.visible = false; treno.scale.setScalar(0.85); scene.add(treno);
  const noel = { voando: false, rota: [], i: 0, fase: 'ir', tempo: 0, aoChegar: null };
  const figura = treno.userData.noel;
  const fuligem = [];
  for (let i = 0; i < 8; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0x6a6f80, transparent: true, depthWrite: false, opacity: 0 })); sp.visible = false; scene.add(sp); fuligem.push(sp); }
  const brilhoN = 60, brilhoGeo = new THREE.BufferGeometry(), brilhoPos = new Float32Array(brilhoN * 3), brilhoVida = new Float32Array(brilhoN);
  brilhoGeo.setAttribute('position', new THREE.BufferAttribute(brilhoPos, 3));
  const brilho = new THREE.Points(brilhoGeo, new THREE.PointsMaterial({ size: 0.5, map: flakeTex, color: 0xffd76a, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
  scene.add(brilho); let brilhoI = 0;
  const presentesCaindo = [];
  function papaiNoel(alvos, aoChegar, opcoes = {}) {
    if (noel.voando) return false;
    const lado = rnd() < 0.5 ? -1 : 1;
    // em cada casa: pousa no telhado (do lado oposto à chaminé), desce pela chaminé e volta
    const paradas = alvos.map(a => {
      const e = predios.get(a.id); if (!e) return null;
      const c = e.obj.position, ch = a.pos.clone();
      const dir = V3(c.x - ch.x, 0, c.z - ch.z); if (dir.lengthSq() < 0.01) dir.set(1, 0, 0); dir.normalize();
      const pouso = V3(c.x + dir.x * 1.2, ch.y - 0.75, c.z + dir.z * 1.2);
      return { id: a.id, chamine: ch, pouso, acima: pouso.clone().add(V3(0, 7, 0)) };
    }).filter(Boolean);
    noel.rota = [...paradas, { fim: true, acima: V3(150 * lado, 24, 50) }];
    noel.i = 0; noel.fase = 'ir'; noel.tempo = 0; noel.voando = true; noel.aoChegar = aoChegar;
    treno.position.set(-150 * lado, 22, -40); treno.visible = true;
    if (opcoes.perto && paradas[0]) treno.position.copy(paradas[0].acima).add(V3(-12, 0, 0)); // só pros testes
    return true;
  }
  function chamineDe(id) { const e = predios.get(id); if (!e || !e.obj.userData.smoke) return null; e.obj.updateMatrixWorld(true); return e.obj.localToWorld(e.obj.userData.smoke[0].clone()).add(V3(0, -0.6, 0)); }

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
    for (let i = 0; i <= MAPA_MAX - MAPA_MIN; i++) { const p = (MAPA_MIN + i - MEIO) * T; lines.push(p, y, -borda, p, y, borda, -borda, y, p, borda, y, p); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    gradeGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 })));
  }
  const footMat = new THREE.MeshBasicMaterial({ color: 0x5cd6a6, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false });
  const foot = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), footMat); foot.rotation.x = -Math.PI / 2; foot.visible = false; scene.add(foot);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.visible = false; scene.add(ring);

  // pós-processamento
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
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
    camera.aspect = (canvas.clientWidth || innerWidth) / (canvas.clientHeight || innerHeight);
    camera.fov = camera.aspect < 1 ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(19)) / camera.aspect)) : 36;
    camera.updateProjectionMatrix();
  }
  enquadrar();
  camera.position.copy(controls.target).add(V3(34, 30, 42).multiplyScalar(camera.aspect < 1 ? 0.8 : 0.85));
  controls.update();

  // ---------- interior da casa ----------
  const sala = criarSala(); sala.scene.add(sala.raiz);
  const salaCam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100);
  const salaControls = new OrbitControls(salaCam, renderer.domElement);
  salaControls.enabled = false; salaControls.enableDamping = true; salaControls.enablePan = false;
  salaControls.minDistance = 7; salaControls.maxDistance = 18; salaControls.minPolarAngle = 0.5; salaControls.maxPolarAngle = 1.2;
  salaControls.minAzimuthAngle = -0.1; salaControls.maxAzimuthAngle = Math.PI / 2 + 0.1;
  salaControls.target.set(0, 1, 0);
  let modo = 'vila', casaAtual = null;
  const cam = () => (modo === 'casa' ? salaCam : camera);
  function enquadrarSala() {
    salaCam.aspect = (canvas.clientWidth || innerWidth) / (canvas.clientHeight || innerHeight);
    salaCam.fov = salaCam.aspect < 1 ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(24)) / salaCam.aspect)) : 42;
    salaCam.updateProjectionMatrix();
  }
  function sincSala(p) {
    const it = p.itens || {}, nvCasa = p.nv || 1;
    for (const k of Object.keys(MOVEIS_POS)) {
      const n = it[k] || 0, pos = MOVEIS_POS[k], atual = sala.moveis.get(k);
      if (!atual || atual.n !== n) {
        if (atual) { sala.raiz.remove(atual.obj); liberar(atual.obj); }
        if (n) {
          const obj = MOVEIS[k](n); obj.position.set(pos.x, 0, pos.z); obj.rotation.y = pos.r; obj.userData.item = k;
          obj.traverse(m => { if (m.isMesh) { m.castShadow = !m.userData.noShadow; m.receiveShadow = true; } });
          sala.raiz.add(obj); sala.moveis.set(k, { obj, n });
        } else sala.moveis.delete(k);
      }
      const marca = sala.marcas[k];
      if (marca) { const def = ITENS.casa[k]; marca.visible = !n && (!def.nivelCasa || nvCasa >= def.nivelCasa); }
    }
    sala.fogoLuz.intensity = it.lareira ? 14 + it.lareira * 6 : 0;
  }
  function entrarCasa(p) {
    modo = 'casa'; casaAtual = p.id;
    enquadrarSala();
    salaCam.position.set(7.5, 7, 9.5).multiplyScalar(salaCam.aspect < 1 ? 1.15 : 1); salaControls.target.set(0, 0.6, -0.5); salaControls.update();
    sincSala(p);
    renderPass.scene = sala.scene; renderPass.camera = salaCam;
    controls.enabled = false; salaControls.enabled = true;
  }
  function sairCasa() {
    modo = 'vila'; casaAtual = null;
    renderPass.scene = scene; renderPass.camera = camera;
    salaControls.enabled = false; controls.enabled = true;
  }
  function itemEm(cx, cy) {
    ndc.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1); ray.setFromCamera(ndc, salaCam);
    const hits = ray.intersectObjects([...sala.raiz.children, ...Object.values(sala.marcas).filter(m => m.visible)], true);
    for (const h of hits) {
      let o = h.object; while (o && !o.userData.item && o.parent) o = o.parent;
      if (o && o.userData.item) return o.userData.item;
      const marca = Object.entries(sala.marcas).find(([, m]) => m === h.object); if (marca) return marca[0];
    }
    return null;
  }
  function posItem(k) { const p = MOVEIS_POS[k]; return V3(p.x, k === 'tapete' ? 0.3 : 1.8, p.z); }

  // ---------- estado desenhado ----------
  const predios = new Map();    // id -> { obj, tipo, tam }
  // terrenos à venda: área amarela tracejada com placa; somem quando comprados
  const terrenosGrupo = new THREE.Group(); scene.add(terrenosGrupo);
  const loteVenda = new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.09, depthWrite: false, toneMapped: false });
  const bordaVenda = new THREE.LineDashedMaterial({ color: 0xffd76a, dashSize: 0.9, gapSize: 0.6, toneMapped: false });
  let chaveTerrenos = null;
  function sincTerrenos(vila) {
    const meus = vila.terrenos || [], chave = meus.join(',');
    if (chave === chaveTerrenos) return;
    chaveTerrenos = chave;
    for (const o of [...terrenosGrupo.children]) { terrenosGrupo.remove(o); if (o.geometry && o.geometry !== placaGeo) o.geometry.dispose(); }
    for (const t of TERRENOS) {
      if (meus.includes(t.id)) continue;
      const c = centroLote(t.x, t.z, t.w), L = t.w * T - 0.4;
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(L, L), loteVenda); pl.rotation.x = -Math.PI / 2; pl.position.set(c.x, 0.06, c.z); terrenosGrupo.add(pl);
      const bd = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(L, L)), bordaVenda); bd.computeLineDistances(); bd.rotation.x = -Math.PI / 2; bd.position.set(c.x, 0.09, c.z); terrenosGrupo.add(bd);
      const poste = new THREE.Mesh(placaGeo, placaMat); poste.position.set(c.x - L / 2 + 1.5, 1.2, c.z + L / 2 - 1.5); poste.castShadow = true; terrenosGrupo.add(poste);
    }
  }
  const placaGeo = new THREE.BoxGeometry(1.6, 1.0, 0.12), placaMat = mat(0xf4efe4);
  function centroTerreno(id) { const t = TERRENOS.find(x => x.id === id); if (!t) return null; const c = centroLote(t.x, t.z, t.w); return c.add(V3(0, 1.5, 0)); }
  const construtoresObj = [];
  const elfs = new Map();       // duende id -> { obj, alvo, ... }
  const raiz = new THREE.Group(); scene.add(raiz);
  let vilaAtual = null, praca = null;
  let fantasma = null;

  function posicionar(obj, p) {
    const tam = TIPOS[p.tipo].tam, c = centroLote(p.x, p.z, tam);
    obj.position.set(c.x, 0, c.z); obj.rotation.y = -(p.r || 0) * Math.PI / 2;
  }

  aoCarregarPronto = () => { for (const e of predios.values()) e.chave = ''; if (vilaAtual) sincronizar(vilaAtual); };
  function sincronizar(vila) {
    vilaAtual = vila;
    sincTerrenos(vila);
    const vivos = new Set();
    for (const p of vila.predios) {
      vivos.add(p.id);
      let e = predios.get(p.id);
      const chave = chaveModelo(p);
      if (!e || e.chave !== chave) { if (e) { raiz.remove(e.obj); liberar(e.obj); } const obj = criarModelo(p.tipo, p); obj.userData.predioId = p.id; raiz.add(obj); e = { obj, tipo: p.tipo, chave }; predios.set(p.id, e); }
      posicionar(e.obj, p);
      e.p = p;
    }
    for (const [id, e] of predios) if (!vivos.has(id)) { raiz.remove(e.obj); liberar(e.obj); predios.delete(id); }
    praca = vila.predios.find(p => p.tipo === 'praca') || null;
    const ePraca = praca && predios.get(praca.id);
    if (ePraca && ePraca.obj.userData.brilho) { const c = centroLote(praca.x, praca.z, 4); treeLight.position.set(c.x, 8.5, c.z); treeLight.intensity = ePraca.obj.userData.brilho; treeLight.visible = true; } else treeLight.visible = false;
    // chaminés
    raiz.updateMatrixWorld(true);
    chimneys = [];
    for (const e of predios.values()) for (const s of e.obj.userData.smoke || []) chimneys.push(e.obj.localToWorld(s.clone()));
    // duendes
    // na tela vão no máximo MAX_ELFOS (cada um tem ~16 peças): primeiro um por prédio,
    // depois os outros. Os demais continuam trabalhando, só não aparecem.
    const vivosD = new Set(), vistos = new Set(), lista = [];
    for (const d of vila.duendes) if (d.predio && !vistos.has(d.predio)) { vistos.add(d.predio); lista.push(d); }
    for (const d of vila.duendes) if (!lista.includes(d)) lista.push(d);
    lista.slice(0, MAX_ELFOS).forEach((d) => {
      const i = vila.duendes.indexOf(d);
      vivosD.add(d.id);
      if (!elfs.has(d.id)) {
        const obj = makeElf(ELF_CORES[i % ELF_CORES.length]);
        const start = praca ? centroLote(praca.x, praca.z, 4) : V3(0, 0, 0);
        obj.position.copy(start).add(V3(R(-4, 4), 0, R(3, 5)));
        scene.add(obj); elfs.set(d.id, { obj, alvo: obj.position.clone(), troca: 0, idx: i });
      }
      elfs.get(d.id).d = d;
    });
    for (const [id, e] of elfs) if (!vivosD.has(id)) { scene.remove(e.obj); liberar(e.obj); elfs.delete(id); }
    // duendes construtores: um por obra; os livres esperam perto da praça
    const qtd = vila.construtores || 1;
    while (construtoresObj.length < qtd) { const o = makeConstrutor(); const c = praca ? centroLote(praca.x, praca.z, 4) : V3(0, 0, 0); o.position.set(c.x - 6 - construtoresObj.length, 0, c.z + 4); scene.add(o); construtoresObj.push({ obj: o, alvo: o.position.clone(), idx: construtoresObj.length }); }
    const obras = vila.predios.filter(p => p.obra && p.obra.tipo !== 'enfeite' && p.obra.item === undefined);
    construtoresObj.forEach((b, i) => { b.obra = obras[i] || null; });
  }

  // ponto onde o duende trabalha: na frente do prédio, lado a lado
  function postoDeTrabalho(p, n) {
    const tam = TIPOS[p.tipo].tam, c = centroLote(p.x, p.z, tam), a = -(p.r || 0) * Math.PI / 2;
    const local = V3((n - 1) * 1.1, 0, tam * T / 2 + 0.9);
    local.applyAxisAngle(V3(0, 1, 0), a);
    return { pos: c.add(local), rot: a };
  }

  // ---------- fantasma (construir/mover) ----------
  function setFantasma(tipo, x, z, r, valido, modelo) {
    if (!tipo) {
      if (fantasma) { scene.remove(fantasma.obj); liberar(fantasma.obj); fantasma = null; }
      foot.visible = false; return;
    }
    if (!fantasma || fantasma.tipo !== tipo) {
      if (fantasma) { scene.remove(fantasma.obj); liberar(fantasma.obj); }
      const obj = criarModelo(tipo, modelo);
      obj.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.transparent = true; m.material.opacity = 0.82; m.castShadow = false; } });
      scene.add(obj); fantasma = { obj, tipo };
    }
    const tam = TIPOS[tipo].tam, c = centroLote(x, z, tam);
    fantasma.obj.position.set(c.x, 0.6, c.z); fantasma.obj.rotation.y = -(r || 0) * Math.PI / 2;
    foot.visible = true; foot.position.set(c.x, 0.12, c.z); foot.scale.set(tam * T, tam * T, 1);
    footMat.color.set(valido ? 0x5cd6a6 : 0xff5a5f);
  }

  // Desloca o que a câmera mostra (em px de tela) pra não ficar atrás de um painel.
  let desloc = [0, 0];
  function aplicarDesloc() {
    for (const c of [camera, salaCam]) {
      if (desloc[0] || desloc[1]) c.setViewOffset(innerWidth, innerHeight, desloc[0], desloc[1], innerWidth, innerHeight);
      else c.clearViewOffset();
    }
  }
  function setDeslocamento(dx, dy) { desloc = [dx, dy]; aplicarDesloc(); }
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
    const t = v.clone().project(cam());
    return { x: (t.x * 0.5 + 0.5) * innerWidth, y: (-t.y * 0.5 + 0.5) * innerHeight, visivel: t.z < 1 && Math.abs(t.x) < 1.1 && Math.abs(t.y) < 1.1 };
  }
  function topoDe(id) {
    const e = predios.get(id); if (!e) return null;
    return V3(e.obj.position.x, (e.obj.userData.altura || 5) + 1.2, e.obj.position.z);
  }
  function focar(id) {
    const e = predios.get(id); if (!e) return;
    const off = camera.position.clone().sub(controls.target);
    controls.target.set(e.obj.position.x, 0, e.obj.position.z + 1); camera.position.copy(controls.target).add(off);
  }

  // ---------- miniaturas pro menu ----------
  const VITRINE = { casa: { nv: 1, itens: { pisca: 1, guirlanda: 1 } }, praca: { itens: { luzes: 3, bolas: 3, festao: 2, presentes: 3, estrela: 1 } } };
  function miniaturas(tipos) {
    const tr = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    tr.setPixelRatio(1); tr.setSize(240, 180); tr.outputColorSpace = THREE.SRGBColorSpace; tr.toneMapping = THREE.ACESFilmicToneMapping;
    const s = new THREE.Scene(); s.add(new THREE.HemisphereLight(0xbcd0ff, 0x3a4a80, 2.2)); const dl = new THREE.DirectionalLight(0xffffff, 2); dl.position.set(5, 10, 8); s.add(dl);
    const cam = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 200), urls = {};
    for (const k of tipos) {
      const o = MODELOS[k](VITRINE[k]); o.traverse(m => { if (m.isMesh && m.material === poolMat) m.visible = false; });
      s.add(o); const box = new THREE.Box3().setFromObject(o), size = box.getSize(V3()), c = box.getCenter(V3()), dist = Math.max(size.x, size.y, size.z) * 2.1;
      cam.position.copy(c).add(V3(0.75, 0.55, 1).normalize().multiplyScalar(dist)); cam.lookAt(c);
      tr.render(s, cam); urls[k] = tr.domElement.toDataURL('image/png'); s.remove(o); liberar(o);
    }
    tr.dispose(); tr.forceContextLoss();
    return urls;
  }

  // ---------- clima ----------
  // Ciclo de 10 min igual pra todo mundo (pelo relógio): neve forte, parando, céu limpo
  // (aurora e estrelas mais fortes), começando, neve fraca. Transições suaves.
  let maxFlocos = flakeN;
  const CLIMA = [[0, 1], [170, 1], [230, 0], [400, 0], [440, 0.45], [540, 0.45], [600, 1]]; // [segundo do ciclo, intensidade]
  function intensidadeNeve(ms) {
    const sec = (ms / 1000) % 600;
    for (let i = 1; i < CLIMA.length; i++) if (sec <= CLIMA[i][0]) { const [a0, v0] = CLIMA[i - 1], [a1, v1] = CLIMA[i]; const k = THREE.MathUtils.smoothstep(sec, a0, a1); return v0 + (v1 - v0) * k; }
    return 1;
  }
  let neve = 1;

  // ---------- qualidade automática ----------
  // 2 = tudo; 1 = sem brilho (bloom) e resolução um pouco menor; 0 = também sem sombras e com
  // menos neve. Começa na melhor e desce sozinha se o aparelho cair abaixo de ~24 quadros por
  // segundo (o Modo de Pouca Energia do iPhone trava em 30 e não deve rebaixar). O automático
  // vale só pra sessão; o que o jogador escolhe em Ajustes fica gravado.
  const lerQ = () => { try { return localStorage.getItem('natal.qualidade2'); } catch { return null; } };
  const forcada = new URLSearchParams(location.search).get('qualidade') ?? lerQ();
  let qualidade = forcada != null ? Number(forcada) : 2;
  let medQuadros = 0, medTempo = 0, boas = 0, rebaixou = 0;
  function aplicarQualidade(q) {
    qualidade = Math.max(0, Math.min(2, q));
    bloom.enabled = qualidade >= 2;
    moon.castShadow = qualidade >= 1;
    renderer.setPixelRatio(Math.min(devicePixelRatio, [1.5, 1.75, 2][qualidade]));
    composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight);
    maxFlocos = qualidade === 0 ? Math.floor(flakeN / 3) : flakeN;
  }
  let escolhida = forcada != null;
  function escolherQualidade(q) {
    escolhida = true; aplicarQualidade(q);
    try { localStorage.setItem('natal.qualidade2', String(qualidade)); } catch { /* sem armazenamento */ }
  }
  aplicarQualidade(qualidade);
  function medirQualidade(dtReal) {
    if (escolhida || document.hidden) { medQuadros = 0; medTempo = 0; return; }
    medQuadros++; medTempo += dtReal;
    if (medTempo < 4) return;
    const fps = medQuadros / medTempo; medQuadros = 0; medTempo = 0;
    if (fps < 24 && qualidade > 0) { aplicarQualidade(qualidade - 1); rebaixou++; boas = 0; }
    else if (fps > 50 && qualidade < 2 && rebaixou < 2 && ++boas >= 3) { aplicarQualidade(qualidade + 1); boas = 0; }
  }

  // ---------- loop ----------
  const clock = new THREE.Clock();
  const ouvintes = [];
  const limite = borda + 4;
  function frame() {
    const dtReal = clock.getDelta(), dt = Math.min(dtReal, 0.05), t = clock.elapsedTime;
    medirQualidade(dtReal);
    skyMat.uniforms.uTime.value = t; sky.position.copy(camera.position);
    controls.update();
    // não deixa a câmera fugir da vila
    const tg = controls.target, ox = THREE.MathUtils.clamp(tg.x, -limite, limite) - tg.x, oz = THREE.MathUtils.clamp(tg.z, -limite, limite) - tg.z;
    if (ox || oz) { tg.x += ox; tg.z += oz; camera.position.x += ox; camera.position.z += oz; }
    tg.y = 0;

    neve = intensidadeNeve(Date.now());
    flakeGeo.setDrawRange(0, Math.floor(maxFlocos * neve));
    scene.fog.density = 0.0052 + 0.0026 * neve;
    skyMat.uniforms.uClaro.value = 1 - neve;
    const p = flakeGeo.attributes.position.array, sp = reduceMotion ? 0.4 : 1;
    for (let i = 0; i < flakeN; i++) {
      p[i * 3 + 1] -= dt * (1.2 + neve) * fs[i] * sp; p[i * 3] += Math.sin(t * 0.7 + i) * dt * (0.3 + neve * 0.6) * sp;
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
    for (const e of predios.values()) { const gi = e.obj.userData.gira; if (gi) { gi.obj.rotation[gi.eixo] += dt * gi.vel; for (const c of gi.cabines || []) c.rotation.z = -gi.obj.rotation.z; } }
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

    if (modo === 'casa') {
      salaControls.update();
      const f = sala.moveis.get('lareira');
      if (f) { f.obj.userData.fogo.children.forEach((c, i) => { if (c.geometry.type === 'ConeGeometry') c.scale.y = 0.85 + Math.sin(t * 9 + i * 2) * 0.15; }); sala.fogoLuz.intensity = (14 + f.n * 6) * (0.85 + Math.sin(t * 11) * 0.1 + Math.sin(t * 17) * 0.05); }
    }
    animarVida(dt, t);
    for (const b of construtoresObj) {
      const o = b.obj, u = o.userData;
      if (b.obra) {
        const tam = TIPOS[b.obra.tipo].tam, c = centroLote(b.obra.x, b.obra.z, tam);
        b.alvo.set(c.x + tam * T * 0.42, 0, c.z + tam * T * 0.5 + 0.6);
      } else if (praca) { const c = centroLote(praca.x, praca.z, 4); b.alvo.set(c.x - 6.2 - b.idx * 1.2, 0, c.z + 4.5); }
      if (andarAte(o, b.alvo, dt, t, 3.4, b.idx)) {
        if (b.obra) { const tam = TIPOS[b.obra.tipo].tam, c = centroLote(b.obra.x, b.obra.z, tam); o.rotation.y = Math.atan2(c.x - o.position.x, c.z - o.position.z); u.arms[1].rotation.x = -1.4 - Math.abs(Math.sin(t * 7 + b.idx)) * 1.2; }
        else { o.rotation.y = 0.4; u.arms.forEach(a => a.rotation.x = 0); }
      }
    }
    for (const e of predios.values()) if (e.obj.userData.guindaste) e.obj.userData.guindaste.rotation.y = Math.sin(t * 0.4) * 0.6;
    for (const fn of ouvintes) fn(dt);
    if (quadroSombra++ % (coarse ? 2 : 1) === 0) renderer.shadowMap.needsUpdate = true;
    renderer.info.reset(); composer.render();
    requestAnimationFrame(frame);
  }

  function andarAte(o, alvo, dt, t, vel, fase) {
    const u = o.userData, dx = alvo.x - o.position.x, dz = alvo.z - o.position.z, dist = Math.hypot(dx, dz);
    if (dist > 0.15) {
      const v = Math.min(dist, dt * vel);
      o.position.x += dx / dist * v; o.position.z += dz / dist * v; o.rotation.y = Math.atan2(dx, dz);
      u.legs.forEach((l, i) => l.rotation.x = Math.sin(t * 8 + fase + i * Math.PI) * 0.55);
      u.arms.forEach((a, i) => { if (!u.carregando) a.rotation.x = Math.sin(t * 8 + fase + i * Math.PI + Math.PI) * 0.45; });
      return false;
    }
    u.legs.forEach(l => l.rotation.x = 0);
    return true;
  }

  function animarVida(dt, t) {
    // trem
    trem.position.x += dt * 9; if (trem.position.x > 220) trem.position.x = -220;
    fumacaTrem.forEach(s => {
      const u = s.userData; u.life += dt * 0.35; if (u.life > 1) u.life -= 1;
      const base = trem.localToWorld(trem.userData.chamine.clone());
      s.position.set(base.x - u.life * 7, base.y + u.life * 5, base.z + Math.sin(u.life * 5) * 0.5);
      const sc = 1 + u.life * 4; s.scale.set(sc, sc, 1); s.material.opacity = Math.sin(u.life * Math.PI) * 0.6;
    });
    // carros
    for (const c of carros) {
      c.position.x += c.userData.sentido * c.userData.vel * dt;
      if (c.position.x > 160) c.position.x = -160; if (c.position.x < -160) c.position.x = 160;
    }
    // moradores
    const obra = praca && praca.obra, cPraca = praca ? centroLote(praca.x, praca.z, 4) : V3(0, 0, 0);
    escada.visible = !!obra;
    if (obra) { escada.position.set(cPraca.x + 2.0, 0, cPraca.z + 1.4); escada.rotation.set(-0.32, -0.95, 0, 'YXZ'); }
    for (const m of moradores) {
      const o = m.obj, u = o.userData;
      let papel = null;
      if (obra) papel = m.idx === 0 ? 'escada' : m.idx <= 2 ? 'carrega' : null;
      u.caixa.visible = false; u.carregando = false;
      if (papel === 'escada') {
        const pe = V3(cPraca.x + 2.6, 0, cPraca.z + 2.1);
        o.position.y = 0;
        if (andarAte(o, pe, dt, t, 2.6, m.idx)) {
          o.rotation.y = Math.atan2(cPraca.x - o.position.x, cPraca.z - o.position.z);
          o.position.y = 1.2 + Math.sin(t * 1.5) * 0.4;
          u.arms[1].rotation.x = -2.4 + Math.sin(t * 4) * 0.4; u.arms[0].rotation.x = -1.4;
        }
      } else if (papel === 'carrega') {
        // vai e volta entre a pilha de caixas (borda da praça) e a árvore
        const ciclo = (t * 0.12 + m.idx * 0.5) % 1, ida = ciclo < 0.5;
        const a = m.idx * 1.9, borda = V3(cPraca.x + Math.cos(a) * 6.5, 0, cPraca.z + Math.sin(a) * 6.5), arvore = V3(cPraca.x + Math.cos(a) * 3.4, 0, cPraca.z + Math.sin(a) * 3.4);
        u.carregando = ida; u.caixa.visible = ida;
        if (ida) u.arms.forEach(b => b.rotation.x = -1.1);
        o.position.y = 0;
        andarAte(o, ida ? arvore : borda, dt, t, 2.4, m.idx);
      } else {
        o.position.y = 0;
        if (t > m.troca) { m.alvo.set(R(-20, 20), 0, RUA_Z + (rnd() < 0.5 ? -1.6 : 1.6)); if (rnd() < 0.4) { const a = R(0, 6.28); m.alvo.set(cPraca.x + Math.cos(a) * 6, 0, cPraca.z + Math.sin(a) * 6); } m.troca = t + R(6, 12); }
        if (andarAte(o, m.alvo, dt, t, 1.8, m.idx)) u.arms.forEach(b => b.rotation.x = 0);
      }
    }
    // Papai Noel: voa até a casa, pousa no telhado, desce pela chaminé, volta com o aluguel
    if (noel.voando) {
      const parada = noel.rota[noel.i];
      const voarPara = (alvo, vel) => {
        const d = alvo.clone().sub(treno.position), dist = d.length();
        if (dist < 0.05) return true;
        treno.position.addScaledVector(d.normalize(), Math.min(dist, dt * vel));
        if (Math.abs(d.y) < 0.9) {
          const yaw = Math.atan2(-d.z, d.x), dif = ((yaw - treno.rotation.y + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
          treno.rotation.y += THREE.MathUtils.clamp(dif, -dt * 2.5, dt * 2.5);
        }
        return false;
      };
      const proxFase = (f) => { noel.fase = f; noel.tempo = 0; };
      noel.tempo += dt;
      const k = Math.min(1, noel.tempo / 0.9);
      if (noel.fase === 'ir') {
        if (voarPara(parada.acima, 14)) { if (parada.fim) { noel.voando = false; treno.visible = false; } else proxFase('pousar'); }
      } else if (noel.fase === 'pousar') {
        if (voarPara(parada.pouso, 4.5)) { scene.attach(figura); parada.de = figura.position.clone(); parada.boca = parada.chamine.clone().add(V3(0, 0.15, 0)); proxFase('sair'); }
      } else if (noel.fase === 'sair') {
        // pula do trenó até a boca da chaminé
        figura.position.lerpVectors(parada.de, parada.boca, k); figura.position.y += Math.sin(k * Math.PI) * 1.0;
        figura.rotation.y = Math.atan2(parada.boca.x - parada.de.x, parada.boca.z - parada.de.z) - Math.PI / 2;
        if (k >= 1) proxFase('descer');
      } else if (noel.fase === 'descer') {
        figura.position.copy(parada.boca); figura.position.y -= k * 2.2; figura.rotation.y += dt * 4;
        if (k >= 1) {
          figura.visible = false; proxFase('dentro');
          if (noel.aoChegar) noel.aoChegar(parada.id);
          fuligem.forEach((sp, i) => { sp.visible = true; sp.userData.vida = -i * 0.12; });
        }
      } else if (noel.fase === 'dentro') {
        if (noel.tempo > 1.3) { figura.visible = true; figura.userData.bolsa.visible = true; proxFase('subir'); }
      } else if (noel.fase === 'subir') {
        figura.position.copy(parada.boca); figura.position.y -= (1 - k) * 2.2; figura.rotation.y -= dt * 4;
        if (k >= 1) proxFase('voltar');
      } else if (noel.fase === 'voltar') {
        figura.position.lerpVectors(parada.boca, parada.de, k); figura.position.y += Math.sin(k * Math.PI) * 1.0;
        if (k >= 1) {
          treno.userData.treno.attach(figura);
          figura.position.copy(treno.userData.assento); figura.rotation.set(0, 0, 0); figura.userData.bolsa.visible = false;
          proxFase('decolar');
        }
      } else if (noel.fase === 'decolar') {
        if (voarPara(parada.acima, 6)) { noel.i++; proxFase('ir'); }
      }
      const pousado = noel.fase !== 'ir' && noel.fase !== 'pousar' && noel.fase !== 'decolar';
      treno.userData.renas.forEach((r, i) => { r.position.y = -0.2 + (pousado ? 0 : Math.sin(t * 6 + i) * 0.12); });
      // rastro de brilho (só voando)
      if (!pousado) {
        const atras = treno.localToWorld(V3(-1.5, 0.6, 0));
        brilhoPos[brilhoI * 3] = atras.x + R(-0.3, 0.3); brilhoPos[brilhoI * 3 + 1] = atras.y + R(-0.3, 0.3); brilhoPos[brilhoI * 3 + 2] = atras.z + R(-0.3, 0.3); brilhoVida[brilhoI] = 1;
        brilhoI = (brilhoI + 1) % brilhoN;
      }
      // fuligem saindo da chaminé quando ele entra
      const pc = noel.rota[noel.i];
      fuligem.forEach((sp) => {
        if (!sp.visible || !pc || !pc.chamine) return;
        sp.userData.vida += dt * 0.9;
        const v = sp.userData.vida;
        if (v < 0) { sp.material.opacity = 0; return; }
        if (v > 1) { sp.visible = false; return; }
        sp.position.copy(pc.chamine).add(V3(Math.sin(v * 7) * 0.3, 0.3 + v * 2.5, 0));
        const sc = 0.5 + v * 1.6; sp.scale.set(sc, sc, 1); sp.material.opacity = Math.sin(v * Math.PI) * 0.7;
      });
    }
    for (let i = 0; i < brilhoN; i++) { if (brilhoVida[i] > 0) { brilhoVida[i] -= dt * 0.8; brilhoPos[i * 3 + 1] -= dt * 0.6; if (brilhoVida[i] <= 0) brilhoPos[i * 3 + 1] = -100; } }
    brilhoGeo.attributes.position.needsUpdate = true;
    for (let i = presentesCaindo.length - 1; i >= 0; i--) {
      const pc = presentesCaindo[i]; pc.obj.position.y -= dt * 4; pc.obj.rotation.y += dt * 4; pc.vida -= dt;
      if (pc.obj.position.y < pc.ate || pc.vida <= 0) { scene.remove(pc.obj); liberar(pc.obj); presentesCaindo.splice(i, 1); }
    }
  }

  // O canvas ocupa a tela pelo CSS; aqui só a resolução interna acompanha. No iPhone a área
  // visível muda quando as barras do Safari aparecem/somem e nem sempre vem 'resize', então
  // o tamanho é conferido a cada quadro.
  let largura = 0, altura = 0;
  function ajustarTamanho() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    if (w === largura && h === altura) return;
    largura = w; altura = h;
    enquadrar(); enquadrarSala(); aplicarDesloc(); renderer.setSize(w, h, false); composer.setSize(w, h); bloom.resolution.set(w, h);
  }
  addEventListener('resize', ajustarTamanho);
  ouvintes.push(ajustarTamanho);
  requestAnimationFrame(frame);

  return {
    sincronizar, setFantasma, setDeslocamento, centroTerreno, entrarCasa, sairCasa, sincSala, itemEm, posItem, modo: () => modo, setGrade, setSelecionado, esconder, loteEm, predioEm, projetar, topoDe, focar, miniaturas,
    aoQuadro: fn => ouvintes.push(fn),
    papaiNoel, chamineDe, noelVoando: () => noel.voando,
    qualidade: () => qualidade, setQualidade: escolherQualidade, neve: () => neve,
    pecas: () => { const r = {}; for (const e of predios.values()) { let m = 0, t = 0; e.obj.traverse(o => { if (o.isMesh) { m++; const g = o.geometry; t += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); } }); const x = r[e.tipo] || (r[e.tipo] = { n: 0, pecas: 0, tri: 0 }); x.n++; x.pecas += m; x.tri += Math.round(t); } let ce = 0; scene.traverse(o => { if (o.isMesh) ce++; }); r._cenaToda = ce; return r; },
    memoria: () => ({ ...renderer.info.memory, desenhos: renderer.info.render.calls, triangulos: renderer.info.render.triangles }),
    controls,
  };
}
