import { useDeferredValue, useMemo, useState } from 'react'
import { MapPin, PlaneLanding, PlaneTakeoff, Search } from 'lucide-react'
import { useApp } from '../context'
import { AIRPORTS_BY_COUNTRY, AIRPORT_BY_CODE, CONTINENT_BY_COUNTRY, COUNTRY_CODES, NEAREST_GATEWAYS, countryName, normalise } from '../data/airports'
import { JourneyHeading } from './Shared'

const REGION_ORDER = ['AF', 'EU', 'AS', 'NA', 'SA', 'OC', 'AN']

export function Destinations({ onPick }: { onPick: (code: string, end: 'from' | 'to') => void }) {
  const { t, language } = useApp()
  const [filter, setFilter] = useState('')
  const [region, setRegion] = useState('all')
  const query = normalise(useDeferredValue(filter))

  const countries = useMemo(() => COUNTRY_CODES
    .map((code) => ({ code, name: countryName(code, language), region: CONTINENT_BY_COUNTRY[code] ?? 'AN', airports: AIRPORTS_BY_COUNTRY.get(code) ?? [] }))
    .sort((a, b) => a.name.localeCompare(b.name, language)), [language])

  const visible = useMemo(() => countries
    .filter((country) => region === 'all' || country.region === region)
    .map((country) => {
      if (!query) return country
      if (normalise(country.name).includes(query) || normalise(countryName(country.code, 'en')).includes(query)) return country
      const airports = country.airports.filter((airport) => airport.code.toLowerCase() === query || normalise(airport.city).includes(query) || normalise(airport.name).includes(query))
      return airports.length ? { ...country, airports } : null
    })
    .filter((country) => !!country), [countries, region, query])

  const totalAirports = countries.reduce((sum, country) => sum + country.airports.length, 0)

  return <main className="booking-shell">
    <JourneyHeading title={t.destinationsTitle} subtitle={t.destinationsSubtitle}>
      <p className="coverage-line">{t.routeHint(totalAirports.toLocaleString(language), String(countries.length))}</p>
    </JourneyHeading>
    <div className="destinations-tools">
      <label className="search-input"><Search size={16} aria-hidden="true" /><span className="sr-only">{t.filterDestinations}</span>
        <input type="search" placeholder={t.filterDestinations} value={filter} onChange={(event) => setFilter(event.target.value)} />
      </label>
      <div className="region-chips" role="group">
        <button type="button" className={region === 'all' ? 'active' : ''} aria-pressed={region === 'all'} onClick={() => setRegion('all')}>{t.allRegions}</button>
        {REGION_ORDER.map((key) => <button key={key} type="button" className={region === key ? 'active' : ''} aria-pressed={region === key} onClick={() => setRegion(key)}>{t.regions[key]}</button>)}
      </div>
    </div>
    <div className="country-grid">
      {visible.length === 0 && <p className="empty-state">{t.noDestinations}</p>}
      {visible.map((country) => <details className="country-card" key={country.code} open={!!query && country.airports.length <= 6}>
        <summary>
          <span className="country-name">{country.name}</span>
          <span className="country-count">{country.airports.length ? t.airportsCount(country.airports.length) : t.noAirport}</span>
        </summary>
        <ul>
          {country.airports.length === 0 && (NEAREST_GATEWAYS[country.code]?.length
            ? <li className="nearest-label">{t.nearestGateways}</li>
            : <li className="nearest-label">{t.noAirport}</li>)}
          {(country.airports.length ? country.airports : (NEAREST_GATEWAYS[country.code] ?? []).map((code) => AIRPORT_BY_CODE.get(code)!).filter(Boolean)).map((airport) => <li key={airport.code}>
            <span className="option-code">{airport.code}</span>
            <span className="airport-text"><strong>{airport.city}</strong><small>{airport.name}</small></span>
            <span className="airport-actions">
              <button type="button" onClick={() => onPick(airport.code, 'from')} title={t.flyFromHere} aria-label={`${t.flyFromHere}: ${airport.city} (${airport.code})`}><PlaneTakeoff size={15} /></button>
              <button type="button" onClick={() => onPick(airport.code, 'to')} title={t.flyHere} aria-label={`${t.flyHere}: ${airport.city} (${airport.code})`}><PlaneLanding size={15} /></button>
            </span>
          </li>)}
        </ul>
      </details>)}
    </div>
    <p className="storage-note"><MapPin size={13} /> OurAirports open data (public domain).</p>
  </main>
}
