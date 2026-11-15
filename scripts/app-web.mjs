// Monta a pasta www/ que vai dentro do app (Capacitor): só o que o navegador usa.
// O service worker fica de fora: no app os arquivos já estão no aparelho.
import { rm, mkdir, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const www = join(raiz, 'www');
await rm(www, { recursive: true, force: true });
await mkdir(www, { recursive: true });
for (const f of ['index.html', 'manifest.webmanifest']) await cp(join(raiz, f), join(www, f));
await cp(join(raiz, 'assets'), join(www, 'assets'), { recursive: true });
console.log('www/ pronto pro app');
