import { describe, expect, it } from 'vitest'
import { addDays, todayIso } from './dates'
import { generateItineraries, priceBooking } from './flights'
import { createBookingPdf, pdfSafe } from './pdf'
import type { Booking } from './types'

const date = addDays(todayIso(), 20)

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  const outbound = generateItineraries('GZT', 'NBO', date, 'business').find((item) => item.stops > 0)!
  const inbound = generateItineraries('NBO', 'GZT', addDays(date, 9), 'business')[0]
  const passengers = { adults: 2, children: 1, infants: 1 }
  return {
    reference: 'K7QX2M',
    createdAt: new Date().toISOString(),
    status: 'confirmed',
    search: { tripType: 'round', from: 'GZT', to: 'NBO', departDate: date, returnDate: addDays(date, 9), passengers, cabin: 'business' },
    outbound,
    inbound,
    passengers: [
      { type: 'adult', gender: 'F', firstName: 'Zoë', lastName: 'Şahin', dob: '1988-02-03', nationality: 'TR', documentNumber: 'U12345678', documentExpiry: '2031-01-01', ticketNumber: '962-1234567890' },
      { type: 'adult', gender: 'M', firstName: 'Kwame', lastName: 'Mensah', dob: '1985-07-09', nationality: 'GH', documentNumber: 'G7654321', documentExpiry: '2030-01-01', ticketNumber: '962-1234567891' },
      { type: 'child', gender: 'F', firstName: 'Ama', lastName: 'Mensah', dob: '2018-07-09', nationality: 'GH', documentNumber: 'G7654322', documentExpiry: '2030-01-01', ticketNumber: '962-1234567892' },
      { type: 'infant', gender: 'M', firstName: 'Kofi', lastName: 'Mensah', dob: '2026-01-09', nationality: 'GH', documentNumber: 'G7654323', documentExpiry: '2030-01-01', ticketNumber: '962-1234567893' },
    ],
    contact: { email: 'zoe@example.com', phone: '+90 555 000 0000' },
    fare: priceBooking(outbound, inbound, passengers),
    currency: { code: 'NGN', rate: 1540 },
    ...overrides,
  }
}

describe('pdfSafe', () => {
  it('keeps Latin-1 accents and transliterates the rest', () => {
    expect(pdfSafe('Référence – Şanlıurfa → Łódź')).toBe("Référence - Sanliurfa -> Lódz")
    expect(pdfSafe('1 234,56 NGN')).toBe('1 234,56 NGN')
    expect(pdfSafe('北京')).toBe('??')
  })
})

describe('createBookingPdf', () => {
  for (const language of ['en', 'fr'] as const) {
    it(`renders a complete ${language} itinerary`, () => {
      const booking = makeBooking()
      const doc = createBookingPdf(booking, language)
      const raw = doc.output()
      expect(raw.startsWith('%PDF-')).toBe(true)
      expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1)
      const bytes = new TextEncoder().encode(raw).length
      expect(bytes).toBeGreaterThan(3000)
    })
  }

  it('includes the key booking details in the text layer', () => {
    const booking = makeBooking()
    // jsPDF keeps each page's uncompressed content stream in internal.pages.
    const text = (createBookingPdf(booking, 'en') as unknown as { internal: { pages: string[][] } }).internal.pages.flat().join('\n')
    for (const needle of ['K7QX2M', 'SAHIN, Zoë', 'MENSAH, Kwame', '962-1234567893', booking.outbound.segments[0].flightNumber, 'NGN', 'No payment collected']) {
      expect(text, needle).toContain(needle)
    }
    expect(text).not.toMatch(/[Ā-￿]/)
  })

  it('marks cancelled bookings', () => {
    const doc = createBookingPdf(makeBooking({ status: 'cancelled' }), 'fr')
    const text = (doc as unknown as { internal: { pages: string[][] } }).internal.pages.flat().join('\n')
    expect(text).toContain('ANNUL')
  })
})
