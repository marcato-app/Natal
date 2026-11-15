// Sobe os modelos 3D de assets/modelos/ pro R2 (bucket natal-modelos), de onde o Worker
// serve /assets/modelos/*. Rodar depois de trocar ou acrescentar um .glb:
//
//   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... node scripts/subir-modelos.mjs
//
// (o token precisa de permissão de escrita no R2; atrás de um proxy, use curl: o fetch do Node
// não passa por HTTPS_PROXY)
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const conta = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN;
if (!conta || !token) { console.error('Defina CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN'); process.exit(1); }
const pasta = fileURLToPath(new URL('../assets/modelos/', import.meta.url));
for (const nome of (await readdir(pasta)).filter(f => f.endsWith('.glb'))) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${conta}/r2/buckets/natal-modelos/objects/${nome}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'model/gltf-binary' }, body: await readFile(pasta + nome),
  });
  const d = await r.json().catch(() => ({}));
  console.log(d.success ? 'ok  ' : 'ERRO', nome, d.success ? `${Math.round(d.result.size / 1024)} KB` : JSON.stringify(d.errors || r.status));
}
