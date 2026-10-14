import { useEffect, useState } from 'react'
import { CircleAlert, Info, KeyRound, LogOut, Megaphone, RefreshCw, ShieldCheck, TriangleAlert, Wrench } from 'lucide-react'
import { useApp } from '../context'
import { AIRPORT_BY_CODE } from '../data/airports'
import { ApiError, fetchAdminBookings, type AdminData, type RuntimeConfig } from '../lib/api'
import { JourneyHeading } from './Shared'

/** Coloured strip naming the environment (hidden in production and in static mode). */
export function EnvironmentBanner() {
  const { config, t } = useApp()
  if (!config.available || config.appEnv === 'production') return null
  const tone = ['dev', 'development', 'local'].includes(config.appEnv) ? 'dev' : ['staging', 'stage', 'qa', 'test'].includes(config.appEnv) ? 'staging' : 'other'
  return <div className={`env-banner env-${tone}`} role="note" data-testid="env-banner">
    {t.envBanner(config.appEnv, `${config.version}${config.commit !== 'unknown' ? ` (${config.commit.slice(0, 7)})` : ''}`)}
  </div>
}

export function AnnouncementBar() {
  const { config } = useApp()
  if (!config.announcement) return null
  const Icon = config.announcement.level === 'critical' ? TriangleAlert : config.announcement.level === 'warning' ? CircleAlert : Megaphone
  return <div className={`announcement announcement-${config.announcement.level}`} role="status" data-testid="announcement">
    <Icon size={16} aria-hidden="true" /><span>{config.announcement.text}</span>
  </div>
}

export function MaintenanceNotice() {
  const { t } = useApp()
  return <div className="maintenance-notice" role="alert" data-testid="maintenance">
    <Wrench size={20} aria-hidden="true" />
    <div><strong>{t.maintenanceTitle}</strong><p>{t.maintenanceText}</p></div>
  </div>
}

export function StatusPage({ onRefresh }: { onRefresh: () => Promise<RuntimeConfig> }) {
  const { t, config, money, language } = useApp()
  const [refreshing, setRefreshing] = useState(false)
  const refresh = async () => {
    setRefreshing(true)
    await onRefresh()
    setRefreshing(false)
  }
  useEffect(() => { void refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onOff = (value: boolean) => <span className={`pill ${value ? 'pill-on' : 'pill-off'}`}>{value ? t.on : t.off}</span>
  const sourceLabel = (source?: string) => (source === 'file' ? t.sourceFile : source === 'env' ? t.sourceEnv : t.sourceNone)
  const time = (iso?: string) => (iso ? new Intl.DateTimeFormat(language, { timeStyle: 'medium' }).format(new Date(iso)) : '—')
  const secrets = config.secrets

  return <main className="booking-shell narrow-shell">
    <JourneyHeading title={t.statusTitle} subtitle={t.statusSubtitle}>
      <button className="button button-ghost status-refresh" onClick={refresh} disabled={refreshing}><RefreshCw size={15} className={refreshing ? 'spin' : ''} />{t.refresh}</button>
    </JourneyHeading>
    <div className="status-grid">
      <section className="review-card">
        <h2>{t.apiLabel}</h2>
        <dl className="status-list" data-testid="status-config">
          <dt>{t.apiLabel}</dt><dd>{config.available ? <span className="pill pill-on">{t.apiReachable}</span> : <span className="pill pill-off">{t.apiUnavailable}</span>}</dd>
          <dt>{t.environment}</dt><dd><code>{config.appEnv}</code></dd>
          <dt>{t.versionLabel}</dt><dd><code>{config.version}</code> · <code>{config.commit.slice(0, 12)}</code></dd>
          <dt>{t.brandLabel}</dt><dd>{config.brandName}</dd>
          <dt>{t.supportLabel}</dt><dd>{config.supportEmail}{config.supportPhone && ` · ${config.supportPhone}`}</dd>
          <dt>{t.storageLabel}</dt><dd>{config.storage === 'database' ? t.storageDb : t.storageLocal}</dd>
          <dt>{t.maintenance}</dt><dd>{onOff(config.maintenanceMode)}</dd>
          <dt>{t.serviceFeeLabel}</dt><dd>{money(config.serviceFeeUsd)}</dd>
          <dt>{t.defaultsLabel}</dt><dd>{config.defaultLanguage ?? '—'} / {config.defaultCurrency ?? '—'}</dd>
          <dt>{t.announcementLabel}</dt><dd>{config.announcement ? `[${config.announcement.level}] ${config.announcement.text}` : t.none}</dd>
          <dt>{t.featuresLabel}</dt>
          <dd className="feature-pills">
            <span>{t.navDestinations} {onOff(config.features.destinations)}</span>
            <span>{t.navTrips} {onOff(config.features.myTrips)}</span>
            <span>{t.promoCode} {onOff(config.features.promoCodes)}</span>
          </dd>
        </dl>
      </section>
      <section className="review-card">
        <h2><KeyRound size={18} /> {t.secretsTitle}</h2>
        {!secrets ? <p className="empty-state"><Info size={16} />{t.apiUnavailable}</p> : <div className="table-scroll"><table className="secrets-table" data-testid="status-secrets">
          <thead><tr><th>{t.secretName}</th><th>{t.secretStatus}</th><th>{t.secretSource}</th><th>{t.secretLoaded}</th><th>{t.secretFingerprint}</th></tr></thead>
          <tbody>
            <tr>
              <td>{t.databaseLabel}</td>
              <td>{secrets.database.status === 'connected' ? <span className="pill pill-on">{t.dbConnected}</span> : secrets.database.status === 'error' ? <span className="pill pill-error">{t.dbError}</span> : <span className="pill pill-off">{t.notConfigured}</span>}</td>
              <td>{sourceLabel(secrets.database.source)}</td><td>—</td><td>—</td>
            </tr>
            <tr>
              <td>{t.adminTokenLabel}</td>
              <td>{secrets.adminToken.error ? <span className="pill pill-error">{secrets.adminToken.error}</span> : secrets.adminToken.configured ? <span className="pill pill-on">{t.configuredLabel}</span> : <span className="pill pill-off">{t.notConfigured}</span>}</td>
              <td>{sourceLabel(secrets.adminToken.source)}</td><td>{time(secrets.adminToken.loadedAt)}</td><td><code>{secrets.adminToken.fingerprint ?? '—'}</code></td>
            </tr>
            <tr>
              <td>{t.promoCodesLabel}</td>
              <td>{secrets.promoCodes.error ? <span className="pill pill-error">{secrets.promoCodes.error}</span> : secrets.promoCodes.count ? <span className="pill pill-on">{t.codesCount(secrets.promoCodes.count)}</span> : <span className="pill pill-off">{t.notConfigured}</span>}</td>
              <td>{sourceLabel(secrets.promoCodes.source)}</td><td>{time(secrets.promoCodes.loadedAt)}</td><td><code>{secrets.promoCodes.fingerprint ?? '—'}</code></td>
            </tr>
          </tbody>
        </table></div>}
      </section>
    </div>
  </main>
}

const ADMIN_TOKEN_KEY = 'africair.admin-token'

export function AdminPage() {
  const { t, date } = useApp()
  const [token, setToken] = useState(() => { try { return sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? '' } catch { return '' } })
  const [input, setInput] = useState('')
  const [data, setData] = useState<AdminData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = async (value: string) => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchAdminBookings(value)
      setData(result)
      setToken(value)
      try { sessionStorage.setItem(ADMIN_TOKEN_KEY, value) } catch { /* storage unavailable */ }
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0
      setData(null)
      setError(status === 404 ? t.adminDisabled : status === 401 ? t.adminDenied : status === 503 ? t.adminNoDb : t.adminUnavailable)
      if (status === 401) signOut()
    } finally {
      setLoading(false)
    }
  }
  const signOut = () => {
    setToken('')
    setData(null)
    try { sessionStorage.removeItem(ADMIN_TOKEN_KEY) } catch { /* storage unavailable */ }
  }
  useEffect(() => { if (token) void load(token) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const usd = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)

  return <main className="booking-shell narrow-shell">
    <JourneyHeading title={t.adminTitle} subtitle={t.adminSubtitle} />
    {!data && <form className="review-card admin-login" onSubmit={(event) => { event.preventDefault(); void load(input.trim()) }}>
      <div className="form-field"><label htmlFor="admin-token">{t.adminTokenInput}</label><input id="admin-token" type="password" autoComplete="off" value={input} onChange={(event) => setInput(event.target.value)} required /></div>
      {error && <p className="inline-error" role="alert"><CircleAlert size={16} />{error}</p>}
      <button className="button button-primary" type="submit" disabled={loading}><ShieldCheck size={16} />{t.signIn}</button>
    </form>}
    {data && <div className="admin-view">
      <div className="stat-row">
        {[[t.statTotal, data.stats.total], [t.statConfirmed, data.stats.confirmed], [t.statCancelled, data.stats.cancelled], [t.statLast24h, data.stats.last24h], [t.statRevenue, usd(data.stats.revenueUsd)]].map(([label, value]) => <div className="stat-tile" key={String(label)}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
      <section className="review-card">
        <div className="review-card-head"><h2>{t.statTotal}</h2><span className="admin-actions"><button className="text-button" onClick={() => void load(token)}><RefreshCw size={13} /> {t.refresh}</button><button className="text-button" onClick={signOut}><LogOut size={13} /> {t.signOut}</button></span></div>
        {data.bookings.length === 0 ? <p className="empty-state">{t.noBookingsYet}</p> : <div className="table-scroll"><table className="admin-table" data-testid="admin-bookings">
          <thead><tr><th>{t.reference}</th><th>{t.status}</th><th>{t.routeLabel}</th><th>{t.departure}</th><th>{t.travellers}</th><th>{t.total}</th><th>{t.created}</th></tr></thead>
          <tbody>{data.bookings.map((booking) => <tr key={booking.reference}>
            <td><code>{booking.reference}</code></td>
            <td><span className={`status-pill ${booking.status}`}>{booking.status === 'confirmed' ? t.confirmed : t.cancelled}</span></td>
            <td>{AIRPORT_BY_CODE.get(booking.search.from)?.city ?? booking.search.from} → {AIRPORT_BY_CODE.get(booking.search.to)?.city ?? booking.search.to}</td>
            <td>{date(booking.search.departDate, 'numeric')}</td>
            <td>{booking.passengers.length}</td>
            <td>{usd(booking.fare.total)}{booking.fare.discount && <small> ({booking.fare.discount.code})</small>}</td>
            <td>{date(booking.createdAt.slice(0, 10), 'numeric')}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>
    </div>}
  </main>
}
