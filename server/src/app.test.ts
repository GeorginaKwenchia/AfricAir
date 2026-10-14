import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHandler, type AppDeps } from './app.js'
import { loadSettings, parsePromoCodes, secretReader } from './config.js'
import { createStore } from './db.js'
import { createMetrics } from './metrics.js'
import { migrate } from './migrate.js'

// Set TEST_DATABASE_URL (e.g. postgres://africair@localhost:5432/africair_test) to run the database tests.
const DATABASE_URL = process.env.TEST_DATABASE_URL ?? null

function booking(reference: string, extra: Record<string, unknown> = {}) {
  return {
    reference,
    createdAt: new Date().toISOString(),
    status: 'confirmed',
    search: { tripType: 'round', from: 'NBO', to: 'LOS', departDate: '2026-12-01', returnDate: '2026-12-08', cabin: 'economy', passengers: { adults: 1, children: 0, infants: 0 } },
    passengers: [{ type: 'adult', firstName: 'Amina', lastName: "N'Diaye", ticketNumber: '962-0000000001' }],
    fare: { lines: [], base: 500, taxes: 80, service: 15, total: 595 },
    currency: { code: 'USD', rate: 1 },
    ...extra,
  }
}

async function startApp(env: Record<string, string>, withDb = false) {
  const settings = loadSettings({ METRICS_PORT: '0', ...env })
  const store = withDb ? createStore(DATABASE_URL, settings) : null
  const deps: AppDeps = {
    settings,
    secrets: { adminToken: secretReader('ADMIN_TOKEN', env, 0), promoCodes: secretReader('PROMO_CODES', env, 0), databaseUrl: { value: withDb ? DATABASE_URL : null, source: withDb ? 'env' : 'none', loadedAt: '' } },
    store,
    metrics: createMetrics(false),
    isShuttingDown: () => false,
    log: () => undefined,
  }
  const server: Server = createServer(createHandler(deps))
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const base = `http://localhost:${(server.address() as AddressInfo).port}`
  const call = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
    return { status: response.status, body: await response.json() as Record<string, any> }
  }
  return { call, deps, close: async () => { server.close(); await store?.close() } }
}

describe('configuration', () => {
  it('applies defaults and clamps values', () => {
    const settings = loadSettings({ SERVICE_FEE_USD: '9999', DEFAULT_CURRENCY: 'eur', DEFAULT_LANGUAGE: 'de', FEATURE_DESTINATIONS: 'false' })
    expect(settings.serviceFeeUsd).toBe(500)
    expect(settings.defaultCurrency).toBe('EUR')
    expect(settings.defaultLanguage).toBeNull()
    expect(settings.features.destinations).toBe(false)
    expect(settings.appEnv).toBe('local')
    expect(loadSettings({ APP_ENV: 'production' }).exposeFingerprints).toBe(false)
  })

  it('parses promo codes as a list or JSON and ignores junk', () => {
    expect([...parsePromoCodes('save10:10, WELCOME:15,bad,x:5,BIG:90')]).toEqual([['SAVE10', 10], ['WELCOME', 15], ['BIG', 50]])
    expect([...parsePromoCodes('{"AFRICA20": 20}')]).toEqual([['AFRICA20', 20]])
    expect(parsePromoCodes(null).size).toBe(0)
  })

  it('prefers NAME_FILE and picks up a rotated file after the refresh interval', () => {
    const dir = mkdtempSync(join(tmpdir(), 'africair-'))
    const file = join(dir, 'admin-token')
    writeFileSync(file, 'first-token\n')
    let now = 1_000_000
    const read = secretReader('ADMIN_TOKEN', { ADMIN_TOKEN: 'from-env', ADMIN_TOKEN_FILE: file }, 10, () => now)
    expect(read()).toMatchObject({ value: 'first-token', source: 'file' })
    writeFileSync(file, 'rotated-token')
    expect(read().value).toBe('first-token') // still cached
    now += 11_000
    expect(read().value).toBe('rotated-token')
    expect(secretReader('ADMIN_TOKEN', { ADMIN_TOKEN_FILE: join(dir, 'missing') }, 0)()).toMatchObject({ value: null, source: 'file' })
    expect(secretReader('ADMIN_TOKEN', {}, 0)()).toMatchObject({ value: null, source: 'none' })
  })
})

describe('API without a database', () => {
  let app: Awaited<ReturnType<typeof startApp>>
  beforeAll(async () => {
    app = await startApp({ APP_ENV: 'staging', BRAND_NAME: 'AfricAir Staging', ANNOUNCEMENT_TEXT: 'Hello', MAINTENANCE_MODE: 'false', PROMO_CODES: 'SAVE10:10', ADMIN_TOKEN: 'secret-token' })
  })
  afterAll(() => app.close())

  it('serves public config without leaking secret values', async () => {
    const { status, body } = await app.call('/api/config')
    expect(status).toBe(200)
    expect(body).toMatchObject({ appEnv: 'staging', brandName: 'AfricAir Staging', storage: 'browser', announcement: { text: 'Hello', level: 'info' }, features: { promoCodes: true } })
    expect(body.secrets.adminToken).toMatchObject({ configured: true, source: 'env' })
    expect(body.secrets.adminToken.fingerprint).toMatch(/^[0-9a-f]{8}$/)
    expect(body.secrets.database.status).toBe('not-configured')
    expect(JSON.stringify(body)).not.toContain('secret-token')
    expect(JSON.stringify(body)).not.toContain('SAVE10')
  })

  it('validates promo codes server-side', async () => {
    expect((await app.call('/api/promo/validate', { method: 'POST', body: JSON.stringify({ code: 'save10' }) })).body).toEqual({ valid: true, code: 'SAVE10', percent: 10 })
    expect((await app.call('/api/promo/validate', { method: 'POST', body: JSON.stringify({ code: 'NOPE' }) })).body).toEqual({ valid: false })
    expect((await app.call('/api/promo/validate', { method: 'POST', body: 'not json' })).status).toBe(400)
  })

  it('reports health, missing storage and auth errors', async () => {
    expect((await app.call('/api/healthz')).status).toBe(200)
    expect((await app.call('/api/readyz')).body).toEqual({ status: 'ready', db: 'not-configured' })
    expect((await app.call('/api/bookings', { method: 'POST', body: JSON.stringify(booking('ABC234')) })).status).toBe(503)
    expect((await app.call('/api/admin/bookings')).status).toBe(401)
    expect((await app.call('/api/admin/bookings', { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401)
    expect((await app.call('/api/nope')).status).toBe(404)
    expect((await app.call('/api/config', { method: 'DELETE' })).status).toBe(405)
  })

  it('disables admin when no token is configured and blocks bookings in maintenance', async () => {
    const other = await startApp({ MAINTENANCE_MODE: 'true' })
    expect((await other.call('/api/admin/bookings', { headers: { Authorization: 'Bearer x' } })).status).toBe(404)
    expect((await other.call('/api/config')).body).toMatchObject({ maintenanceMode: true, features: { promoCodes: false } })
    expect((await other.call('/api/bookings', { method: 'POST', body: JSON.stringify(booking('ABC234')) })).status).toBe(503)
    await other.close()
  })

  it('rate-limits promo guessing', async () => {
    const other = await startApp({ PROMO_CODES: 'SAVE10:10' })
    const statuses = []
    for (let i = 0; i < 22; i++) statuses.push((await other.call('/api/promo/validate', { method: 'POST', body: JSON.stringify({ code: `X${i}` }) })).status)
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true)
    expect(statuses.slice(20)).toEqual([429, 429])
    await other.close()
  })
})

describe.runIf(DATABASE_URL)('API with PostgreSQL', () => {
  let app: Awaited<ReturnType<typeof startApp>>
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const reference = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')

  beforeAll(async () => {
    const settings = loadSettings({})
    await migrate(DATABASE_URL, settings, () => undefined)
    expect(await migrate(DATABASE_URL, settings, () => undefined)).toBe(0) // idempotent
    app = await startApp({ PROMO_CODES: 'SAVE10:10', ADMIN_TOKEN: 'secret-token' }, true)
  })
  afterAll(() => app.close())

  it('stores, finds, cancels and lists bookings', async () => {
    expect((await app.call('/api/config')).body).toMatchObject({ storage: 'database', secrets: { database: { status: 'connected' } } })
    expect((await app.call('/api/readyz')).body).toEqual({ status: 'ready', db: 'connected' })
    expect((await app.call('/api/bookings', { method: 'POST', body: JSON.stringify(booking(reference)) })).status).toBe(201)
    expect((await app.call('/api/bookings', { method: 'POST', body: JSON.stringify(booking(reference)) })).status).toBe(409)

    expect((await app.call(`/api/bookings/${reference}?lastName=n'diaye`)).body).toMatchObject({ reference, status: 'confirmed' })
    expect((await app.call(`/api/bookings/${reference}?lastName=Smith`)).status).toBe(404)

    const cancelled = await app.call(`/api/bookings/${reference}/cancel`, { method: 'POST', body: JSON.stringify({ lastName: "N'DIAYE" }) })
    expect(cancelled.body.status).toBe('cancelled')

    const admin = await app.call('/api/admin/bookings?limit=5', { headers: { Authorization: 'Bearer secret-token' } })
    expect(admin.status).toBe(200)
    expect(admin.body.stats.total).toBeGreaterThanOrEqual(1)
    expect(admin.body.bookings.some((b: { reference: string }) => b.reference === reference)).toBe(true)
  })

  it('reports an unreachable database as 503, not as browser storage', async () => {
    const broken = await startApp({}, true)
    broken.deps.store!.ping = async () => { throw new Error('connection refused') }
    broken.deps.store!.insert = async () => { throw new Error('connection refused') }
    const config = await broken.call('/api/config')
    expect(config.body).toMatchObject({ storage: 'database', secrets: { database: { status: 'error' } } })
    expect((await broken.call('/api/readyz')).status).toBe(503)
    const saved = await broken.call('/api/bookings', { method: 'POST', body: JSON.stringify(booking('QQQ234')) })
    expect(saved).toEqual({ status: 503, body: { error: 'bookings database is unavailable' } })
    await broken.close()
  })

  it('rejects forged or invalid bookings', async () => {
    const forged = booking('FAKE22', { fare: { total: 100, discount: { code: 'FREE', percent: 50, amountUsd: 100 } } })
    expect((await app.call('/api/bookings', { method: 'POST', body: JSON.stringify(forged) })).status).toBe(422)
    const wrongPercent = booking('FAKE23', { fare: { total: 100, discount: { code: 'SAVE10', percent: 40, amountUsd: 100 } } })
    expect((await app.call('/api/bookings', { method: 'POST', body: JSON.stringify(wrongPercent) })).status).toBe(422)
    expect((await app.call('/api/bookings', { method: 'POST', body: JSON.stringify({ reference: 'bad' }) })).status).toBe(422)
  })
})
