import { describe, expect, it } from 'vitest'
import { AIRPORTS, AIRPORT_BY_CODE, COUNTRY_CODES, NEAREST_GATEWAYS, AIRPORTS_BY_COUNTRY, searchAirports } from '../data/airports'
import { addDays, todayIso } from './dates'
import { generateItineraries, priceBooking } from './flights'

const date = addDays(todayIso(), 30)

describe('airport data', () => {
  it('covers every African country and the wider world', () => {
    const african = ['DZ', 'AO', 'BJ', 'BW', 'BF', 'BI', 'CV', 'CM', 'CF', 'TD', 'KM', 'CD', 'CG', 'CI', 'DJ', 'EG', 'GQ', 'ER', 'SZ', 'ET', 'GA', 'GM', 'GH', 'GN', 'GW', 'KE', 'LS', 'LR', 'LY', 'MG', 'MW', 'ML', 'MR', 'MU', 'MA', 'MZ', 'NA', 'NE', 'NG', 'RW', 'ST', 'SN', 'SC', 'SL', 'SO', 'ZA', 'SS', 'SD', 'TZ', 'TG', 'TN', 'UG', 'ZM', 'ZW']
    for (const code of african) expect(AIRPORTS_BY_COUNTRY.get(code)?.length, code).toBeGreaterThan(0)
    expect(AIRPORTS.length).toBeGreaterThan(3500)
    expect(COUNTRY_CODES.length).toBeGreaterThan(240)
  })

  it('gives every country either an airport or a nearest gateway, except uninhabited territories', () => {
    const uninhabited = ['AQ', 'GS', 'HM', 'TF', 'IO']
    const missing = COUNTRY_CODES.filter((code) => !AIRPORTS_BY_COUNTRY.has(code) && !NEAREST_GATEWAYS[code] && !uninhabited.includes(code))
    expect(missing).toEqual([])
    for (const gateways of Object.values(NEAREST_GATEWAYS)) for (const code of gateways) expect(AIRPORT_BY_CODE.has(code), code).toBe(true)
  })

  it('finds airports by code, city, accent-free spelling, country (EN/FR) and microstate', () => {
    expect(searchAirports('nbo')[0].airport.code).toBe('NBO')
    expect(searchAirports('lagos')[0].airport.code).toBe('LOS')
    expect(searchAirports('yaounde').some((s) => s.airport.code === 'NSI')).toBe(true)
    expect(searchAirports('Sénégal').some((s) => s.airport.code === 'DSS')).toBe(true)
    expect(searchAirports('Allemagne').some((s) => s.airport.country === 'DE')).toBe(true)
    expect(searchAirports('Monaco')[0]).toMatchObject({ airport: { code: 'NCE' }, nearestFor: 'MC' })
    expect(searchAirports('kenya')[0].airport.code).toBe('NBO')
    expect(searchAirports('zzzzqq')).toEqual([])
  })
})

describe('flight generation', () => {
  it('is deterministic and returns nonstop and connecting options', () => {
    const a = generateItineraries('NBO', 'LOS', date, 'economy')
    const b = generateItineraries('NBO', 'LOS', date, 'economy')
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThanOrEqual(3)
    expect(a.some((item) => item.stops === 0)).toBe(true)
    expect(new Set(a.map((item) => item.id)).size).toBe(a.length)
    expect(a.flatMap((item) => item.tags).sort()).toEqual(expect.arrayContaining(['best', 'cheapest', 'fastest']))
  })

  it('chains connecting segments correctly', () => {
    const options = generateItineraries('KMS', 'YVR', date, 'economy')
    expect(options.length).toBeGreaterThan(0)
    for (const option of options) {
      expect(option.stops).toBe(option.segments.length - 1)
      expect(option.segments[0].from).toBe('KMS')
      expect(option.segments.at(-1)!.to).toBe('YVR')
      option.segments.slice(1).forEach((segment, i) => expect(segment.from).toBe(option.segments[i].to))
    }
  })

  it('scales duration with distance and price with cabin', () => {
    const short = generateItineraries('JNB', 'CPT', date, 'economy')
    const long = generateItineraries('JNB', 'LHR', date, 'economy')
    const minDuration = (list: typeof short) => Math.min(...list.map((i) => i.durationMin))
    expect(minDuration(long)).toBeGreaterThan(minDuration(short) * 3)
    const business = generateItineraries('JNB', 'CPT', date, 'business')
    expect(Math.min(...business.map((i) => i.fareUsd))).toBeGreaterThan(Math.min(...short.map((i) => i.fareUsd)) * 2)
  })

  it('returns nothing for unknown or identical airports', () => {
    expect(generateItineraries('NBO', 'NBO', date, 'economy')).toEqual([])
    expect(generateItineraries('XXX', 'NBO', date, 'economy')).toEqual([])
  })

  it('drops departures that have already left today', () => {
    const now = new Date()
    now.setHours(23, 0, 0, 0)
    expect(generateItineraries('NBO', 'LOS', todayIso(now), 'economy', now)).toEqual([])
  })
})

describe('pricing', () => {
  it('prices adults, children and infants and adds the service fee', () => {
    const [outbound] = generateItineraries('NBO', 'LOS', date, 'economy')
    const [inbound] = generateItineraries('LOS', 'NBO', addDays(date, 7), 'economy')
    const fare = priceBooking(outbound, inbound, { adults: 2, children: 1, infants: 1 })
    const adultFare = outbound.fareUsd + inbound.fareUsd
    expect(fare.lines.map((line) => line.type)).toEqual(['adult', 'child', 'infant'])
    expect(fare.lines[0].fareEach).toBe(adultFare)
    expect(fare.lines[1].fareEach).toBe(Math.round(adultFare * 0.75))
    expect(fare.lines[2].fareEach).toBe(Math.round(adultFare * 0.1))
    expect(fare.total).toBe(fare.base + fare.taxes + fare.service)
    expect(fare.base).toBe(fare.lines.reduce((sum, line) => sum + line.fareEach * line.count, 0))
  })

  it('uses the configured service fee and discounts only the base fare', () => {
    const [outbound] = generateItineraries('NBO', 'LOS', date, 'economy')
    const plain = priceBooking(outbound, undefined, { adults: 1, children: 0, infants: 0 }, 0)
    const promo = priceBooking(outbound, undefined, { adults: 1, children: 0, infants: 0 }, 0, { code: 'SAVE10', percent: 10 })
    expect(plain.service).toBe(0)
    expect(promo.discount).toEqual({ code: 'SAVE10', percent: 10, amountUsd: Math.round(plain.base * 10) / 100 })
    expect(promo.total).toBeCloseTo(plain.total - plain.base * 0.1, 2)
  })
})
