import { DatabaseSync } from "node:sqlite";
// Exercise the production prepared SQL against SQLite without network access.
// The deployed smoke check separately verifies the Cloudflare D1 binding.
export function openSqlite(file) {
  const connection = new DatabaseSync(file);
  connection.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
  return {
    close: () => connection.close(),
    prepare(sql) {
      const stmt = connection.prepare(sql); let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return stmt.get(...args) ?? null; },
        async run() { return stmt.run(...args); },
        async all() { return { results: stmt.all(...args) }; },
      };
    },
  };
}
