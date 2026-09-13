export const SCHEMA_VERSION = 1;

const migrations = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS diagnostic_probe (
        nonce TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      )`
    ]
  }
] as const;

export function migrate(sql: SqlStorage, storage: DurableObjectStorage): number {
  storage.transactionSync(() => {
    sql.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`);
    const applied = new Set(
      [...sql.exec<{ version: number }>('SELECT version FROM schema_migrations')].map(row => row.version)
    );
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      for (const statement of migration.statements) sql.exec(statement);
      sql.exec(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
        migration.version,
        new Date().toISOString()
      );
    }
  });
  return [...sql.exec<{ version: number }>('SELECT MAX(version) AS version FROM schema_migrations')][0]?.version ?? 0;
}
