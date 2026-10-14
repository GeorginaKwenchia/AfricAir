import { useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, ShieldCheck, Tag, Users, X } from 'lucide-react'
import { useApp } from '../context'
import { countryName } from '../data/airports'
import { ApiError, validatePromo } from '../lib/api'
import { MaintenanceNotice } from './Runtime'
import type { Contact, FareBreakdown, Itinerary, Passenger, SearchParams } from '../lib/types'
import { FareSummary, JourneyHeading, LegCard, Progress } from './Shared'

type Props = {
  search: SearchParams
  outbound: Itinerary
  inbound?: Itinerary
  passengers: Passenger[]
  contact: Contact
  fare: FareBreakdown
  submitting: boolean
  saveError: string
  promo?: { code: string; percent: number }
  onPromo: (promo?: { code: string; percent: number }) => void
  onEditFlights: () => void
  onEditTravellers: () => void
  onConfirm: () => void
}

export function Review({ search, outbound, inbound, passengers, contact, fare, submitting, saveError, promo, onPromo, onEditFlights, onEditTravellers, onConfirm }: Props) {
  const { t, config } = useApp()
  const [agreed, setAgreed] = useState(false)
  const [showError, setShowError] = useState(false)

  return <main className="booking-shell narrow-shell">
    <Progress step={3} />
    <JourneyHeading title={t.reviewTitle} subtitle={t.reviewSubtitle} />
    <div className="review-layout">
      <section className="review-content">
        <LegCard title={t.outbound} itinerary={outbound} cabin={search.cabin} action={<button className="text-button" onClick={onEditFlights}>{t.changeFlights}</button>} />
        {inbound && <LegCard title={t.return} itinerary={inbound} cabin={search.cabin} action={<button className="text-button" onClick={onEditFlights}>{t.changeFlights}</button>} />}
        <PassengerList passengers={passengers} contact={contact} action={<button className="text-button" onClick={onEditTravellers}>{t.edit}</button>} />
      </section>
      <FareSummary fare={fare}>
        {config.features.promoCodes && <PromoBox promo={promo} onPromo={onPromo} />}
        {config.maintenanceMode && <MaintenanceNotice />}
        <div className="no-payment-callout"><ShieldCheck size={19} /><div><strong>{t.noPayment}</strong><p>{t.noPaymentCopy}</p></div></div>
        <label className={`agree-line ${showError && !agreed ? 'has-error' : ''}`}>
          <input type="checkbox" checked={agreed} onChange={(event) => { setAgreed(event.target.checked); setShowError(false) }} />
          <span>{t.agree}</span>
        </label>
        {showError && !agreed && <p className="inline-error" role="alert"><CircleAlert size={16} />{t.errAgree}</p>}
        {saveError && <p className="inline-error" role="alert"><CircleAlert size={16} />{saveError}</p>}
        <button className="button button-primary large-button" disabled={submitting || config.maintenanceMode} onClick={() => (agreed ? onConfirm() : setShowError(true))}>{t.confirmBooking}<ArrowRight size={17} /></button>
        <button className="back-link" onClick={onEditTravellers}><ArrowLeft size={15} />{t.back}</button>
      </FareSummary>
    </div>
  </main>
}

export function PassengerList({ passengers, contact, action }: { passengers: (Passenger & { ticketNumber?: string })[]; contact: Contact; action?: React.ReactNode }) {
  const { t, language, date } = useApp()
  return <article className="review-card travellers-review">
    <div className="review-card-head">
      <div><span className="eyebrow"><Users size={14} />{t.bookedFor}</span><h2>{passengers.length} {passengers.length === 1 ? t.traveller : t.travellersPlural}</h2></div>
      {action}
    </div>
    {passengers.map((person, index) => <div className="person-row" key={index}>
      <span>{index + 1}</span>
      <div>
        <strong>{person.lastName.toUpperCase()}, {person.firstName} <em>· {t[person.type]}</em></strong>
        <small>{date(person.dob, 'numeric')} · {countryName(person.nationality, language)} · {person.documentNumber.toUpperCase()}{person.ticketNumber && ` · ${t.ticket} ${person.ticketNumber}`}</small>
      </div>
      <CheckCircle2 size={18} />
    </div>)}
    <div className="contact-row"><strong>{t.contact}</strong><span>{contact.email} · {contact.phone}</span></div>
  </article>
}

function PromoBox({ promo, onPromo }: { promo?: { code: string; percent: number }; onPromo: (promo?: { code: string; percent: number }) => void }) {
  const { t } = useApp()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  if (promo) {
    return <div className="promo-box promo-applied" data-testid="promo-applied">
      <Tag size={15} /><span><strong>{promo.code}</strong> · {t.promoApplied(promo.percent)}</span>
      <button type="button" className="text-button" onClick={() => onPromo(undefined)}><X size={13} />{t.removePromo}</button>
    </div>
  }
  const apply = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!code.trim()) return
    setChecking(true)
    setError('')
    try {
      const result = await validatePromo(code.trim())
      if (result.valid && result.code && result.percent) onPromo({ code: result.code, percent: result.percent })
      else setError(t.promoInvalid)
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? err.message : t.promoError)
    } finally {
      setChecking(false)
    }
  }
  return <form className="promo-box" onSubmit={apply}>
    <label htmlFor="promo-code"><Tag size={14} />{t.promoCode}</label>
    <div className="promo-row">
      <input id="promo-code" value={code} onChange={(event) => { setCode(event.target.value.toUpperCase()); setError('') }} autoComplete="off" maxLength={32} />
      <button className="button button-ghost" type="submit" disabled={checking || !code.trim()}>{t.applyPromo}</button>
    </div>
    {error && <small className="field-error" role="alert">{error}</small>}
  </form>
}
