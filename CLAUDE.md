# Vila de Natal

Jogo de construir vila de Natal no navegador, pra jogar com amigos. Visual 3D
estilizado (noite com aurora, neve, luzinhas), rodando em tempo real com Three.js.
Funciona no celular e no computador, sem instalar nada.

Cada jogador tem a sua vila: começa com a praça da árvore, uma casinha, a fábrica de
brinquedos e 3 duendes. Constrói, move, gira e vende prédios; contrata duendes e põe
cada um num prédio (sem duende, o prédio não produz); coleta a produção; sobe de
nível com a alegria e libera prédios novos. A produção continua com o jogo fechado.

## Stack

Cloudflare Worker (`src/index.js`) + D1 (`natal-db`). Sem build step: o
`index.html` e a pasta `assets/` são servidos como estão pelos assets do Worker. O
Three.js (0.160.0) vem do jsDelivr pelo importmap do `index.html`.

- `assets/js/regras.js` — **as regras do jogo**: catálogo de prédios (`TIPOS`),
  mapa e ruas, níveis, e `aplicar(vila, acao, agora)` com todas as ações. É puro (sem
  DOM nem banco) e roda igual no navegador e no Worker. Balanceamento (custos,
  ciclos, níveis) se mexe só aqui.
- `assets/js/cena.js` — a cena 3D: céu, terreno, floresta, neve, e um modelo por
  tipo de prédio em `MODELOS` (tudo gerado por código). Não conhece regra nenhuma,
  só desenha o estado que recebe em `sincronizar(vila)`.
- `assets/js/jogo.js` — o jogo no navegador: carrega a vila, toques, modo
  construir/mover, painéis, balões de coleta e a fila de ações pro servidor.
- `assets/css/jogo.css` — interface (painéis de "vidro noturno").

### Como o salvamento funciona

A vila inteira é um JSON (formato em `regras.js`, gravado em `vilas.estado`). O
navegador aplica cada ação na hora com `aplicar()` e põe numa fila; a fila vai pro
`POST /api/acoes`, o Worker aplica as mesmas ações com o **relógio do servidor**,
grava e devolve a vila oficial, que substitui a do navegador. Por isso `regras.js`
não pode sortear nem ler relógio: o horário entra como parâmetro e os ids saem do
contador `seq` da vila (os dois lados geram os mesmos ids).

A produção não roda em segundo plano: cada prédio guarda `prog` (ciclos
acumulados, até `ESTOQUE_MAX`) e a vila guarda `t` (último cálculo). `avancar()`
recalcula pelo tempo que passou, então o "produz com o jogo fechado" sai de graça.

Sem servidor (abrindo o arquivo direto, ou fora do ar) o jogo roda com a cópia
salva no `localStorage` e manda a fila quando o servidor voltar.

### API

- `POST /api/jogador` — cria jogador anônimo com a vila inicial; devolve o token
  (só nessa resposta; o banco guarda o SHA-256).
- `GET /api/vila` — vila do dono do token, já avançada no tempo.
- `POST /api/acoes` — `{ acoes: [...] }` (até 50); devolve `{ vila, agora, resultados }`,
  um `{ ok, erro? }` por ação. Ação recusada não derruba as outras.

Autenticação: `Authorization: Bearer <token>`. O token fica no `localStorage`
(`natal.token`). Contas de verdade vêm depois, reaproveitando a tabela `jogadores`.

## Rodar local

```bash
node scripts/dev.mjs     # http://localhost:8787 — mesmo Worker, banco em .wrangler/dev.sqlite
```

## Banco de dados

Não há deploy automático de schema. Rodar no D1 Console, em ordem:
`001_estrutura.sql`. Mudança nova de banco vira um arquivo numerado em `migrations/`.

O `natal-db` foi criado e a `001_estrutura.sql` já rodou nele em 2026-11-14.

## No ar

Ainda não. O Worker `natal` não foi publicado: o proxy da sessão que criou o
projeto barra o upload de assets do Wrangler (401). Um `wrangler deploy` normal com
este `wrangler.toml` publica tudo.

## Testes

Rodam contra SQLite real (`node:sqlite`), não mock:

```bash
node test/regras.test.mjs   # regras do jogo
node test/api.test.mjs      # API + roteamento
```

## Próximas etapas

1. Contas (nome + login) ligadas ao jogador anônimo, pra abrir a mesma vila em outro aparelho.
2. Amigos: lista, visitar a vila do amigo (só leitura), mandar presente, ajudar a
   acelerar a produção dele. Durable Objects só se precisar de tempo real.
3. Trocar modelos gerados por código por modelos 3D prontos (.glb), um por vez, em `MODELOS`.
