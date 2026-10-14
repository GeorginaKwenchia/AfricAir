import { createServer } from 'node:http'
import { createHandler } from './app.js'
import { loadSettings, secretReader } from './config.js'
import { createStore, databaseConfigured } from './db.js'
import { createMetrics } from './metrics.js'
import { migrate } from './migrate.js'

const LEVELS = ['debug', 'info', 'warn', 'error']
const settings = loadSettings()
const log = (level: string, msg: string, extra: Record<string, unknown> = {}) => {
  if (LEVELS.indexOf(level) < LEVELS.indexOf(settings.logLevel)) return
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...extra })
  if (level === 'error' || level === 'warn') console.error(line)
  else console.log(line)
}

const secrets = {
  adminToken: secretReader('ADMIN_TOKEN', process.env, settings.secretRefreshSeconds),
  promoCodes: secretReader('PROMO_CODES', process.env, settings.secretRefreshSeconds),
  // The database URL is read once: changing database credentials needs a restart (connection pool).
  databaseUrl: secretReader('DATABASE_URL', process.env, 0)(),
}
if (secrets.databaseUrl.error) log('error', 'could not read DATABASE_URL_FILE', { error: secrets.databaseUrl.error })

const store = databaseConfigured(secrets.databaseUrl.value) ? createStore(secrets.databaseUrl.value, settings) : null
const metrics = createMetrics()
metrics.info.set({ version: settings.version, commit: settings.commit, app_env: settings.appEnv }, 1)
metrics.maintenance.set(settings.maintenanceMode ? 1 : 0)
metrics.dbUp.set(store ? 0 : -1)

let shuttingDown = false
const server = createServer(createHandler({ settings, secrets, store, metrics, isShuttingDown: () => shuttingDown, log }))
const metricsServer = createServer(async (req, res) => {
  if (req.url !== '/metrics') {
    res.writeHead(404).end()
    return
  }
  res.writeHead(200, { 'Content-Type': metrics.registry.contentType })
  res.end(await metrics.registry.metrics())
})

async function start() {
  if (store && settings.migrateOnStart) await migrate(secrets.databaseUrl.value, settings, (msg) => log('info', msg))
  server.listen(settings.port, () => log('info', 'api listening', {
    port: settings.port, metricsPort: settings.metricsPort, appEnv: settings.appEnv, version: settings.version,
    database: store ? 'configured' : 'not-configured', adminToken: secrets.adminToken().source, promoCodes: secrets.promoCodes().source,
  }))
  metricsServer.listen(settings.metricsPort)
}

// Graceful shutdown: fail readiness first so the load balancer stops sending traffic, then drain.
function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  log('info', 'shutdown requested', { signal, delayMs: settings.shutdownDelayMs })
  setTimeout(() => {
    server.close(async () => {
      metricsServer.close()
      await store?.close().catch(() => undefined)
      log('info', 'shutdown complete')
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 10_000).unref()
  }, settings.shutdownDelayMs)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

start().catch((error) => {
  log('error', 'startup failed', { error: (error as Error).message })
  process.exit(1)
})
