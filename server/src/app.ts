import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fingerprint, parsePromoCodes, type SecretValue, type Settings } from './config.js'
import type { BookingRecord, BookingStore } from './db.js'
import type { Metrics } from './metrics.js'

export type AppDeps = {
  settings: Settings
  secrets: { adminToken: () => SecretValue; promoCodes: () => SecretValue; databaseUrl: SecretValue }
  store: BookingStore | null
  metrics: Metrics
  isShuttingDown: () => boolean
  log: (level: string, msg: string, extra?: Record<string, unknown>) => void
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

const MAX_BODY_BYTES = 64 * 1024
const REFERENCE = /^[A-Z2-9]{6}$/
const AIRPORT = /^[A-Z]{3}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const CABINS = ['economy', 'premium', 'business', 'first']
const PROBES = new Set(['/api/healthz', '/api/readyz']) // not logged when healthy: kubelet calls them every few seconds

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'request body too large')
    chunks.push(chunk as Buffer)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    return parsed
  } catch {
    throw new HttpError(400, 'invalid JSON body')
  }
}

const sameSecret = (given: string, expected: string) => {
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/** Validates the booking document sent by the front end and extracts the indexed columns. */
export function toBookingRecord(body: Record<string, unknown>): BookingRecord {
  const fail = (message: string): never => { throw new HttpError(422, message) }
  const booking = body as {
    reference?: unknown; status?: unknown; search?: Record<string, unknown>; passengers?: unknown
    fare?: { total?: unknown; discount?: { code?: unknown } }; currency?: { code?: unknown }
  }
  const reference = typeof booking.reference === 'string' && REFERENCE.test(booking.reference) ? booking.reference : fail('invalid reference')
  const search = booking.search ?? fail('missing search')
  const origin = typeof search.from === 'string' && AIRPORT.test(search.from) ? search.from : fail('invalid origin')
  const destination = typeof search.to === 'string' && AIRPORT.test(search.to) ? search.to : fail('invalid destination')
  const departDate = typeof search.departDate === 'string' && ISO_DATE.test(search.departDate) ? search.departDate : fail('invalid departDate')
  const returnDate = search.tripType === 'round' && typeof search.returnDate === 'string' && ISO_DATE.test(search.returnDate) ? search.returnDate : null
  const cabin = typeof search.cabin === 'string' && CABINS.includes(search.cabin) ? search.cabin : fail('invalid cabin')
  const passengers = Array.isArray(booking.passengers) && booking.passengers.length >= 1 && booking.passengers.length <= 9 ? booking.passengers as Record<string, unknown>[] : fail('invalid passengers')
  const lastNames = passengers.map((p) => (typeof p.lastName === 'string' && p.lastName.trim() && p.lastName.length <= 80 ? p.lastName.trim() : fail('invalid passenger lastName')))
  const totalUsd = typeof booking.fare?.total === 'number' && booking.fare.total >= 0 && booking.fare.total < 1_000_000 ? booking.fare.total : fail('invalid fare total')
  const currency = typeof booking.currency?.code === 'string' && AIRPORT.test(booking.currency.code) ? booking.currency.code : fail('invalid currency')
  const promoCode = typeof booking.fare?.discount?.code === 'string' ? booking.fare.discount.code.toUpperCase() : null
  return { reference, status: 'confirmed', origin, destination, departDate, returnDate, cabin, passengers: passengers.length, lastNames, totalUsd, currency, promoCode, payload: { ...body, status: 'confirmed' } }
}

export function createHandler(deps: AppDeps) {
  const { settings, secrets, store, metrics } = deps
  const promoAttempts = new Map<string, { count: number; resetAt: number }>()
  let lastDbCheck: { at: number; ok: boolean; error?: string } = { at: 0, ok: false }

  const dbStatus = async (): Promise<'connected' | 'error' | 'not-configured'> => {
    if (!store) {
      metrics.dbUp.set(-1)
      return 'not-configured'
    }
    if (Date.now() - lastDbCheck.at > 5000) {
      try {
        await store.ping()
        lastDbCheck = { at: Date.now(), ok: true }
      } catch (error) {
        lastDbCheck = { at: Date.now(), ok: false, error: (error as Error).message }
        deps.log('warn', 'database check failed', { error: lastDbCheck.error })
      }
    }
    metrics.dbUp.set(lastDbCheck.ok ? 1 : 0)
    return lastDbCheck.ok ? 'connected' : 'error'
  }

  const promoCodes = () => parsePromoCodes(secrets.promoCodes().value)
  const requireStore = (): BookingStore => {
    if (!store) throw new HttpError(503, 'bookings database is not configured')
    // Database failures (down, wrong password, schema missing) become a clear 503 instead of a generic 500.
    const guard = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => async (...args: A) => {
      try {
        return await fn(...args)
      } catch (error) {
        deps.log('error', 'database operation failed', { error: (error as Error).message })
        throw new HttpError(503, 'bookings database is unavailable')
      }
    }
    return { ...store, insert: guard(store.insert), find: guard(store.find), cancel: guard(store.cancel), list: guard(store.list), stats: guard(store.stats) }
  }
  const requireAdmin = (req: IncomingMessage) => {
    const token = secrets.adminToken().value
    if (!token) {
      metrics.adminLogins.inc({ result: 'disabled' })
      throw new HttpError(404, 'admin is disabled: no ADMIN_TOKEN configured')
    }
    const given = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
    if (!given || !sameSecret(given, token)) {
      metrics.adminLogins.inc({ result: 'denied' })
      throw new HttpError(401, 'invalid admin token')
    }
    metrics.adminLogins.inc({ result: 'ok' })
  }
  const clientIp = (req: IncomingMessage) => String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown'

  type Route = { method: string; pattern: RegExp; name: string; handle: (req: IncomingMessage, match: RegExpMatchArray, url: URL) => Promise<[number, unknown]> }
  const routes: Route[] = [
    { method: 'GET', pattern: /^\/api\/healthz$/, name: '/api/healthz', handle: async () => [200, { status: 'ok' }] },
    {
      method: 'GET', pattern: /^\/api\/readyz$/, name: '/api/readyz',
      handle: async () => {
        if (deps.isShuttingDown()) return [503, { status: 'shutting-down' }]
        const db = await dbStatus()
        return db === 'error' ? [503, { status: 'not-ready', db }] : [200, { status: 'ready', db }]
      },
    },
    {
      method: 'GET', pattern: /^\/api\/config$/, name: '/api/config',
      handle: async () => {
        const admin = secrets.adminToken()
        const promo = secrets.promoCodes()
        const codes = promoCodes()
        const db = await dbStatus()
        metrics.maintenance.set(settings.maintenanceMode ? 1 : 0)
        return [200, {
          appEnv: settings.appEnv,
          version: settings.version,
          commit: settings.commit,
          brandName: settings.brandName,
          supportEmail: settings.supportEmail,
          supportPhone: settings.supportPhone,
          announcement: settings.announcement ? { text: settings.announcement, level: settings.announcementLevel } : null,
          defaultLanguage: settings.defaultLanguage,
          defaultCurrency: settings.defaultCurrency,
          serviceFeeUsd: settings.serviceFeeUsd,
          maintenanceMode: settings.maintenanceMode,
          features: { ...settings.features, promoCodes: settings.features.promoCodes && codes.size > 0 },
          // A configured-but-unreachable database stays "database": bookings then fail visibly instead of silently going local.
          storage: store ? 'database' : 'browser',
          // Which secrets are present and where they came from. Values are never returned.
          secrets: {
            database: { status: db, source: secrets.databaseUrl.source === 'none' && store ? 'env' : secrets.databaseUrl.source },
            adminToken: { configured: !!admin.value, source: admin.source, loadedAt: admin.loadedAt, error: admin.error, fingerprint: settings.exposeFingerprints ? fingerprint(admin.value) : undefined },
            promoCodes: { count: codes.size, source: promo.source, loadedAt: promo.loadedAt, error: promo.error, fingerprint: settings.exposeFingerprints ? fingerprint(promo.value) : undefined },
          },
        }]
      },
    },
    {
      method: 'POST', pattern: /^\/api\/promo\/validate$/, name: '/api/promo/validate',
      handle: async (req) => {
        const ip = clientIp(req)
        const now = Date.now()
        const attempt = promoAttempts.get(ip)
        if (attempt && attempt.resetAt > now && attempt.count >= 20) {
          metrics.promoValidations.inc({ result: 'rate-limited' })
          throw new HttpError(429, 'too many promo code attempts, try again in a minute')
        }
        promoAttempts.set(ip, attempt && attempt.resetAt > now ? { ...attempt, count: attempt.count + 1 } : { count: 1, resetAt: now + 60_000 })
        const body = await readJson(req)
        const code = String(body.code ?? '').trim().toUpperCase()
        const percent = settings.features.promoCodes ? promoCodes().get(code) : undefined
        metrics.promoValidations.inc({ result: percent ? 'valid' : 'invalid' })
        return [200, percent ? { valid: true, code, percent } : { valid: false }]
      },
    },
    {
      method: 'POST', pattern: /^\/api\/bookings$/, name: '/api/bookings',
      handle: async (req) => {
        if (settings.maintenanceMode) throw new HttpError(503, 'bookings are paused for maintenance')
        const db = requireStore()
        const body = await readJson(req)
        const record = toBookingRecord(body)
        if (record.promoCode) {
          const percent = promoCodes().get(record.promoCode)
          const claimed = Number((body.fare as { discount?: { percent?: unknown } }).discount?.percent)
          if (!percent || percent !== claimed) throw new HttpError(422, 'promo code is not valid')
        }
        if ((await db.insert(record)) === 'duplicate') throw new HttpError(409, 'booking reference already exists')
        const tripType = record.returnDate ? 'round' : 'oneway'
        metrics.bookingsCreated.inc({ cabin: record.cabin, trip_type: tripType })
        metrics.bookingValueUsd.inc(record.totalUsd)
        deps.log('info', 'booking created', { reference: record.reference, route: `${record.origin}-${record.destination}`, cabin: record.cabin, passengers: record.passengers })
        return [201, { reference: record.reference, storage: 'database' }]
      },
    },
    {
      method: 'GET', pattern: /^\/api\/bookings\/([A-Z2-9]{6})$/, name: '/api/bookings/:reference',
      handle: async (_req, match, url) => {
        const lastName = url.searchParams.get('lastName')?.trim()
        if (!lastName) throw new HttpError(400, 'lastName is required')
        const booking = await requireStore().find(match[1], lastName)
        if (!booking) throw new HttpError(404, 'booking not found')
        return [200, booking]
      },
    },
    {
      method: 'POST', pattern: /^\/api\/bookings\/([A-Z2-9]{6})\/cancel$/, name: '/api/bookings/:reference/cancel',
      handle: async (req, match) => {
        const body = await readJson(req)
        const lastName = String(body.lastName ?? '').trim()
        if (!lastName) throw new HttpError(400, 'lastName is required')
        const booking = await requireStore().cancel(match[1], lastName)
        if (!booking) throw new HttpError(404, 'booking not found')
        metrics.bookingsCancelled.inc()
        return [200, booking]
      },
    },
    {
      method: 'GET', pattern: /^\/api\/admin\/bookings$/, name: '/api/admin/bookings',
      handle: async (req, _match, url) => {
        requireAdmin(req)
        const db = requireStore()
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50))
        const [bookings, stats] = await Promise.all([db.list(limit), db.stats()])
        return [200, { stats, bookings }]
      },
    },
  ]

  return async (req: IncomingMessage, res: ServerResponse) => {
    const started = process.hrtime.bigint()
    const url = new URL(req.url ?? '/', 'http://localhost')
    let route: Route | undefined
    let match: RegExpMatchArray | null = null
    for (const candidate of routes) {
      match = url.pathname.match(candidate.pattern)
      if (match && candidate.method === req.method) {
        route = candidate
        break
      }
    }
    const routeName = route?.name ?? (routes.some((r) => r.pattern.test(url.pathname)) ? url.pathname.replace(/[A-Z2-9]{6}/, ':reference') : 'unmatched')
    let status = 500
    try {
      if (!route) {
        status = routes.some((r) => r.pattern.test(url.pathname)) ? 405 : 404
        send(res, status, { error: status === 405 ? 'method not allowed' : 'not found' })
        return
      }
      const [code, body] = await route.handle(req, match!, url)
      status = code
      send(res, status, body)
    } catch (error) {
      status = error instanceof HttpError ? error.status : 500
      if (status === 500) deps.log('error', 'request failed', { route: routeName, error: (error as Error).message })
      send(res, status, { error: status === 500 ? 'internal error' : (error as Error).message })
    } finally {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9
      metrics.httpRequests.inc({ method: req.method ?? 'GET', route: routeName, status: String(status) })
      metrics.httpDuration.observe({ method: req.method ?? 'GET', route: routeName }, seconds)
      if (!PROBES.has(routeName) || status >= 400) {
        deps.log(status >= 500 ? 'error' : 'info', 'request', { method: req.method, route: routeName, status, ms: Math.round(seconds * 1000) })
      }
    }
  }
}
