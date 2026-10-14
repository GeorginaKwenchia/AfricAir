import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { loadSettings, secretReader, type Settings } from './config.js'
import { connectionConfig, databaseConfigured } from './db.js'

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url))
const LOCK_ID = 7_310_442 // arbitrary constant: serialises concurrent migration runs (e.g. two Jobs)

/** Applies every migrations/*.sql file not yet recorded in schema_migrations, each in its own transaction. */
export async function migrate(databaseUrl: string | null, settings: Settings, log = (msg: string) => console.log(JSON.stringify({ level: 'info', msg }))) {
  const client = new pg.Client(connectionConfig(databaseUrl, settings))
  await client.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID])
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    const applied = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version as string))
    const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort()
    let count = 0
    for (const file of files) {
      const version = file.replace(/\.sql$/, '')
      if (applied.has(version)) continue
      await client.query('BEGIN')
      try {
        await client.query(readFileSync(MIGRATIONS_DIR + file, 'utf8'))
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version])
        await client.query('COMMIT')
        log(`applied migration ${version}`)
        count++
      } catch (error) {
        await client.query('ROLLBACK')
        throw new Error(`migration ${version} failed: ${(error as Error).message}`)
      }
    }
    log(count ? `${count} migration(s) applied` : 'database schema is up to date')
    return count
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined)
    await client.end()
  }
}

// CLI: `node dist/migrate.js` (used by the Kubernetes migration Job)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const settings = loadSettings()
  const databaseUrl = secretReader('DATABASE_URL', process.env, 0)().value
  if (!databaseConfigured(databaseUrl)) {
    console.error(JSON.stringify({ level: 'error', msg: 'no database configured: set DATABASE_URL, DATABASE_URL_FILE or PGHOST/PGUSER/PGPASSWORD/PGDATABASE' }))
    process.exit(2)
  }
  migrate(databaseUrl, settings).then(
    () => process.exit(0),
    (error) => {
      console.error(JSON.stringify({ level: 'error', msg: (error as Error).message }))
      process.exit(1)
    },
  )
}
