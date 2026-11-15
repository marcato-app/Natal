-- Amigos, presentes e ajudas (etapa social). Rodar depois da 001.

-- código público pra adicionar amigo (ex: K7QX2M) e hash do código de recuperação
-- (pra abrir a mesma vila em outro aparelho).
ALTER TABLE jogadores ADD COLUMN codigo TEXT;
ALTER TABLE jogadores ADD COLUMN recuperacao_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS jogadores_codigo ON jogadores (codigo);
CREATE UNIQUE INDEX IF NOT EXISTS jogadores_recuperacao ON jogadores (recuperacao_hash);

-- amizade guardada nos dois sentidos (a -> b e b -> a)
CREATE TABLE IF NOT EXISTS amizades (
  a         TEXT NOT NULL REFERENCES jogadores(id) ON DELETE CASCADE,
  b         TEXT NOT NULL REFERENCES jogadores(id) ON DELETE CASCADE,
  criado_em INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);

-- presente de amigo: um por dia de cada amigo; fica pendente até o dono resgatar
CREATE TABLE IF NOT EXISTS presentes (
  de           TEXT NOT NULL REFERENCES jogadores(id) ON DELETE CASCADE,
  para         TEXT NOT NULL REFERENCES jogadores(id) ON DELETE CASCADE,
  dia          TEXT NOT NULL,
  criado_em    INTEGER NOT NULL,
  resgatado_em INTEGER,
  PRIMARY KEY (de, para, dia)
);
CREATE INDEX IF NOT EXISTS presentes_pendentes ON presentes (para, resgatado_em);

-- ajuda na vila do amigo: uma por dia por amigo
CREATE TABLE IF NOT EXISTS ajudas (
  de        TEXT NOT NULL REFERENCES jogadores(id) ON DELETE CASCADE,
  para      TEXT NOT NULL REFERENCES jogadores(id) ON DELETE CASCADE,
  dia       TEXT NOT NULL,
  predio    TEXT NOT NULL,
  criado_em INTEGER NOT NULL,
  PRIMARY KEY (de, para, dia)
);

-- acessos extras do mesmo jogador (cada aparelho recuperado ganha o seu token)
CREATE TABLE IF NOT EXISTS sessoes (
  token_hash TEXT PRIMARY KEY,
  jogador_id TEXT NOT NULL REFERENCES jogadores(id) ON DELETE CASCADE,
  criado_em  INTEGER NOT NULL
);
