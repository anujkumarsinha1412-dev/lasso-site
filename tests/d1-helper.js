import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Execute the actual migration and SQL against SQLite, rather than mocking query results.
export function memoryD1() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0001_leads.sql', import.meta.url), 'utf8'));
  const prepared = (query, values = []) => ({
    bind: (...args) => prepared(query, args),
    async first() { return sql.prepare(query).get(...values) || null; },
    async all() { return { results:sql.prepare(query).all(...values) }; },
    async run() { const result = sql.prepare(query).run(...values); return { success:true,meta:{changes:Number(result.changes)} }; },
  });
  return { prepare:prepared, async batch(statements) { sql.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; } catch(e) { sql.exec('ROLLBACK'); throw e; } }, sql };
}

export function memoryMailD1() {
  const db = memoryD1();
  for (const name of ['0002_consultation_inquiries','0003_consultation_attribution','0004_mail_failure_alerts']) {
    db.sql.exec(readFileSync(new URL(`../migrations/${name}.sql`,import.meta.url),'utf8'));
  }
  return db;
}
