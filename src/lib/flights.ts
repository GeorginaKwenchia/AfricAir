import { AIRPORT_BY_CODE, HUB_AIRPORTS, distanceKm, type Airport } from '../data/airports'
import { addDays } from './dates'
import type { Cabin, FareBreakdown, Itinerary, PassengerCounts, Segment } from './types'

/**
 * AfricAir has no live airline inventory, so flight options are generated deterministically
 * from the route, date and cabin: the same search always returns the same flights and fares.
 * Durations and fares scale with the great-circle distance; long or regional routes connect via real hubs.
 */

const AIRLINES = [
  { name: 'Kora Air', code: 'KR' },
  { name: 'Baobab Connect', code: 'BB' },
  { name: 'Atlas Africa', code: 'AT' },
  { name: 'Sahel Wings', code: 'SW' },
  { name: 'Zambezi Airways', code: 'ZB' },
  { name: 'Meridian Global', code: 'MG' },
]


const CABIN_MULTIPLIER: Record<Cabin, number> = { economy: 1, premium: 1.65, business: 3.3, first: 5.4 }
export const CHILD_FARE_RATIO = 0.75
export const INFANT_FARE_RATIO = 0.1
export const INFANT_TAX_RATIO = 0.3
export const SERVICE_FEE_USD = 15

function hashString(value: string) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededRandom(seed: string) {
  let state = hashString(seed)
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const roundTo = (value: number, step: number) => Math.round(value / step) * step
const clock = (minutes: number) => `${String(Math.floor((minutes % 1440) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

function blockTime(km: number) {
  return Math.max(45, roundTo(35 + (km / 820) * 60, 5))
}

function aircraftFor(km: number) {
  if (km < 900) return 'ATR 72-600'
  if (km < 3500) return 'Airbus A220-300'
  if (km < 6500) return 'Boeing 737 MAX 8'
  return 'Boeing 787-9'
}

function nonstopPossible(origin: Airport, destination: Airport, km: number) {
  if (km <= 1500) return true
  return km <= 13500 && origin.size >= 2 && destination.size >= 2 && (km <= 7000 || (origin.size === 3 && destination.size === 3))
}

function bestHubs(origin: Airport, destination: Airport, km: number) {
  return HUB_AIRPORTS
    .map((code) => AIRPORT_BY_CODE.get(code))
    .filter((hub): hub is Airport => !!hub && hub.code !== origin.code && hub.code !== destination.code)
    .map((hub) => {
      const first = distanceKm(origin, hub)
      const second = distanceKm(hub, destination)
      return { hub, first, second, detour: (first + second) / Math.max(km, 1) }
    })
    .filter(({ first, second }) => first > 150 && second > 150)
    .sort((a, b) => a.detour - b.detour)
}

function buildSegment(rng: () => number, airline: (typeof AIRLINES)[number], from: Airport, to: Airport, date: string, departMinutes: number): Segment & { endMinutes: number } {
  const km = distanceKm(from, to)
  const durationMin = blockTime(km)
  const endMinutes = departMinutes + durationMin
  return {
    flightNumber: `${airline.code} ${100 + Math.floor(rng() * 8900)}`,
    airline: airline.name,
    from: from.code,
    to: to.code,
    departDate: addDays(date, Math.floor(departMinutes / 1440)),
    departTime: clock(departMinutes),
    arriveDate: addDays(date, Math.floor(endMinutes / 1440)),
    arriveTime: clock(endMinutes),
    durationMin,
    aircraft: aircraftFor(km),
    endMinutes,
  }
}

export function generateItineraries(fromCode: string, toCode: string, date: string, cabin: Cabin, now = new Date()): Itinerary[] {
  const origin = AIRPORT_BY_CODE.get(fromCode)
  const destination = AIRPORT_BY_CODE.get(toCode)
  if (!origin || !destination || origin.code === destination.code) return []
  const rng = seededRandom(`${fromCode}-${toCode}-${date}`)
  const km = distanceKm(origin, destination)
  const pickAirline = () => AIRLINES[Math.floor(rng() * AIRLINES.length)]
  const departureWindows = [[6 * 60, 9 * 60 + 30], [11 * 60, 14 * 60 + 30], [16 * 60, 19 * 60], [20 * 60, 23 * 60]]
  const departureIn = (window: number[]) => roundTo(window[0] + rng() * (window[1] - window[0]), 5)

  type Draft = { airline: string; segments: Segment[]; durationMin: number; flownKm: number }
  const drafts: Draft[] = []

  if (nonstopPossible(origin, destination, km)) {
    const windows = km > 6000 ? [departureWindows[0], departureWindows[3]] : departureWindows.slice(0, 3)
    for (const window of windows) {
      const airline = pickAirline()
      const segment = buildSegment(rng, airline, origin, destination, date, departureIn(window))
      const { endMinutes: _end, ...clean } = segment
      drafts.push({ airline: airline.name, segments: [clean], durationMin: clean.durationMin, flownKm: km })
    }
  }

  const hubs = bestHubs(origin, destination, km)
  const goodHubs = hubs.filter(({ detour }) => detour < (km < 1500 ? 2.2 : 1.45))
  const connectionHubs = (goodHubs.length ? goodHubs : hubs).slice(0, drafts.length ? 2 : 3)
  connectionHubs.forEach(({ hub, first, second }, index) => {
    const windows = index === 0 && drafts.length < 2 ? [departureWindows[0], departureWindows[2]] : [departureWindows[index % 3]]
    for (const window of windows) {
      const airline = pickAirline()
      const leg1 = buildSegment(rng, airline, origin, hub, date, departureIn(window))
      const layover = roundTo(65 + rng() * 170, 5)
      const leg2 = buildSegment(rng, rng() > 0.7 ? pickAirline() : airline, hub, destination, date, leg1.endMinutes + layover)
      const start = leg1.endMinutes - leg1.durationMin
      const { endMinutes: _a, ...s1 } = leg1
      const { endMinutes: end, ...s2 } = leg2
      drafts.push({ airline: airline.name, segments: [s1, s2], durationMin: end - start, flownKm: first + second })
    }
  })

  const minimumDeparture = isToday(date, now) ? now.getHours() * 60 + now.getMinutes() + 120 : -1
  const itineraries: Itinerary[] = drafts
    .filter((draft) => toMinutes(draft.segments[0].departTime) >= minimumDeparture)
    .map((draft, index) => {
      const nonstopPremium = draft.segments.length === 1 ? 1.08 : 0.9
      const fareUsd = Math.round(CABIN_MULTIPLIER[cabin] * (38 + draft.flownKm * 0.068) * nonstopPremium * (0.85 + rng() * 0.45))
      return {
        id: `${fromCode}${toCode}-${date}-${cabin}-${index}`,
        airline: draft.airline,
        segments: draft.segments,
        durationMin: draft.durationMin,
        stops: draft.segments.length - 1,
        fareUsd,
        taxUsd: Math.round(16 + draft.flownKm * 0.005 + draft.segments.length * 9),
        seatsLeft: 2 + Math.floor(rng() * 8),
        tags: [],
      }
    })
    .sort((a, b) => toMinutes(a.segments[0].departTime) - toMinutes(b.segments[0].departTime))

  if (itineraries.length) {
    const cheapest = itineraries.reduce((best, item) => (item.fareUsd < best.fareUsd ? item : best))
    const fastest = itineraries.reduce((best, item) => (item.durationMin < best.durationMin ? item : best))
    const score = (item: Itinerary) => item.fareUsd / cheapest.fareUsd + item.durationMin / fastest.durationMin
    const best = itineraries.reduce((winner, item) => (score(item) < score(winner) ? item : winner))
    cheapest.tags.push('cheapest')
    fastest.tags.push('fastest')
    best.tags.push('best')
  }
  return itineraries
}

const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function isToday(iso: string, now: Date) {
  return iso === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** `promo` discounts the base fare only (not taxes or the service fee). */
export function priceBooking(
  outbound: Itinerary, inbound: Itinerary | undefined, counts: PassengerCounts,
  serviceFeeUsd = SERVICE_FEE_USD, promo?: { code: string; percent: number },
): FareBreakdown {
  const fare = outbound.fareUsd + (inbound?.fareUsd ?? 0)
  const tax = outbound.taxUsd + (inbound?.taxUsd ?? 0)
  const lines = [
    { type: 'adult' as const, count: counts.adults, fareEach: fare, taxEach: tax },
    { type: 'child' as const, count: counts.children, fareEach: Math.round(fare * CHILD_FARE_RATIO), taxEach: tax },
    { type: 'infant' as const, count: counts.infants, fareEach: Math.round(fare * INFANT_FARE_RATIO), taxEach: Math.round(tax * INFANT_TAX_RATIO) },
  ].filter((line) => line.count > 0)
  const base = lines.reduce((sum, line) => sum + line.fareEach * line.count, 0)
  const taxes = lines.reduce((sum, line) => sum + line.taxEach * line.count, 0)
  const discount = promo ? { code: promo.code, percent: promo.percent, amountUsd: Math.round(base * promo.percent) / 100 } : undefined
  return { lines, base, taxes, service: serviceFeeUsd, ...(discount ? { discount } : {}), total: base - (discount?.amountUsd ?? 0) + taxes + serviceFeeUsd }
}

export const totalTravellers = (counts: PassengerCounts) => counts.adults + counts.children + counts.infants

export function baggageAllowance(cabin: Cabin) {
  return { economy: '1 × 23 kg', premium: '2 × 23 kg', business: '2 × 32 kg', first: '3 × 32 kg' }[cabin]
}
