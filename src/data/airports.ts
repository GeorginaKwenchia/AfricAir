import raw from './airports.json'

export type Airport = {
  code: string
  name: string
  city: string
  country: string // ISO 3166-1 alpha-2
  lat: number
  lon: number
  size: 1 | 2 | 3 // 3 = large hub, 2 = medium, 1 = small regional
}

type RawAirport = [string, string, string, string, number, number, number]

export const AIRPORTS: Airport[] = (raw.airports as RawAirport[]).map(([code, name, city, country, lat, lon, size]) => ({
  code, name, city, country, lat, lon, size: size as Airport['size'],
}))

export const AIRPORT_BY_CODE = new Map(AIRPORTS.map((airport) => [airport.code, airport]))

export const COUNTRY_CODES = Object.keys(raw.countries)
const COUNTRY_FALLBACK_NAMES = raw.countries as Record<string, string>
export const CONTINENT_BY_COUNTRY = raw.continents as Record<string, string>

export const AIRPORTS_BY_COUNTRY = AIRPORTS.reduce((map, airport) => {
  const list = map.get(airport.country) ?? []
  list.push(airport)
  map.set(airport.country, list)
  return map
}, new Map<string, Airport[]>())

/** Countries and territories with no scheduled-service airport, mapped to the closest practical gateways. */
export const NEAREST_GATEWAYS: Record<string, string[]> = {
  AD: ['BCN', 'TLS'],
  LI: ['ZRH', 'ACH'],
  MC: ['NCE'],
  SM: ['RMI', 'BLQ'],
  VA: ['FCO', 'CIA'],
  PS: ['AMM', 'TLV'],
  UA: ['RZE', 'KRK', 'RMO'],
  TK: ['APW'],
  PN: ['GMR'],
}

const displayNames = new Map<string, Intl.DisplayNames | null>()
function regionNames(language: string) {
  if (!displayNames.has(language)) {
    try {
      displayNames.set(language, new Intl.DisplayNames([language], { type: 'region' }))
    } catch {
      displayNames.set(language, null)
    }
  }
  return displayNames.get(language)
}

export function countryName(code: string, language = 'en') {
  try {
    const name = regionNames(language)?.of(code)
    if (name && name !== code) return name
  } catch {
    // Unknown region code for this runtime; fall through to the dataset name.
  }
  return COUNTRY_FALLBACK_NAMES[code] ?? code
}

export const normalise = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

export const airportLabel = (airport: Airport) => `${airport.city} (${airport.code})`

/** Main international gateways: ranked first in search and used as connection points. */
export const HUB_AIRPORTS = [
  'ADD', 'NBO', 'JNB', 'CAI', 'CMN', 'LOS', 'ACC', 'DSS', 'KGL', 'ALG', 'ABJ', 'LAD', 'DAR',
  'DXB', 'DOH', 'IST', 'CDG', 'LHR', 'FRA', 'AMS', 'MAD', 'JFK', 'ATL', 'ORD', 'LAX', 'MIA',
  'GRU', 'BOG', 'PTY', 'MEX', 'YYZ', 'SIN', 'HKG', 'BKK', 'ICN', 'NRT', 'PEK', 'DEL', 'BOM', 'SYD', 'AKL',
]
const PROMINENT = new Set([...HUB_AIRPORTS, 'CPT', 'ABV', 'TUN', 'EBB', 'LUN', 'HRE', 'MRU', 'FIH', 'DLA', 'RAK', 'HND', 'PVG', 'SFO', 'YUL', 'EZE', 'FCO', 'MUC', 'BCN', 'ZRH', 'BRU', 'LGW', 'MEL'])

const searchIndex = AIRPORTS.map((airport) => ({
  airport,
  city: normalise(airport.city),
  name: normalise(airport.name),
  countryEn: normalise(countryName(airport.country, 'en')),
  countryFr: normalise(countryName(airport.country, 'fr')),
  countryRaw: normalise(COUNTRY_FALLBACK_NAMES[airport.country] ?? ''),
}))

export type AirportSuggestion = { airport: Airport; nearestFor?: string }

/** Ranked airport search over IATA code, city, airport name and country (English and French names). */
export function searchAirports(query: string, limit = 40): AirportSuggestion[] {
  const q = normalise(query)
  if (!q) return []
  const scored: { airport: Airport; score: number }[] = []
  for (const entry of searchIndex) {
    let score = -1
    if (entry.airport.code.toLowerCase() === q) score = 100
    else if (entry.city === q) score = 90
    else if (entry.city.startsWith(q)) score = 80
    else if (entry.name.startsWith(q)) score = 70
    else if ([entry.countryEn, entry.countryFr, entry.countryRaw].some((name) => name === q)) score = 65
    else if ([entry.countryEn, entry.countryFr, entry.countryRaw].some((name) => name.startsWith(q))) score = 60
    else if (entry.city.includes(q) || entry.name.includes(q)) score = 50
    else if (q.length >= 3 && [entry.countryEn, entry.countryFr].some((name) => name.includes(q))) score = 40
    if (score >= 0) scored.push({ airport: entry.airport, score: score + entry.airport.size * 2 + (PROMINENT.has(entry.airport.code) ? 8 : 0) })
  }
  scored.sort((a, b) => b.score - a.score || a.airport.city.localeCompare(b.airport.city))
  const results: AirportSuggestion[] = scored.slice(0, limit).map(({ airport }) => ({ airport }))

  // Countries without their own airport (e.g. Monaco) suggest the nearest gateways.
  for (const [country, gateways] of Object.entries(NEAREST_GATEWAYS)) {
    const names = [countryName(country, 'en'), countryName(country, 'fr'), COUNTRY_FALLBACK_NAMES[country] ?? ''].map(normalise)
    if (q.length >= 3 && names.some((name) => name.startsWith(q))) {
      for (const code of gateways) {
        const airport = AIRPORT_BY_CODE.get(code)
        if (airport && !results.some((result) => result.airport.code === code)) results.unshift({ airport, nearestFor: country })
      }
    }
  }
  return results.slice(0, limit)
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: Pick<Airport, 'lat' | 'lon'>, b: Pick<Airport, 'lat' | 'lon'>) {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

export const POPULAR_AIRPORTS = ['NBO', 'LOS', 'JNB', 'CAI', 'ADD', 'CMN', 'ACC', 'DSS', 'KGL', 'DAR', 'LHR', 'CDG', 'DXB', 'JFK']
