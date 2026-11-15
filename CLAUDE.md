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
Three.js (0.160.0) e as fontes ficam dentro do projeto (`assets/vendor/`, `assets/fonts/`),
então nada vem de CDN; `sw.js` guarda tudo no aparelho pra abrir offline.

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

### Coisas de Natal

- **Árvore da praça** começa só verde. Comprar um enfeite (`ITENS.praca`) abre uma
  "obra" (`praca.obra = { item, fim }`): os moradores vão até a árvore (um sobe na
  escada, os outros levam caixas) e o enfeite aparece quando o tempo acaba
  (`TEMPO_ENFEITE`). Um enfeite por vez.
- **Casa** melhora em 3 níveis (`TIPOS.casa.melhorias`: ala nova, segundo andar, mais
  moradia), tem fachada decorável e interior 3D com 8 móveis de 3 níveis
  (`ITENS.casa`, grupos `fachada` e `moveis`).
- **Aluguel e Papai Noel**: casa com pelo menos um enfeite de fachada rende aluguel
  (`aluguelDe()`, acumula em `prog` como a produção). A cada ~18 s o navegador manda
  o trenó (`cena.papaiNoel`) pelas chaminés das casas com aluguel pronto; em cada uma
  ele pousa no telhado, desce pela chaminé (o jogo faz a ação `coletar` daquela casa),
  volta com o saco de moedas e decola pra próxima. Sem casa pronta,
  ele só passeia de vez em quando.
- **Vida na vila** (só visual, em `cena.js`): carros na rua principal, que segue pela
  floresta; trem a vapor com vagões de presentes no trilho atrás da vila; moradores
  passeando.

### Mapa, cidade e visual

- **Expansão**: a vila começa num quadrado 18×18; em volta há 16 terrenos 6×6
  (`TERRENOS`, de -6 a 24) que se compram com moedas (os dos cantos também com estrelas)
  a partir dos níveis 2, 3 e 5 (ação `terreno`). `cabe()` só aceita lote dentro da área
  comprada (`naVila`) e fora das ruas (`RUAS`: rua principal, travessas e avenida em volta).
- **Casas realistas** (`makeHouse` em `cena.js`): brancas, telhado escuro com
  acabamento preto, janelas pretas, garagem e varanda; 3 níveis e variantes escolhidas
  pelo id do prédio (`VARIANTES`). Peças iguais são fundidas por material (`fundir`) pra
  aguentar celular.
- **Pinheiros** (`pinheiro`, `abeto`, `espruce`): cones de galhos, sem copa redonda;
  aceitam pisca-pisca (`ITENS[tipo].luzes`, grupo `pisca`).
- **Clima**: a neve começa e para num ciclo de 10 min (`CLIMA` em `cena.js`), com
  céu e neblina acompanhando. Só visual.
- **Cidade**: calçadas e postes nas ruas, bairro vizinho com casas e igreja fora do mapa,
  floresta em volta, trilho do trem atrás.
- **Em pé e deitado**: `jogo.css` tem um layout de paisagem
  (`(orientation: landscape) and (max-height: 520px)`): botões numa coluna à direita,
  painéis do lado, e a cena desloca pro lado livre (`setDeslocamento`).
- **20 níveis** (`NIVEIS`) com prédios novos até o castelo; a oficina produz estrelas.

### Obras, construtores e estrelas (estilo jogo de construir)

- Construir (`TIPOS[x].tempo`) e aumentar a casa (`melhorias[n].tempo`) abrem uma obra
  (`p.obra = { tipo: 'construir' | 'melhorar', fim }`); decoração fica pronta na hora.
  Prédio em construção não produz, não abriga e não aceita duende.
- Cada duende construtor (`v.construtores`, começa com 1, máx. 3) toca uma obra por vez.
- **Estrelas mágicas** (`v.estrelas`): moeda especial. `acelerar` termina qualquer obra
  (1 estrela por minuto que falta, `custoAcelerar`); `construtor` contrata mais um
  (`CUSTO_CONSTRUTOR`). Ganha `ESTRELAS_POR_NIVEL` a cada nível (`ganharAlegria`). É a
  moeda que anúncio recompensado e compras vão dar.

### Retenção

- **Presente diário** (`presente`): um por dia no horário de Brasília (`diaDe`); dias
  seguidos sobem a sequência de 7 (`PRESENTE_DIARIO`). De 1 a 25/12 vira o Calendário
  do Advento (`ADVENTO`). Estado em `v.diario`.
- **Missões** (`MISSOES`, ação `missao`): 3 ativas por vez, progresso lido do estado e
  dos contadores `v.stats` (coletas, aluguéis). Servem de tutorial; `foco` diz pra onde
  o botão "Ir" leva.
- **Som** (`assets/js/audio.js`): tudo sintetizado com Web Audio (nada pra baixar).
  Música "Jingle Bells" (domínio público) em timbre de sino + efeitos. Liga no primeiro
  toque; preferências em `localStorage['natal.som']`.
- Boas-vindas no primeiro acesso (`localStorage['natal.boasvindas']`).

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

### Amigos

- Cada jogador tem **nome** e **código de amigo** público (6 letras, `jogadores.codigo`).
  Adicionar por código (`POST /api/amigos`) cria a amizade nos dois sentidos. O convite
  é o link `/?amigo=CODIGO` (WhatsApp/compartilhar): quem abre já vira amigo.
- **Visitar** (`GET /api/amigos/:id/vila`): a cena mostra a vila do amigo (só olhar).
- **Presente** (`POST /api/amigos/:id/presente`): 1 por dia por amigo; fica pendente em
  `presentes` até o dono abrir (`POST /api/presentes/resgatar`, `PRESENTE_AMIGO` cada).
- **Ajuda** (`POST /api/amigos/:id/ajuda`): 1 por dia por amigo; adianta obra ou
  produção do prédio tocado (`receberAjuda`) e dá `RECOMPENSA_AJUDANTE` pra quem ajudou.
  Essas mudanças são feitas pelo servidor direto nas duas vilas (`mudarVila`); não
  existem como ação da fila (o dono não consegue se ajudar).
- **Outro aparelho**: `POST /api/eu/recuperacao` gera um código XXXX-XXXX-XXXX (hash em
  `recuperacao_hash`); `POST /api/recuperar` troca por um token novo guardado em
  `sessoes` (os aparelhos antigos continuam funcionando).

### API

- `POST /api/jogador` — cria jogador anônimo com a vila inicial; devolve o token
  (só nessa resposta; o banco guarda o SHA-256).
- `GET /api/vila` — vila do dono do token, já avançada no tempo.
- `POST /api/acoes` — `{ acoes: [...] }` (até 50); devolve `{ vila, agora, resultados }`,
  um `{ ok, erro? }` por ação. Ação recusada não derruba as outras.

Autenticação: `Authorization: Bearer <token>`. O token fica no `localStorage`
(`natal.token`). Contas de verdade vêm depois, reaproveitando a tabela `jogadores`.

## App (Android e iOS)

O mesmo jogo vira app com **Capacitor 8** (`capacitor.config.json`, `appId`
`app.marcato.natal`: trocar antes da primeira publicação, depois não muda mais). Tudo
fica dentro do app (Three.js, fontes, som sintetizado), então joga offline; amigos e
anúncios precisam de internet.

- `npm run app:web` monta `www/` (o que vai dentro do app). `npm run app:sync` copia
  pros projetos nativos `android/` e `ios/` (versionados no repo).
- No app a página roda em `capacitor://localhost` (iOS) / `https://localhost`
  (Android) e chama a API publicada (`API` em `jogo.js`); o Worker libera CORS só pra
  essas origens. Token e vila também vão pro Preferences nativo (o iPhone pode limpar o
  localStorage de app; o Preferences não). Vibração ao coletar (Haptics).
- Ícones e telas de abertura: `resources/` (desenhados de `assets/icones/icone.svg`) →
  `python3 scripts/icones-app.py` espalha pelos tamanhos de Android e iOS.
- **Android**: o GitHub Actions (`.github/workflows/android.yml`) gera o APK de teste a
  cada push (Actions → execução → Artifacts). Pra loja: assinar com keystore própria
  (`./gradlew bundleRelease`).
- **iOS**: precisa de Mac com Xcode (`npm run app:ios`) ou build na nuvem (Codemagic,
  Xcode Cloud). Conta Apple Developer (US$ 99/ano) pra TestFlight e App Store.
- Regras das lojas: compras de itens digitais têm de ser pela Apple/Google (Pix só na
  web); interface sem cara de site; política de privacidade.

## Dinheiro

- **Anúncio recompensado** (`assets/js/anuncios.js`, ação `anuncio`): o jogador escolhe
  ver um vídeo pra ganhar `ANUNCIO_ESTRELAS` estrelas (loja, no botão de estrelas do
  topo) ou adiantar uma obra em `ANUNCIO_ADIANTA` s. Máx. `ANUNCIOS_POR_DIA`. No app usa
  AdMob (`@capacitor-community/admob`); no localhost simula um vídeo de 3 s; na web
  publicada não aparece. **Os IDs do AdMob são os de TESTE do Google**: trocar em
  `anuncios.js`, `AndroidManifest.xml` e `Info.plist` antes de publicar (e `EM_TESTE`).
- **Pacotes de estrelas** aparecem na loja como "em breve": falta criar os produtos na
  App Store Connect / Google Play e validar o recibo no servidor antes de creditar.

## Balanceamento

`node scripts/simular.mjs [dias] [sessõesPorDia] [minutos]` joga no automático com as
regras reais e mostra em que dia chega a cada nível (`--dias` imprime dia a dia). Meta
atual: jogando 4×5 min por dia, nível 2 no 1º dia e nível 20 perto do dia 40 (Natal).
Decoração repetida dá alegria decrescente (2ª metade, 3ª um terço...).

## Rodar local

```bash
npm run dev   # (ou node scripts/dev.mjs) http://localhost:8787 — mesmo Worker, banco em .wrangler/dev.sqlite
```

## Banco de dados

Não há deploy automático de schema. Rodar no D1 Console, em ordem:
`001_estrutura.sql`, `002_amigos.sql`. Mudança nova de banco vira um arquivo numerado em `migrations/`.

O `natal-db` foi criado e a `001_estrutura.sql` já rodou nele em 2026-11-14; a
`002_amigos.sql` em 2026-11-15.

## No ar

https://natal.flat-salad-71d3.workers.dev (Worker `natal`). O primeiro deploy
(2026-11-15) foi feito de uma sessão cujo proxy barrava o upload de assets (401),
então subiu com os arquivos do jogo embutidos no script, num embrulho fora do repo.
Um `wrangler deploy` normal com este `wrangler.toml` substitui aquilo sem problema.

## Testes

Rodam contra SQLite real (`node:sqlite`), não mock:

```bash
node test/regras.test.mjs   # regras do jogo
node test/api.test.mjs      # API + roteamento
node test/e2e.mjs           # navegador de verdade (Playwright), celular em pé e deitado; telas em .e2e/
```

O `e2e.mjs` sobe o servidor local na porta 8799 e usa o gancho `window.__teste`
(só existe em localhost).

## Próximas etapas

1. Publicar nas lojas: contas de desenvolvedor, IDs reais do AdMob, compras de estrelas
   (produtos nas lojas + validação do recibo no servidor), política de privacidade,
   decidir público infantil.
2. Ranking entre amigos, cartão-postal da vila pra compartilhar, notificações.
3. Medir retenção (D1/D7) e limitar criação de contas por IP.
4. Trocar modelos gerados por código por modelos 3D prontos (.glb), um por vez, em `MODELOS`.
