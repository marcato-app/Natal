// Service worker: guarda o jogo no aparelho pra abrir sem internet.
// Arquivos: responde do cache e atualiza em segundo plano (a versão nova entra na
// próxima abertura). /api nunca passa pelo cache. Mude VERSAO ao trocar a lista.
const VERSAO = 'natal-2';
const ARQUIVOS = [
  '/', '/index.html', '/manifest.webmanifest',
  '/assets/css/jogo.css', '/assets/js/jogo.js', '/assets/js/cena.js', '/assets/js/regras.js', '/assets/js/audio.js',
  '/assets/vendor/three/three.module.min.js',
  '/assets/vendor/three/addons/controls/OrbitControls.js',
  '/assets/vendor/three/addons/geometries/RoundedBoxGeometry.js',
  '/assets/vendor/three/addons/postprocessing/EffectComposer.js',
  '/assets/vendor/three/addons/postprocessing/RenderPass.js',
  '/assets/vendor/three/addons/postprocessing/UnrealBloomPass.js',
  '/assets/vendor/three/addons/postprocessing/OutputPass.js',
  '/assets/vendor/three/addons/postprocessing/Pass.js',
  '/assets/vendor/three/addons/postprocessing/ShaderPass.js',
  '/assets/vendor/three/addons/postprocessing/MaskPass.js',
  '/assets/vendor/three/addons/shaders/CopyShader.js',
  '/assets/vendor/three/addons/shaders/LuminosityHighPassShader.js',
  '/assets/vendor/three/addons/shaders/OutputShader.js',
  '/assets/fonts/fredoka-latin-500-normal.woff2', '/assets/fonts/fredoka-latin-600-normal.woff2', '/assets/fonts/fredoka-latin-700-normal.woff2',
  '/assets/fonts/nunito-latin-600-normal.woff2', '/assets/fonts/nunito-latin-700-normal.woff2', '/assets/fonts/nunito-latin-800-normal.woff2', '/assets/fonts/nunito-latin-900-normal.woff2',
  '/assets/icones/icone-192.png', '/assets/icones/icone-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(caches.open(VERSAO).then(async (c) => {
    const salvo = await c.match(e.request, { ignoreSearch: true });
    const rede = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null);
    if (salvo) { e.waitUntil(rede); return salvo; }
    return (await rede) || new Response('Sem conexão', { status: 503 });
  }));
});
