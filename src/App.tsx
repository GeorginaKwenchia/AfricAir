import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Plane } from 'lucide-react'
import { Destinations } from './components/Destinations'
import { BrandName, Header } from './components/Header'
import { Home } from './components/Home'
import { Results } from './components/Results'
import { Review } from './components/Review'
import { AdminPage, AnnouncementBar, EnvironmentBanner, StatusPage } from './components/Runtime'
import { Travellers } from './components/Travellers'
import { Confirmation, TripDetail, Trips } from './components/Trips'
import { AppContext, useApp, type AppContextValue } from './context'
import { AIRPORT_BY_CODE } from './data/airports'
import { CURRENCIES, findCurrency, formatMoney } from './data/currencies'
import { TRANSLATIONS } from './i18n'
import { DEFAULT_CONFIG, cancelRemoteBooking, fetchConfig, findRemoteBooking, saveRemoteBooking, type RuntimeConfig } from './lib/api'
import { loadBookings, makeReference, makeTicketNumber, removeBooking, saveBooking, updateBooking } from './lib/bookings'
import { addDays, formatDate, todayIso } from './lib/dates'
import { generateItineraries, priceBooking } from './lib/flights'
import { downloadBookingPdf } from './lib/pdf'
import { navigate, queryToSearch, searchToQuery, useRoute } from './lib/router'
import type { Booking, Contact, Language, Passenger, PassengerType, SearchParams } from './lib/types'
import { validateContact, validatePassenger, validateSearch, type ErrorKey } from './lib/validation'

const PREFS_KEY = 'africair.prefs.v1'
const DRAFT_KEY = 'africair.draft.v1'

type Promo = { code: string; percent: number }
type Draft = { search: SearchParams; outboundId: string; inboundId: string; passengers: Passenger[]; contact: Contact; promo?: Promo }

const emptyPassenger = (type: PassengerType): Passenger => ({ type, gender: '', firstName: '', lastName: '', dob: '', nationality: '', documentNumber: '', documentExpiry: '' })

/** Keeps entered traveller details when the passenger mix changes (adults first, then children, then infants). */
function syncPassengers(counts: SearchParams['passengers'], existing: Passenger[]) {
  const take = (type: PassengerType, count: number) => {
    const current = existing.filter((passenger) => passenger.type === type)
    return Array.from({ length: count }, (_, index) => current[index] ?? emptyPassenger(type))
  }
  return [...take('adult', counts.adults), ...take('child', counts.children), ...take('infant', counts.infants)]
}

function defaultSearch(): SearchParams {
  const today = todayIso()
  return { tripType: 'round', from: 'NBO', to: 'LOS', departDate: addDays(today, 14), returnDate: addDays(today, 21), passengers: { adults: 1, children: 0, infants: 0 }, cabin: 'economy' }
}

function readJson<T>(storage: () => Storage, key: string): Partial<T> {
  try {
    return JSON.parse(storage().getItem(key) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

function writeJson(storage: () => Storage, key: string, value: unknown) {
  try {
    storage().setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be unavailable (private mode, quota); the app keeps working in memory.
  }
}

function loadDraft(): Draft {
  const saved = readJson<Draft>(() => sessionStorage, DRAFT_KEY)
  const fallback = defaultSearch()
  const search = saved.search && AIRPORT_BY_CODE.has(saved.search.from) && AIRPORT_BY_CODE.has(saved.search.to) && saved.search.departDate >= todayIso() ? saved.search : fallback
  return {
    search,
    outboundId: saved.outboundId ?? '',
    inboundId: saved.inboundId ?? '',
    passengers: syncPassengers(search.passengers, Array.isArray(saved.passengers) ? saved.passengers : []),
    contact: { email: saved.contact?.email ?? '', phone: saved.contact?.phone ?? '' },
    promo: saved.promo,
  }
}

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to])
  return null
}

function NotFound() {
  const { t } = useApp()
  return <main className="booking-shell narrow-shell"><section className="confirmation-card">
    <h1>{t.notFoundTitle}</h1><p>{t.notFoundText}</p>
    <button className="button button-primary" onClick={() => navigate('/')}>{t.goHome}</button>
  </section></main>
}

export default function App() {
  const route = useRoute()
  const prefs = useMemo(() => readJson<{ language: Language; currency: string }>(() => localStorage, PREFS_KEY), [])
  const [language, setLanguage] = useState<Language>(prefs.language === 'fr' ? 'fr' : prefs.language === 'en' ? 'en' : navigator.language?.startsWith('fr') ? 'fr' : 'en')
  const [currencyCode, setCurrencyCode] = useState(findCurrency(prefs.currency ?? 'USD').code)
  const [draft, setDraft] = useState<Draft>(loadDraft)
  const [formSearch, setFormSearch] = useState<SearchParams>(draft.search)
  const [searchError, setSearchError] = useState<ErrorKey | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [bookings, setBookings] = useState<Booking[]>(loadBookings)
  const [lastBooking, setLastBooking] = useState<Booking | null>(null)
  const [pdfStatus, setPdfStatus] = useState<'idle' | 'done' | 'failed'>('idle')
  const [submitting, setSubmitting] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [config, setConfig] = useState<RuntimeConfig>(DEFAULT_CONFIG)

  const refreshConfig = useCallback(async () => {
    const next = await fetchConfig()
    setConfig(next)
    return next
  }, [])
  useEffect(() => {
    void refreshConfig().then((next) => {
      // Deployment defaults apply only until the visitor picks their own language / currency.
      if (!prefs.language && next.defaultLanguage) setLanguage(next.defaultLanguage)
      if (!prefs.currency && next.defaultCurrency && CURRENCIES.some((item) => item.code === next.defaultCurrency)) setCurrencyCode(next.defaultCurrency)
    })
  }, [refreshConfig, prefs])
  useEffect(() => { document.title = `${config.brandName} — ${language === 'fr' ? 'réservez vos vols' : 'book your flights'}` }, [config.brandName, language])

  const t = TRANSLATIONS[language]
  const locale = language === 'fr' ? 'fr-FR' : 'en-GB'
  const currency = findCurrency(currencyCode)
  const context = useMemo<AppContextValue>(() => ({
    language, locale, t, currency,
    money: (usd) => formatMoney(usd, currency, locale),
    date: (iso, style) => formatDate(iso, locale, style),
    config,
  }), [language, locale, t, currency, config])

  useEffect(() => { document.documentElement.lang = language }, [language])
  // Only an explicit choice is remembered, so deployment defaults (DEFAULT_LANGUAGE / DEFAULT_CURRENCY) still apply to new visitors.
  const chooseLanguage = (value: Language) => {
    setLanguage(value)
    writeJson(() => localStorage, PREFS_KEY, { ...readJson(() => localStorage, PREFS_KEY), language: value })
  }
  const chooseCurrency = (value: string) => {
    setCurrencyCode(value)
    writeJson(() => localStorage, PREFS_KEY, { ...readJson(() => localStorage, PREFS_KEY), currency: value })
  }
  useEffect(() => writeJson(() => sessionStorage, DRAFT_KEY, draft), [draft])

  // A /flights URL is the source of truth for the active search (shareable, works with back/forward).
  const urlSearch = useMemo(() => (route.path === '/flights' ? queryToSearch(route.params) : null), [route])
  const urlSearchKey = urlSearch ? searchToQuery(urlSearch) : ''
  useEffect(() => {
    if (!urlSearch || urlSearchKey === searchToQuery(draft.search)) return
    setDraft((current) => ({ ...current, search: urlSearch, passengers: syncPassengers(urlSearch.passengers, current.passengers) }))
    setFormSearch(urlSearch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSearchKey])

  const { search } = draft
  const round = search.tripType === 'round'
  const outboundOptions = useMemo(() => generateItineraries(search.from, search.to, search.departDate, search.cabin), [search.from, search.to, search.departDate, search.cabin])
  const inboundOptions = useMemo(() => round ? generateItineraries(search.to, search.from, search.returnDate, search.cabin) : [], [round, search.to, search.from, search.returnDate, search.cabin])
  const outbound = outboundOptions.find((item) => item.id === draft.outboundId)
  const inbound = round ? inboundOptions.find((item) => item.id === draft.inboundId) : undefined
  const flightsChosen = !!outbound && (!round || !!inbound)
  const promo = config.features.promoCodes ? draft.promo : undefined
  const fare = useMemo(() => (outbound ? priceBooking(outbound, inbound, search.passengers, config.serviceFeeUsd, promo) : null), [outbound, inbound, search.passengers, config.serviceFeeUsd, promo])

  const today = todayIso()
  const lastFlight = (inbound ?? outbound)?.segments.slice(-1)[0]
  const passengerErrors = useMemo(() => draft.passengers.map((passenger) => validatePassenger(passenger, search.departDate, lastFlight?.arriveDate ?? search.departDate, today)), [draft.passengers, search.departDate, lastFlight?.arriveDate, today])
  const contactErrors = useMemo(() => validateContact(draft.contact), [draft.contact])
  const travellersValid = passengerErrors.every((errors) => Object.keys(errors).length === 0) && Object.keys(contactErrors).length === 0

  const submitSearch = () => {
    const error = validateSearch(formSearch, (code) => AIRPORT_BY_CODE.has(code), todayIso())
    setSearchError(error)
    if (!error) navigate(`/flights?${searchToQuery(formSearch)}`)
  }

  const download = useCallback((booking: Booking) => {
    try {
      downloadBookingPdf(booking, language)
      setPdfStatus('done')
      return true
    } catch (error) {
      console.error('PDF generation failed', error)
      setPdfStatus('failed')
      return false
    }
  }, [language])

  const confirmBooking = async () => {
    if (!outbound || !fare || !flightsChosen || !travellersValid || submitting || config.maintenanceMode) return
    setSubmitting(true)
    setSaveError('')
    const booking: Booking = {
      reference: makeReference(bookings.map((item) => item.reference)),
      createdAt: new Date().toISOString(),
      status: 'confirmed',
      search,
      outbound,
      ...(inbound ? { inbound } : {}),
      passengers: draft.passengers.map((passenger) => ({
        ...passenger,
        firstName: passenger.firstName.trim(),
        lastName: passenger.lastName.trim(),
        documentNumber: passenger.documentNumber.trim().toUpperCase(),
        ticketNumber: makeTicketNumber(),
      })),
      contact: { email: draft.contact.email.trim(), phone: draft.contact.phone.trim() },
      fare,
      currency: { code: currency.code, rate: currency.rate },
    }
    if (config.storage === 'database') {
      try {
        await saveRemoteBooking(booking)
      } catch (error) {
        setSaveError(t.saveFailed((error as Error).message))
        setSubmitting(false)
        return
      }
    }
    saveBooking(booking)
    setBookings(loadBookings())
    setLastBooking(booking)
    setPdfStatus('idle')
    download(booking) // inside the click handler, so browsers treat the download as user-initiated
    setSubmitting(false)
    navigate(`/confirmation/${booking.reference}`)
  }

  // Once on the confirmation page, clear the finished draft so the next booking starts fresh.
  // (Clearing it before navigating would let the /review guard redirect away first.)
  const onConfirmation = route.path.startsWith('/confirmation/')
  useEffect(() => {
    if (!onConfirmation) return
    setDraft((current) => ({ ...current, outboundId: '', inboundId: '', promo: undefined, passengers: syncPassengers(current.search.passengers, []) }))
    setShowErrors(false)
  }, [onConfirmation])

  const findRemote = async (reference: string, lastName: string) => {
    if (config.storage !== 'database') return undefined
    try {
      const booking = await findRemoteBooking(reference.trim().toUpperCase(), lastName.trim())
      saveBooking(booking) // keep a local copy so it shows under My trips on this device
      setBookings(loadBookings())
      return booking
    } catch {
      return undefined
    }
  }

  const cancelBooking = async (item: Booking) => {
    if (config.storage === 'database') {
      try {
        await cancelRemoteBooking(item.reference, item.passengers[0].lastName)
      } catch (error) {
        window.alert(t.saveFailed((error as Error).message))
        return
      }
    }
    updateBooking(item.reference, { status: 'cancelled' })
    setBookings(loadBookings())
    if (lastBooking?.reference === item.reference) setLastBooking({ ...item, status: 'cancelled' })
  }

  const findStored = (reference: string) => bookings.find((item) => item.reference === reference) ?? (lastBooking?.reference === reference ? lastBooking : undefined)

  const page = (() => {
    const [, section, param] = route.path.split('/')
    switch (`/${section ?? ''}`) {
      case '/':
        return <Home search={formSearch} onChange={(value) => { setFormSearch(value); setSearchError(null) }} onSubmit={submitSearch} error={searchError ? t[searchError] : ''} />
      case '/destinations':
        if (!config.features.destinations) return <NotFound />
        return <Destinations onPick={(code, end) => {
          setFormSearch((current) => {
            const next = { ...current, [end]: code }
            if (next.from === next.to) next[end === 'from' ? 'to' : 'from'] = current[end]
            return next
          })
          navigate('/')
        }} />
      case '/flights':
        if (!urlSearch) return <Redirect to="/" />
        return <Results
          search={urlSearch}
          outboundId={draft.outboundId}
          inboundId={draft.inboundId}
          onSelectOutbound={(outboundId) => setDraft((current) => ({ ...current, outboundId }))}
          onSelectInbound={(inboundId) => setDraft((current) => ({ ...current, inboundId }))}
          onChangeDate={(departDate) => navigate(`/flights?${searchToQuery({ ...urlSearch, departDate })}`, { replace: true })}
          onModify={() => navigate('/')}
          onContinue={() => navigate('/travellers')}
        />
      case '/travellers':
        if (!flightsChosen || !outbound || !fare) return <Redirect to={`/flights?${searchToQuery(search)}`} />
        return <Travellers
          search={search} outbound={outbound} inbound={inbound} fare={fare}
          passengers={draft.passengers} contact={draft.contact}
          passengerErrors={passengerErrors} contactErrors={contactErrors} showErrors={showErrors}
          onPassenger={(index, change) => setDraft((current) => ({ ...current, passengers: current.passengers.map((passenger, i) => (i === index ? { ...passenger, ...change } : passenger)) }))}
          onContact={(change) => setDraft((current) => ({ ...current, contact: { ...current.contact, ...change } }))}
          onBack={() => navigate(`/flights?${searchToQuery(search)}`)}
          onSubmit={() => {
            setShowErrors(true)
            if (travellersValid) navigate('/review')
            else window.setTimeout(() => (document.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus(), 0)
          }}
        />
      case '/review':
        if (!flightsChosen || !outbound || !fare) return <Redirect to={`/flights?${searchToQuery(search)}`} />
        if (!travellersValid) return <Redirect to="/travellers" />
        return <Review search={search} outbound={outbound} inbound={inbound} passengers={draft.passengers} contact={draft.contact} fare={fare} submitting={submitting}
          saveError={saveError} promo={promo} onPromo={(value) => setDraft((current) => ({ ...current, promo: value }))}
          onEditFlights={() => navigate(`/flights?${searchToQuery(search)}`)} onEditTravellers={() => navigate('/travellers')} onConfirm={confirmBooking} />
      case '/confirmation': {
        const booking = param ? findStored(param) : undefined
        return booking ? <Confirmation booking={booking} onDownload={download} pdfStatus={pdfStatus} /> : <NotFound />
      }
      case '/status':
        return <StatusPage onRefresh={refreshConfig} />
      case '/admin':
        return <AdminPage />
      case '/trips': {
        if (!config.features.myTrips) return <NotFound />
        if (!param) return <Trips bookings={bookings} onDownload={download} onFind={findRemote} />
        const booking = findStored(param)
        if (!booking) return <NotFound />
        return <TripDetail booking={booking} onDownload={download}
          onCancel={(item) => void cancelBooking(item)}
          onRemove={(item) => { removeBooking(item.reference); setBookings(loadBookings()); setLastBooking(null); navigate('/trips') }} />
      }
      default:
        return <NotFound />
    }
  })()

  return <AppContext.Provider value={context}>
    <div className="app-shell" id="top">
      <EnvironmentBanner />
      <Header path={route.path} onLanguage={chooseLanguage} onCurrency={chooseCurrency} />
      <AnnouncementBar />
      {page}
      <footer>
        <span className="brand"><span className="brand-mark"><Plane size={16} /></span><BrandName name={config.brandName} /></span>
        <span className="footer-note">{t.footerNote} · <a href={`mailto:${config.supportEmail}`}>{config.supportEmail}</a>{config.supportPhone && ` · ${config.supportPhone}`}</span>
        <span className="footer-links"><a href="#/status"><Activity size={12} /> {t.navStatus}</a> · © {new Date().getFullYear()} {config.brandName}</span>
      </footer>
    </div>
  </AppContext.Provider>
}
