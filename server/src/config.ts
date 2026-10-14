import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'

/**
 * All runtime configuration comes from environment variables, so the same image can run in any environment.
 *
 * Settings (plain env vars) are read once at startup: changing them requires a restart / new pod.
 * Secrets may be given either as `NAME=value` or as `NAME_FILE=/path/to/file`. File-based secrets are
 * re-read every SECRET_REFRESH_SECONDS, so a rotated Kubernetes Secret mounted as a volume is picked up
 * without restarting the pod. Env-var secrets only change on restart.
 */

export type Env = Record<string, string | undefined>

const LANGUAGES = ['en', 'fr']
const BANNER_LEVELS = ['info', 'warning', 'critical']

const bool = (value: string | undefined, fallback: boolean) => {
  if (value === undefined || value.trim() === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

const number = (value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && value !== undefined && value.trim() !== '' ? Math.min(max, Math.max(min, parsed)) : fallback
}

export function loadSettings(env: Env = process.env) {
  const appEnv = (env.APP_ENV ?? 'local').trim().toLowerCase() || 'local'
  const announcementLevel = (env.ANNOUNCEMENT_LEVEL ?? 'info').trim().toLowerCase()
  const defaultLanguage = (env.DEFAULT_LANGUAGE ?? '').trim().toLowerCase()
  const defaultCurrency = (env.DEFAULT_CURRENCY ?? '').trim().toUpperCase()
  return {
    port: number(env.PORT, 4000, 1, 65535),
    metricsPort: number(env.METRICS_PORT, 9464, 1, 65535),
    appEnv,
    version: env.APP_VERSION ?? 'dev',
    commit: env.GIT_SHA ?? 'unknown',
    brandName: (env.BRAND_NAME ?? '').trim() || 'AfricAir',
    supportEmail: (env.SUPPORT_EMAIL ?? '').trim() || 'support@africair.example',
    supportPhone: (env.SUPPORT_PHONE ?? '').trim() || null,
    announcement: (env.ANNOUNCEMENT_TEXT ?? '').trim() || null,
    announcementLevel: BANNER_LEVELS.includes(announcementLevel) ? announcementLevel : 'info',
    defaultLanguage: LANGUAGES.includes(defaultLanguage) ? defaultLanguage : null,
    defaultCurrency: /^[A-Z]{3}$/.test(defaultCurrency) ? defaultCurrency : null,
    serviceFeeUsd: number(env.SERVICE_FEE_USD, 15, 0, 500),
    maintenanceMode: bool(env.MAINTENANCE_MODE, false),
    features: {
      destinations: bool(env.FEATURE_DESTINATIONS, true),
      myTrips: bool(env.FEATURE_MY_TRIPS, true),
      promoCodes: bool(env.FEATURE_PROMO_CODES, true),
    },
    /** Short hashes of secrets on the status page, so rotations can be verified. Never on in production. */
    exposeFingerprints: bool(env.EXPOSE_SECRET_FINGERPRINTS, appEnv !== 'production'),
    secretRefreshSeconds: number(env.SECRET_REFRESH_SECONDS, 10, 0, 3600),
    shutdownDelayMs: number(env.SHUTDOWN_DELAY_MS, 5000, 0, 60_000),
    migrateOnStart: bool(env.MIGRATE_ON_START, false),
    dbSsl: (env.DB_SSL ?? '').trim().toLowerCase() as '' | 'disable' | 'require' | 'verify',
    dbSslCaFile: env.DB_SSL_CA_FILE,
    logLevel: (env.LOG_LEVEL ?? 'info').trim().toLowerCase(),
  }
}

export type Settings = ReturnType<typeof loadSettings>

export type SecretValue = { value: string | null; source: 'file' | 'env' | 'none'; error?: string; loadedAt: string }

/** Reads NAME_FILE (preferred) or NAME. File reads are cached for `refreshSeconds`. */
export function secretReader(name: string, env: Env = process.env, refreshSeconds = 10, now = () => Date.now()) {
  let cache: { at: number; mtime: number; value: SecretValue } | null = null
  return (): SecretValue => {
    const file = env[`${name}_FILE`]?.trim()
    if (file) {
      if (cache && now() - cache.at < refreshSeconds * 1000) return cache.value
      try {
        const mtime = statSync(file).mtimeMs
        if (cache && cache.mtime === mtime && cache.value.source === 'file') {
          cache.at = now()
          return cache.value
        }
        const content = readFileSync(file, 'utf8').trim()
        cache = { at: now(), mtime, value: { value: content || null, source: 'file', loadedAt: new Date(now()).toISOString() } }
      } catch (error) {
        cache = { at: now(), mtime: -1, value: { value: null, source: 'file', error: (error as Error).message, loadedAt: new Date(now()).toISOString() } }
      }
      return cache.value
    }
    const value = env[name]?.trim()
    if (!cache || cache.value.value !== (value || null)) {
      cache = { at: now(), mtime: 0, value: { value: value || null, source: value ? 'env' : 'none', loadedAt: new Date(now()).toISOString() } }
    }
    return cache.value
  }
}

/** Parses "SAVE10:10, WELCOME:15" (or a JSON object {"SAVE10":10}) into code → percent. */
export function parsePromoCodes(raw: string | null): Map<string, number> {
  const codes = new Map<string, number>()
  if (!raw) return codes
  let entries: [string, unknown][]
  try {
    const parsed = JSON.parse(raw)
    entries = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.entries(parsed) : []
  } catch {
    entries = raw.split(/[,\n]/).map((item) => item.split(':') as [string, unknown])
  }
  for (const [code, percent] of entries) {
    const key = String(code ?? '').trim().toUpperCase()
    const value = Number(percent)
    if (/^[A-Z0-9_-]{3,32}$/.test(key) && Number.isFinite(value) && value > 0) codes.set(key, Math.min(50, Math.round(value)))
  }
  return codes
}

export const fingerprint = (value: string | null) => (value ? createHash('sha256').update(value).digest('hex').slice(0, 8) : null)
