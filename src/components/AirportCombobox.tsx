import { useId, useMemo, useRef, useState } from 'react'
import { MapPin } from 'lucide-react'
import { useApp } from '../context'
import { AIRPORT_BY_CODE, POPULAR_AIRPORTS, airportLabel, countryName, searchAirports, type AirportSuggestion } from '../data/airports'

type Props = { value: string; onChange: (code: string) => void; label: string; name: string }

export function AirportCombobox({ value, onChange, label, name }: Props) {
  const { t, language } = useApp()
  const selected = AIRPORT_BY_CODE.get(value)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const suggestions: AirportSuggestion[] = useMemo(() => {
    if (query.trim()) return searchAirports(query, 40)
    return POPULAR_AIRPORTS.map((code) => AIRPORT_BY_CODE.get(code)).filter((airport) => !!airport).map((airport) => ({ airport: airport! }))
  }, [query])

  const choose = (suggestion: AirportSuggestion | undefined) => {
    if (!suggestion) return
    onChange(suggestion.airport.code)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((index) => Math.min(index + 1, suggestions.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && open) {
      event.preventDefault()
      choose(suggestions[active])
    } else if (event.key === 'Escape') {
      setOpen(false)
      setQuery('')
    }
  }

  return <div className="field airport-field">
    <label className="field-label" htmlFor={`${listId}-input`}><MapPin size={15} aria-hidden="true" /> {label}</label>
    <input
      ref={inputRef}
      id={`${listId}-input`}
      name={name}
      role="combobox"
      aria-expanded={open}
      aria-controls={`${listId}-list`}
      aria-autocomplete="list"
      aria-activedescendant={open && suggestions[active] ? `${listId}-${suggestions[active].airport.code}` : undefined}
      autoComplete="off"
      placeholder={t.airportPlaceholder}
      value={open ? query : selected ? airportLabel(selected) : ''}
      onFocus={() => { setOpen(true); setQuery(''); setActive(0) }}
      onBlur={() => { setOpen(false); setQuery('') }}
      onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true) }}
      onKeyDown={onKeyDown}
    />
    <span className="city-caption">{selected ? `${selected.name} · ${countryName(selected.country, language)}` : '—'}</span>
    {open && <ul className="airport-options" id={`${listId}-list`} role="listbox" aria-label={label}>
      {!query.trim() && <li className="option-heading" role="presentation">{t.popular}</li>}
      {suggestions.length === 0 && <li className="option-empty" role="presentation">{t.noAirportMatch}</li>}
      {suggestions.map((suggestion, index) => <li
        key={suggestion.airport.code}
        id={`${listId}-${suggestion.airport.code}`}
        role="option"
        aria-selected={index === active}
        className={index === active ? 'is-active' : ''}
        onMouseDown={(event) => { event.preventDefault(); choose(suggestion) }}
        onMouseEnter={() => setActive(index)}
      >
        <span className="option-code">{suggestion.airport.code}</span>
        <span className="option-text">
          <strong>{suggestion.airport.city}, {countryName(suggestion.airport.country, language)}</strong>
          <small>{suggestion.nearestFor ? `${t.nearestFor} ${countryName(suggestion.nearestFor, language)} · ` : ''}{suggestion.airport.name}</small>
        </span>
      </li>)}
    </ul>}
  </div>
}
