import { ArrowRight, Check, Clock3, Luggage, Plane, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { useApp } from '../context'
import { AIRPORT_BY_CODE, countryName } from '../data/airports'
import { daysBetween, formatDuration } from '../lib/dates'
import { baggageAllowance } from '../lib/flights'
import type { Cabin, FareBreakdown, Itinerary } from '../lib/types'

export function Progress({ step }: { step: 1 | 2 | 3 | 4 }) {
  const { t } = useApp()
  const steps = [t.stepFlights, t.stepTravellers, t.stepReview, t.stepConfirmation]
  return <div className="progress-wrap" aria-label={t.bookingProgress}>
    <ol className="progress-steps">
      {steps.map((label, index) => <li className={`progress-step ${step >= index + 1 ? 'is-done' : ''} ${step === index + 1 ? 'is-active' : ''}`} key={label} aria-current={step === index + 1 ? 'step' : undefined}>
        <span>{step > index + 1 ? <Check size={13} /> : index + 1}</span><small>{label}</small>
      </li>)}
    </ol>
  </div>
}

export function JourneyHeading({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return <section className="journey-heading">
    <span className="eyebrow"><Sparkles size={14} /> AFRICAIR</span>
    <h1>{title}</h1><p>{subtitle}</p>{children}
  </section>
}

export const stopsLabel = (stops: number, t: ReturnType<typeof useApp>['t']) => stops === 0 ? t.nonstop : `${stops} ${stops === 1 ? t.stop : t.stops}`

export function layoverMinutes(arriveDate: string, arriveTime: string, departDate: string, departTime: string) {
  const [ah, am] = arriveTime.split(':').map(Number)
  const [dh, dm] = departTime.split(':').map(Number)
  return daysBetween(arriveDate, departDate) * 1440 + dh * 60 + dm - (ah * 60 + am)
}

/** Segment-by-segment timeline for one direction of travel. */
export function SegmentTimeline({ itinerary, cabin }: { itinerary: Itinerary; cabin: Cabin }) {
  const { t, language, date } = useApp()
  return <ol className="segment-timeline">
    {itinerary.segments.map((segment, index) => {
      const from = AIRPORT_BY_CODE.get(segment.from)
      const to = AIRPORT_BY_CODE.get(segment.to)
      const next = itinerary.segments[index + 1]
      return <li key={`${segment.flightNumber}-${index}`}>
        <div className="segment">
          <div className="segment-point">
            <strong>{segment.departTime}</strong>
            <span>{date(segment.departDate, 'short')}</span>
            <p><b>{segment.from}</b> {from?.name}<small>{from?.city}, {from && countryName(from.country, language)}</small></p>
          </div>
          <div className="segment-meta"><Clock3 size={13} />{formatDuration(segment.durationMin)} · {segment.flightNumber} · {segment.airline} · {segment.aircraft}</div>
          <div className="segment-point">
            <strong>{segment.arriveTime}</strong>
            <span>{date(segment.arriveDate, 'short')}</span>
            <p><b>{segment.to}</b> {to?.name}<small>{to?.city}, {to && countryName(to.country, language)}</small></p>
          </div>
          <div className="segment-meta"><Luggage size={13} />{t.baggage}: {baggageAllowance(cabin)} · {t.cabinBag} · {t[cabin]}</div>
        </div>
        {next && <div className="layover"><Clock3 size={13} />{formatDuration(layoverMinutes(segment.arriveDate, segment.arriveTime, next.departDate, next.departTime))} {t.layover} · {to?.city} ({segment.to})</div>}
      </li>
    })}
  </ol>
}

export function LegCard({ title, itinerary, cabin, action }: { title: string; itinerary: Itinerary; cabin: Cabin; action?: ReactNode }) {
  const { t, date } = useApp()
  const first = itinerary.segments[0]
  const last = itinerary.segments[itinerary.segments.length - 1]
  const from = AIRPORT_BY_CODE.get(first.from)
  const to = AIRPORT_BY_CODE.get(last.to)
  return <article className="review-card leg-card">
    <div className="review-card-head">
      <div>
        <span className="eyebrow"><Plane size={14} />{title} · {date(first.departDate)}</span>
        <h2>{from?.city} <ArrowRight size={18} /> {to?.city}</h2>
        <p className="leg-sub">{formatDuration(itinerary.durationMin)} · {stopsLabel(itinerary.stops, t)} · {itinerary.airline}</p>
      </div>
      {action}
    </div>
    <SegmentTimeline itinerary={itinerary} cabin={cabin} />
  </article>
}

export function FareSummary({ fare, children }: { fare: FareBreakdown; children?: ReactNode }) {
  const { t, money } = useApp()
  return <aside className="price-summary">
    <span className="eyebrow">{t.fareBreakdown}</span>
    <h2>{t.total}</h2>
    {fare.lines.map((line) => <div className="price-line fare-line" key={line.type}>
      <span>{line.count} × {t[line.type]}<small>{money(line.fareEach)} + {money(line.taxEach)}</small></span>
      <strong>{money((line.fareEach + line.taxEach) * line.count)}</strong>
    </div>)}
    <div className="price-line"><span>{t.baseFare}</span><strong>{money(fare.base)}</strong></div>
    <div className="price-line"><span>{t.taxes}</span><strong>{money(fare.taxes)}</strong></div>
    {fare.discount && <div className="price-line discount-line"><span>{t.promoCode} {fare.discount.code} (−{fare.discount.percent}%)</span><strong>− {money(fare.discount.amountUsd)}</strong></div>}
    <div className="price-line"><span>{t.service}</span><strong>{money(fare.service)}</strong></div>
    <div className="price-total"><span>{t.total}</span><strong data-testid="fare-total">{money(fare.total)}</strong></div>
    {children}
  </aside>
}
