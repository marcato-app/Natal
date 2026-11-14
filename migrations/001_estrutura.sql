-- Estrutura do banco da Vila de Natal (Cloudflare D1).
-- Rodar uma vez, antes das outras migrações.

-- Por enquanto o jogador é anônimo: o navegador guarda um token aleatório e o
-- banco guarda só o hash dele. As contas de verdade (nome, login) vêm depois e
-- reaproveitam esta tabela.
CREATE TABLE IF NOT EXISTS jogadores (
  id         TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  nome       TEXT NOT NULL DEFAULT '',
  criado_em  INTEGER NOT NULL,
  visto_em   INTEGER NOT NULL
);

-- A vila inteira fica num JSON (formato em assets/js/regras.js). `versao` sobe a
-- cada gravação e evita que duas abas sobrescrevam uma à outra.
CREATE TABLE IF NOT EXISTS vilas (
  jogador_id    TEXT PRIMARY KEY REFERENCES jogadores(id) ON DELETE CASCADE,
  estado        TEXT NOT NULL,
  versao        INTEGER NOT NULL DEFAULT 1,
  atualizado_em INTEGER NOT NULL
);
