import { useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, CircleAlert, Download, Plane, Search, Trash2, Users, XCircle } from 'lucide-react'
import { AppContext, useApp } from '../context'
import { AIRPORT_BY_CODE } from '../data/airports'
import { findBooking } from '../lib/bookings'
import { navigate } from '../lib/router'
import type { Booking } from '../lib/types'
import { PassengerList } from './Review'
import { FareSummary, JourneyHeading, LegCard, Progress } from './Shared'

/** Money and labels on a stored booking use the currency captured when it was made. */
function useBookingMoney(booking: Booking) {
  const { locale } = useApp()
  return (usd: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: booking.currency.code }).format(usd * booking.currency.rate)
}

type PdfProps = { onDownload: (booking: Booking) => boolean }

export function Confirmation({ booking, onDownload, pdfStatus }: PdfProps & { booking: Booking; pdfStatus: 'idle' | 'done' | 'failed' }) {
  const { t, date } = useApp()
  const money = useBookingMoney(booking)
  const origin = AIRPORT_BY_CODE.get(booking.search.from)
  const destination = AIRPORT_BY_CODE.get(booking.search.to)
  return <main className="booking-shell confirmation-shell">
    <Progress step={4} />
    <section className="confirmation-card">
      <div className="success-orb"><Check size={34} /></div>
      <span className="eyebrow">AFRICAIR</span>
      <h1>{t.bookingComplete}</h1>
      <p>{t.confirmationText}</p>
      <div className="reference-box"><span>{t.reference}</span><strong data-testid="booking-reference">{booking.reference}</strong></div>
      <div className="confirmation-route">
        <div><span>{origin?.code}</span><strong>{origin?.city}</strong></div><Plane size={24} />
        <div><span>{destination?.code}</span><strong>{destination?.city}</strong></div>
      </div>
      <div className="confirmation-details">
        <div><CalendarDays size={17} /><span>{date(booking.outbound.segments[0].departDate)}{booking.inbound && ` – ${date(booking.inbound.segments[0].departDate)}`}</span></div>
        <div><Users size={17} /><span>{booking.passengers.length} {booking.passengers.length === 1 ? t.traveller : t.travellersPlural}</span></div>
        <div><CheckCircle2 size={17} /><span>{money(booking.fare.total)}</span></div>
      </div>
      <button className="button button-primary download-button" onClick={() => onDownload(booking)}><Download size={18} />{t.downloadPdf}</button>
      <span className="pdf-status" role="status">
        {pdfStatus === 'done' && <><CheckCircle2 size={14} />{t.pdfDownloaded}</>}
        {pdfStatus === 'failed' && <><CircleAlert size={14} />{t.pdfFailed}</>}
      </span>
      <div className="confirmation-links">
        <button className="text-button" onClick={() => navigate(`/trips/${booking.reference}`)}>{t.viewTrips}</button>
        <button className="text-button" onClick={() => navigate('/')}>{t.newSearch}<ArrowRight size={15} /></button>
      </div>
    </section>
  </main>
}

export function Trips({ bookings, onDownload, onFind }: PdfProps & { bookings: Booking[]; onFind: (reference: string, lastName: string) => Promise<Booking | undefined> }) {
  const { t, date, config } = useApp()
  const [reference, setReference] = useState('')
  const [lastName, setLastName] = useState('')
  const [notFound, setNotFound] = useState(false)

  const lookup = async (event: React.FormEvent) => {
    event.preventDefault()
    const booking = findBooking(reference, lastName) ?? (await onFind(reference, lastName))
    if (booking) navigate(`/trips/${booking.reference}`)
    else setNotFound(true)
  }

  return <main className="booking-shell narrow-shell">
    <JourneyHeading title={t.tripsTitle} subtitle={t.tripsSubtitle} />
    <div className="trips-layout">
      <form className="review-card find-form" onSubmit={lookup}>
        <h2>{t.findBooking}</h2>
        <p>{t.findHint}</p>
        <div className="form-field"><label htmlFor="find-ref">{t.reference}</label><input id="find-ref" value={reference} maxLength={6} autoCapitalize="characters" onChange={(event) => { setReference(event.target.value.toUpperCase()); setNotFound(false) }} required /></div>
        <div className="form-field"><label htmlFor="find-name">{t.lastName}</label><input id="find-name" value={lastName} onChange={(event) => { setLastName(event.target.value); setNotFound(false) }} required /></div>
        {notFound && <p className="inline-error" role="alert"><CircleAlert size={16} />{t.bookingNotFound}</p>}
        <button className="button button-primary" type="submit"><Search size={16} />{t.find}</button>
      </form>
      <section className="trip-list">
        {bookings.length === 0 && <p className="empty-state"><Plane size={16} />{t.noTrips}</p>}
        {bookings.map((booking) => {
          const origin = AIRPORT_BY_CODE.get(booking.search.from)
          const destination = AIRPORT_BY_CODE.get(booking.search.to)
          return <article className={`trip-card ${booking.status}`} key={booking.reference}>
            <div>
              <span className={`status-pill ${booking.status}`}>{booking.status === 'confirmed' ? t.confirmed : t.cancelled}</span>
              <h3>{origin?.city} <ArrowRight size={15} /> {destination?.city}</h3>
              <p>{date(booking.outbound.segments[0].departDate)}{booking.inbound && ` – ${date(booking.inbound.segments[0].departDate)}`} · {booking.passengers.length} {booking.passengers.length === 1 ? t.traveller : t.travellersPlural}</p>
              <small>{t.reference}: <b>{booking.reference}</b> · {t.bookedOn} {date(booking.createdAt.slice(0, 10), 'numeric')}</small>
            </div>
            <div className="trip-actions">
              <button className="button button-ghost" onClick={() => onDownload(booking)} aria-label={`${t.downloadPdf} ${booking.reference}`}><Download size={15} />PDF</button>
              <button className="button button-primary" onClick={() => navigate(`/trips/${booking.reference}`)}>{t.view}</button>
            </div>
          </article>
        })}
        <p className="storage-note">{config.storage === 'database' ? t.storageDatabase : t.storageNote}</p>
      </section>
    </div>
  </main>
}

export function TripDetail({ booking, onDownload, onCancel, onRemove }: PdfProps & { booking: Booking; onCancel: (booking: Booking) => void; onRemove: (booking: Booking) => void }) {
  const { t } = useApp()
  const money = useBookingMoney(booking)
  return <main className="booking-shell narrow-shell">
    <button className="back-link inline" onClick={() => navigate('/trips')}><ArrowLeft size={15} />{t.backToTrips}</button>
    <JourneyHeading title={`${t.reference} ${booking.reference}`} subtitle={`${t.status}: ${booking.status === 'confirmed' ? t.confirmed : t.cancelled}`} />
    {booking.status === 'cancelled' && <p className="cancelled-banner"><XCircle size={17} />{t.bookingCancelled}</p>}
    <div className="review-layout">
      <section className="review-content">
        <LegCard title={t.outbound} itinerary={booking.outbound} cabin={booking.search.cabin} />
        {booking.inbound && <LegCard title={t.return} itinerary={booking.inbound} cabin={booking.search.cabin} />}
        <PassengerList passengers={booking.passengers} contact={booking.contact} />
      </section>
      <BookingFare booking={booking} money={money}>
        <button className="button button-primary large-button" onClick={() => onDownload(booking)}><Download size={17} />{t.downloadPdf}</button>
        {booking.status === 'confirmed' && <button className="button button-ghost large-button danger" onClick={() => window.confirm(t.cancelConfirm) && onCancel(booking)}><XCircle size={16} />{t.cancelBooking}</button>}
        <button className="back-link" onClick={() => window.confirm(t.deleteConfirm) && onRemove(booking)}><Trash2 size={14} />{t.deleteBooking}</button>
      </BookingFare>
    </div>
  </main>
}

function BookingFare({ booking, money, children }: { booking: Booking; money: (usd: number) => string; children: React.ReactNode }) {
  const app = useApp()
  // Re-provide context so FareSummary formats amounts in the booking's currency.
  return <AppContext.Provider value={{ ...app, money }}><FareSummary fare={booking.fare}>{children}</FareSummary></AppContext.Provider>
}
