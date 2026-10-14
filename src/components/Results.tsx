import { useMemo, useState } from 'react'
import { ArrowRight, CheckCircle2, ChevronDown, ChevronUp, CircleAlert, Info, Luggage, Route, ShieldCheck } from 'lucide-react'
import { useApp } from '../context'
import { AIRPORT_BY_CODE } from '../data/airports'
import { addDays, daysBetween, formatDuration, todayIso } from '../lib/dates'
import { baggageAllowance, generateItineraries, totalTravellers } from '../lib/flights'
import type { Itinerary, SearchParams } from '../lib/types'
import { JourneyHeading, Progress, SegmentTimeline, stopsLabel } from './Shared'

type Sort = 'best' | 'cheapest' | 'fastest' | 'earliest'
type StopFilter = 'any' | 'nonstop' | 'one'

type Props = {
  search: SearchParams
  outboundId: string
  inboundId: string
  onSelectOutbound: (id: string) => void
  onSelectInbound: (id: string) => void
  onChangeDate: (departDate: string) => void
  onModify: () => void
  onContinue: () => void
}

function sortItineraries(list: Itinerary[], sort: Sort, filter: StopFilter) {
  const filtered = list.filter((item) => filter === 'any' || (filter === 'nonstop' ? item.stops === 0 : item.stops <= 1))
  const score = (item: Itinerary) => {
    const cheapest = Math.min(...list.map((i) => i.fareUsd))
    const fastest = Math.min(...list.map((i) => i.durationMin))
    return item.fareUsd / cheapest + item.durationMin / fastest
  }
  const compare: Record<Sort, (a: Itinerary, b: Itinerary) => number> = {
    best: (a, b) => score(a) - score(b),
    cheapest: (a, b) => a.fareUsd - b.fareUsd,
    fastest: (a, b) => a.durationMin - b.durationMin,
    earliest: (a, b) => a.segments[0].departTime.localeCompare(b.segments[0].departTime),
  }
  return [...filtered].sort(compare[sort])
}

export function Results({ search, outboundId, inboundId, onSelectOutbound, onSelectInbound, onChangeDate, onModify, onContinue }: Props) {
  const { t, money, date } = useApp()
  const [sort, setSort] = useState<Sort>('best')
  const [stopFilter, setStopFilter] = useState<StopFilter>('any')
  const today = todayIso()
  const round = search.tripType === 'round'
  const origin = AIRPORT_BY_CODE.get(search.from)!
  const destination = AIRPORT_BY_CODE.get(search.to)!
  const travellers = totalTravellers(search.passengers)

  const outbound = useMemo(() => generateItineraries(search.from, search.to, search.departDate, search.cabin), [search.from, search.to, search.departDate, search.cabin])
  const inbound = useMemo(() => round ? generateItineraries(search.to, search.from, search.returnDate, search.cabin) : [], [round, search.to, search.from, search.returnDate, search.cabin])
  const selectedOut = outbound.find((item) => item.id === outboundId)
  const selectedIn = inbound.find((item) => item.id === inboundId)

  const dateStrip = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(search.departDate, index - 3))
    .filter((day) => day >= today && daysBetween(today, day) <= 360 && (!round || day <= search.returnDate))
    .map((day) => {
      const options = generateItineraries(search.from, search.to, day, search.cabin)
      return { day, from: options.length ? Math.min(...options.map((item) => item.fareUsd)) : null }
    }), [search.departDate, search.from, search.to, search.cabin, search.returnDate, round, today])

  const ready = !!selectedOut && (!round || !!selectedIn)
  const perAdult = (selectedOut?.fareUsd ?? 0) + (selectedIn?.fareUsd ?? 0)

  const renderList = (list: Itinerary[], selectedId: string, onSelect: (id: string) => void, legDate: string) => {
    const visible = sortItineraries(list, sort, stopFilter)
    if (!visible.length) return <p className="empty-state"><CircleAlert size={16} />{list.length === 0 && legDate === today ? t.noFlightsToday : t.noFlights}</p>
    return visible.map((item) => <FlightCard key={item.id} itinerary={item} cabin={search.cabin} chosen={item.id === selectedId} onSelect={() => onSelect(item.id)} />)
  }

  return <main className="booking-shell" id="flight-results">
    <Progress step={1} />
    <JourneyHeading title={t.resultsTitle} subtitle={t.resultsSubtitle} />
    <div className="route-summary">
      <div><small>{t.from}</small><strong>{origin.city} <em>{origin.code}</em></strong></div>
      <Route size={19} aria-hidden="true" />
      <div><small>{t.to}</small><strong>{destination.city} <em>{destination.code}</em></strong></div>
      <span className="summary-date">{date(search.departDate)}{round && ` – ${date(search.returnDate)}`} <b>·</b> {travellers} {travellers === 1 ? t.traveller : t.travellersPlural} <b>·</b> {t[search.cabin]}</span>
      <button onClick={onModify} className="text-button">{t.modifySearch}</button>
    </div>

    <div className="result-layout">
      <aside className="filter-card">
        <label className="filter-group"><span>{t.sortBy}</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
            <option value="best">{t.sortBest}</option><option value="cheapest">{t.sortCheapest}</option>
            <option value="fastest">{t.sortFastest}</option><option value="earliest">{t.sortEarliest}</option>
          </select>
        </label>
        <fieldset className="filter-group"><legend>{t.stopsFilter}</legend>
          {([['any', t.anyStops], ['nonstop', t.nonstopOnly], ['one', t.upToOneStop]] as const).map(([key, label]) => <label key={key} className="radio-line">
            <input type="radio" name="stops" checked={stopFilter === key} onChange={() => setStopFilter(key)} />{label}
          </label>)}
        </fieldset>
        <div className="filter-note"><ShieldCheck size={17} />{t.indicativeNote}</div>
      </aside>

      <section className="flights-list" aria-label={t.resultsTitle}>
        <div className="date-strip" role="group" aria-label={t.departure}>
          {dateStrip.map(({ day, from }) => <button key={day} type="button" className={day === search.departDate ? 'is-current' : ''} aria-pressed={day === search.departDate} onClick={() => onChangeDate(day)}>
            <span>{date(day, 'short')}</span><strong>{from === null ? '—' : money(from)}</strong>
          </button>)}
        </div>
        <div className="leg-heading"><span>{t.outbound}</span><strong>{origin.city} <ArrowRight size={13} /> {destination.city} · {date(search.departDate)}</strong></div>
        {renderList(outbound, outboundId, onSelectOutbound, search.departDate)}
        {round && <>
          <div className="leg-heading return-leg"><span>{t.return}</span><strong>{destination.city} <ArrowRight size={13} /> {origin.city} · {date(search.returnDate)}</strong></div>
          {renderList(inbound, inboundId, onSelectInbound, search.returnDate)}
        </>}
      </section>
    </div>

    <div className="sticky-continue">
      <div>
        <span>{t.totalFrom}</span>
        <strong>{!selectedOut ? t.chooseOutbound : round && !selectedIn ? t.chooseReturn
          : `${selectedOut.segments[0].flightNumber} ${selectedOut.segments[0].departTime}${selectedIn ? ` · ${selectedIn.segments[0].flightNumber} ${selectedIn.segments[0].departTime}` : ''}`}</strong>
      </div>
      <div>
        <strong>{ready ? money(perAdult) : '—'} <small>{t.perAdult}</small></strong>
        <button className="button button-primary" onClick={onContinue} disabled={!ready}>{t.continue}<ArrowRight size={16} /></button>
      </div>
    </div>
  </main>
}

function FlightCard({ itinerary, cabin, chosen, onSelect }: { itinerary: Itinerary; cabin: SearchParams['cabin']; chosen: boolean; onSelect: () => void }) {
  const { t, money } = useApp()
  const [open, setOpen] = useState(false)
  const first = itinerary.segments[0]
  const last = itinerary.segments[itinerary.segments.length - 1]
  const dayShift = daysBetween(first.departDate, last.arriveDate)
  const tag = itinerary.tags[0]
  const tagLabel = tag === 'cheapest' ? t.tagCheapest : tag === 'fastest' ? t.tagFastest : tag === 'best' ? t.tagBest : ''
  const via = itinerary.segments.slice(0, -1).map((segment) => segment.to).join(', ')

  return <article className={`flight-card ${chosen ? 'selected' : ''}`} data-testid="flight-card">
    <div className="airline-cell">
      <div className="airline-symbol">{itinerary.airline.split(' ').map((word) => word[0]).join('')}</div>
      <div><strong>{itinerary.airline}</strong><small>{itinerary.segments.map((segment) => segment.flightNumber).join(' / ')}</small></div>
    </div>
    <div className="time-cell"><strong>{first.departTime}</strong><small>{first.from}</small></div>
    <div className="route-line"><span /><div><small>{formatDuration(itinerary.durationMin)}</small><b>{stopsLabel(itinerary.stops, t)}{via && ` · ${via}`}</b></div><span /></div>
    <div className="time-cell arrive"><strong>{last.arriveTime}{dayShift > 0 && <sup>{t.nextDay(dayShift)}</sup>}</strong><small>{last.to}</small></div>
    <div className="price-cell">
      {tagLabel && <span className="badge">{tagLabel}</span>}
      <strong>{money(itinerary.fareUsd)}</strong><small>{t.perAdult}</small>
    </div>
    <button className={`select-button ${chosen ? 'is-selected' : ''}`} onClick={onSelect} aria-pressed={chosen}>{chosen ? <><CheckCircle2 size={17} />{t.selected}</> : t.selectFlight}</button>
    <div className="fare-notes">
      <span><Luggage size={14} />{t.baggage}: {baggageAllowance(cabin)}</span>
      <span><ShieldCheck size={14} />{t.changeable}</span>
      {itinerary.seatsLeft <= 4 && <span className="seats-left"><Info size={14} />{t.seatsLeft(itinerary.seatsLeft)}</span>}
      <button type="button" className="details-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? t.hideDetails : t.flightDetails}{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
    </div>
    {open && <div className="flight-details"><SegmentTimeline itinerary={itinerary} cabin={cabin} /></div>}
  </article>
}
