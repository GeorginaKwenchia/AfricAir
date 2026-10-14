import { readFileSync } from 'node:fs'
import pg from 'pg'
import type { Env, Settings } from './config.js'

export type StoredBooking = Record<string, unknown> & { reference: string; status: string }

export type BookingStore = {
  ping(): Promise<void>
  insert(booking: BookingRecord): Promise<'created' | 'duplicate'>
  find(reference: string, lastName: string): Promise<StoredBooking | null>
  cancel(reference: string, lastName: string): Promise<StoredBooking | null>
  list(limit: number): Promise<StoredBooking[]>
  stats(): Promise<{ total: number; confirmed: number; cancelled: number; last24h: number; revenueUsd: number }>
  close(): Promise<void>
}

export type BookingRecord = {
  reference: string
  status: 'confirmed' | 'cancelled'
  origin: string
  destination: string
  departDate: string
  returnDate: string | null
  cabin: string
  passengers: number
  lastNames: string[]
  totalUsd: number
  currency: string
  promoCode: string | null
  payload: unknown
}

/** True when a database is configured: DATABASE_URL (or _FILE) or the standard libpq PG* variables. */
export const databaseConfigured = (databaseUrl: string | null, env: Env = process.env) => !!databaseUrl || !!env.PGHOST

function sslOption(settings: Settings, urlSslMode: string | null): pg.PoolConfig['ssl'] {
  const mode = settings.dbSsl || (urlSslMode && urlSslMode !== 'disable' ? 'require' : 'disable')
  if (mode === 'verify') {
    if (!settings.dbSslCaFile) throw new Error('DB_SSL=verify needs DB_SSL_CA_FILE (e.g. the Amazon RDS CA bundle)')
    return { ca: readFileSync(settings.dbSslCaFile, 'utf8'), rejectUnauthorized: true }
  }
  // "require": encrypted, but the server certificate is not verified (like libpq's sslmode=require).
  return mode === 'require' ? { rejectUnauthorized: false } : false
}

export function connectionConfig(databaseUrl: string | null, settings: Settings): pg.ClientConfig {
  let connectionString: string | undefined
  let urlSslMode: string | null = null
  if (databaseUrl) {
    // node-postgres treats sslmode=require as verify-full; we strip it and control TLS through DB_SSL instead.
    const url = new URL(databaseUrl)
    urlSslMode = url.searchParams.get('sslmode')
    url.searchParams.delete('sslmode')
    connectionString = url.toString()
  } else {
    urlSslMode = process.env.PGSSLMODE ?? null
  }
  return { connectionString, ssl: sslOption(settings, urlSslMode), connectionTimeoutMillis: 3000 }
}

export function createStore(databaseUrl: string | null, settings: Settings): BookingStore {
  const pool = new pg.Pool({ ...connectionConfig(databaseUrl, settings), max: 5, idleTimeoutMillis: 30_000 })
  pool.on('error', (error) => console.error(JSON.stringify({ level: 'error', msg: 'idle database client error', error: error.message })))

  const row = (r: { payload: StoredBooking; status: string }) => ({ ...r.payload, status: r.status }) as StoredBooking

  return {
    async ping() {
      await pool.query('SELECT 1')
    },
    async insert(b) {
      const result = await pool.query(
        `INSERT INTO bookings (reference, status, origin, destination, depart_date, return_date, cabin, passengers, last_names, total_usd, currency, promo_code, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (reference) DO NOTHING`,
        [b.reference, b.status, b.origin, b.destination, b.departDate, b.returnDate, b.cabin, b.passengers, b.lastNames, b.totalUsd, b.currency, b.promoCode, JSON.stringify(b.payload)],
      )
      return result.rowCount === 1 ? 'created' : 'duplicate'
    },
    async find(reference, lastName) {
      const result = await pool.query(
        `SELECT payload, status FROM bookings WHERE reference = $1 AND lower($2) = ANY (SELECT lower(n) FROM unnest(last_names) n)`,
        [reference, lastName],
      )
      return result.rows[0] ? row(result.rows[0]) : null
    },
    async cancel(reference, lastName) {
      const result = await pool.query(
        `UPDATE bookings SET status = 'cancelled' WHERE reference = $1 AND lower($2) = ANY (SELECT lower(n) FROM unnest(last_names) n) RETURNING payload, status`,
        [reference, lastName],
      )
      return result.rows[0] ? row(result.rows[0]) : null
    },
    async list(limit) {
      const result = await pool.query('SELECT payload, status FROM bookings ORDER BY created_at DESC LIMIT $1', [limit])
      return result.rows.map(row)
    },
    async stats() {
      const result = await pool.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
        count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
        count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS last24h,
        coalesce(sum(total_usd) FILTER (WHERE status = 'confirmed'), 0)::float AS "revenueUsd"
        FROM bookings`)
      return result.rows[0]
    },
    async close() {
      await pool.end()
    },
  }
}
