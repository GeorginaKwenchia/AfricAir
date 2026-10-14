import { useEffect, useRef, useState } from 'react'
import { ArrowRight, CalendarDays, CircleAlert, Minus, Plane, Plus, Route, Sparkles, Users } from 'lucide-react'
import { useApp } from '../context'
import { addDays, todayIso } from '../lib/dates'
import { totalTravellers } from '../lib/flights'
import type { Cabin, PassengerCounts, SearchParams } from '../lib/types'
import { AirportCombobox } from './AirportCombobox'

type Props = {
  value: SearchParams
  onChange: (value: SearchParams) => void
  onSubmit: () => void
  error: string
}

const openPicker = (event: React.MouseEvent<HTMLInputElement>) => {
  try {
    event.currentTarget.showPicker?.()
  } catch {
    // showPicker is unsupported or blocked; the native input still works.
  }
}

export function SearchForm({ value, onChange, onSubmit, error }: Props) {
  const { t, date } = useApp()
  const today = todayIso()
  const update = (change: Partial<SearchParams>) => onChange({ ...value, ...change })
  const travellerCount = totalTravellers(value.passengers)

  return <form className="search-panel" onSubmit={(event) => { event.preventDefault(); onSubmit() }} noValidate>
    <div className="trip-switch" role="radiogroup" aria-label={`${t.roundTrip} / ${t.oneWay}`}>
      {(['round', 'oneway'] as const).map((type) => <button key={type} type="button" role="radio" aria-checked={value.tripType === type} className={value.tripType === type ? 'active' : ''} onClick={() => update({ tripType: type })}>
        <span className="radio-dot" />{type === 'round' ? t.roundTrip : t.oneWay}
      </button>)}
    </div>
    <div className={`search-fields ${value.tripType === 'oneway' ? 'is-oneway' : ''}`}>
      <AirportCombobox name="from" value={value.from} onChange={(from) => update({ from })} label={t.from} />
      <button className="swap-button" type="button" onClick={() => update({ from: value.to, to: value.from })} aria-label={t.swap}><Route size={17} /></button>
      <AirportCombobox name="to" value={value.to} onChange={(to) => update({ to })} label={t.to} />
      <label className="field date-field">
        <span className="field-label"><CalendarDays size={15} aria-hidden="true" /> {t.departure}</span>
        <input type="date" name="depart" value={value.departDate} min={today} max={addDays(today, 360)} onClick={openPicker}
          onChange={(event) => {
            const departDate = event.target.value
            update({ departDate, returnDate: departDate && value.returnDate < departDate ? addDays(departDate, 7) : value.returnDate })
          }} />
        <span className="city-caption">{date(value.departDate)}</span>
      </label>
      {value.tripType === 'round' && <label className="field date-field">
        <span className="field-label"><CalendarDays size={15} aria-hidden="true" /> {t.return}</span>
        <input type="date" name="return" value={value.returnDate} min={value.departDate || today} max={addDays(today, 360)} onClick={openPicker} onChange={(event) => update({ returnDate: event.target.value })} />
        <span className="city-caption">{date(value.returnDate)}</span>
      </label>}
      <TravellerPicker counts={value.passengers} onChange={(passengers) => update({ passengers })} total={travellerCount} />
      <label className="field cabin-field">
        <span className="field-label"><Sparkles size={15} aria-hidden="true" /> {t.cabin}</span>
        <select name="cabin" value={value.cabin} onChange={(event) => update({ cabin: event.target.value as Cabin })}>
          <option value="economy">{t.economy}</option><option value="premium">{t.premium}</option>
          <option value="business">{t.business}</option><option value="first">{t.first}</option>
        </select>
      </label>
    </div>
    {error && <p className="inline-error" role="alert"><CircleAlert size={16} />{error}</p>}
    <button className="button button-primary search-submit" type="submit"><Plane size={17} />{t.searchFlights}<ArrowRight size={16} /></button>
  </form>
}

function TravellerPicker({ counts, onChange, total }: { counts: PassengerCounts; onChange: (counts: PassengerCounts) => void; total: number }) {
  const { t } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const set = (key: keyof PassengerCounts, next: number) => {
    const updated = { ...counts, [key]: next }
    if (updated.infants > updated.adults) updated.infants = updated.adults
    onChange(updated)
  }
  const rows: { key: keyof PassengerCounts; label: string; hint: string; min: number; max: number }[] = [
    { key: 'adults', label: t.adults, hint: t.adultsHint, min: 1, max: 9 - counts.children - counts.infants },
    { key: 'children', label: t.children, hint: t.childrenHint, min: 0, max: 9 - counts.adults - counts.infants },
    { key: 'infants', label: t.infants, hint: t.infantsHint, min: 0, max: Math.min(counts.adults, 9 - counts.adults - counts.children) },
  ]

  return <div className="field traveller-field" ref={ref}>
    <span className="field-label"><Users size={15} aria-hidden="true" /> {t.travellers}</span>
    <button type="button" className="traveller-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
      {total} {total === 1 ? t.traveller : t.travellersPlural}
    </button>
    <span className="city-caption muted-caption">{[
      `${counts.adults} ${t.adult.toLowerCase()}`,
      counts.children ? `${counts.children} ${t.child.toLowerCase()}` : '',
      counts.infants ? `${counts.infants} ${t.infant.toLowerCase()}` : '',
    ].filter(Boolean).join(' · ')}</span>
    {open && <div className="traveller-popover" role="dialog" aria-label={t.travellers}>
      {rows.map((row) => <div className="counter-row" key={row.key}>
        <div><strong>{row.label}</strong><small>{row.hint}</small></div>
        <div className="quantity-row">
          <button type="button" onClick={() => set(row.key, counts[row.key] - 1)} disabled={counts[row.key] <= row.min} aria-label={`− ${row.label}`}><Minus size={14} /></button>
          <strong aria-live="polite">{counts[row.key]}</strong>
          <button type="button" onClick={() => set(row.key, counts[row.key] + 1)} disabled={counts[row.key] >= row.max} aria-label={`+ ${row.label}`}><Plus size={14} /></button>
        </div>
      </div>)}
      <p>{t.maxTravellers}</p>
      <button type="button" className="button button-primary" onClick={() => setOpen(false)}>{t.done}</button>
    </div>}
  </div>
}
