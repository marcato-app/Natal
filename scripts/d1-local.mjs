// Imitação do D1 em cima do SQLite do Node (node:sqlite), com as migrações do
// projeto. Usada pelos testes e pelo servidor local (scripts/dev.mjs).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

export function bancoLocal(arquivo = ':memory:') {
  const db = new DatabaseSync(arquivo);
  db.exec('PRAGMA foreign_keys = ON'); // D1 liga por padrão
  const dir = new URL('../migrations/', import.meta.url);
  // guarda quais migrações já rodaram, pra o banco do servidor local abrir de novo
  db.exec('CREATE TABLE IF NOT EXISTS _migracoes (nome TEXT PRIMARY KEY)');
  const feitas = new Set(db.prepare('SELECT nome FROM _migracoes').all().map(r => r.nome));
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    if (feitas.has(f)) continue;
    db.exec(readFileSync(new URL(f, dir), 'utf8'));
    db.prepare('INSERT INTO _migracoes (nome) VALUES (?)').run(f);
  }
  return db;
}

export function makeD1(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      let args = [];
      return {
        bind(...a) { args = a; return this; },
        async all() { return { results: stmt.all(...args) }; },
        async first() { const r = stmt.get(...args); return r === undefined ? null : r; },
        async run() { const info = stmt.run(...args); return { success: true, meta: { changes: info.changes } }; },
        _run() { return stmt.run(...args); },
      };
    },
    async batch(stmts) {
      db.exec('BEGIN');
      try { const out = stmts.map(s => s._run()); db.exec('COMMIT'); return out; }
      catch (err) { db.exec('ROLLBACK'); throw err; }
    },
  };
}
