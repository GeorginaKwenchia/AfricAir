import { jsPDF } from 'jspdf'
import { AIRPORT_BY_CODE, countryName } from '../data/airports'
import { formatMoney } from '../data/currencies'
import { TRANSLATIONS } from '../i18n'
import { formatDate, formatDuration } from './dates'
import { baggageAllowance } from './flights'
import type { Booking, Itinerary, Language } from './types'

const PAGE = { width: 595.28, height: 841.89, margin: 40 }
const COLOR = {
  deep: [11, 91, 90] as const,
  sun: [244, 201, 93] as const,
  coral: [237, 129, 100] as const,
  ink: [23, 38, 46] as const,
  muted: [109, 120, 124] as const,
  line: [219, 228, 225] as const,
  mist: [244, 248, 246] as const,
  red: [163, 60, 48] as const,
}

const PDF_LABELS = {
  en: {
    title: 'FLIGHT ITINERARY & RESERVATION', issued: 'Issued', page: 'Page', of: 'of', aircraft: 'Aircraft', class: 'Class',
    passenger: 'Traveller', type: 'Type', document: 'Document', paymentStatus: 'Payment status', paymentNone: 'No payment collected',
    importantTitle: 'IMPORTANT INFORMATION',
    important: [
      'Check in online or at the airport at least 3 hours before international departures and 2 hours before domestic departures.',
      'Carry the passport or ID card listed above, plus any visa or health documents required by your destination and transit points.',
      'No payment has been collected by AfricAir. This document confirms the reservation details only.',
      'Schedules and fares are indicative. All times are local to the airport shown.',
    ],
    cancelledBanner: 'THIS BOOKING HAS BEEN CANCELLED',
  },
  fr: {
    title: 'ITINÉRAIRE ET RÉSERVATION', issued: 'Émis le', page: 'Page', of: 'sur', aircraft: 'Appareil', class: 'Classe',
    passenger: 'Voyageur', type: 'Type', document: 'Document', paymentStatus: 'Statut du paiement', paymentNone: 'Aucun paiement collecté',
    importantTitle: 'INFORMATIONS IMPORTANTES',
    important: [
      'Enregistrez-vous en ligne ou à l’aéroport au moins 3 heures avant un vol international et 2 heures avant un vol intérieur.',
      'Munissez-vous du passeport ou de la pièce d’identité indiqués ci-dessus, ainsi que des visas ou documents sanitaires exigés.',
      'AfricAir n’a collecté aucun paiement. Ce document confirme uniquement les détails de la réservation.',
      'Horaires et tarifs indicatifs. Toutes les heures sont locales à l’aéroport indiqué.',
    ],
    cancelledBanner: 'CETTE RÉSERVATION A ÉTÉ ANNULÉE',
  },
}

/**
 * The built-in PDF fonts only cover Latin-1. Keep accents French needs (é, è, ç…) and transliterate
 * everything else (e.g. "Şanlıurfa" → "Sanliurfa", narrow no-break spaces from fr-FR number formatting → space).
 */
export function pdfSafe(text: string) {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/[    ]/g, ' ')
    .replace(/…/g, '...')
    .replace(/→/g, '->')
    .replace(/×/g, 'x')
    .replace(/[^\u0000-ÿ]/g, (char) => {
      const stripped = char.normalize('NFKD').replace(/[̀-ͯ]/g, '')
      const map: Record<string, string> = { ı: 'i', ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ħ: 'h', œ: 'oe', Œ: 'OE', ß: 'ss', ŋ: 'ng' }
      if (map[char]) return map[char]
      return /^[\u0000-ÿ]+$/.test(stripped) ? stripped : '?'
    })
}

function maskDocument(value: string) {
  const clean = value.trim()
  return clean.length <= 4 ? clean : `${'*'.repeat(Math.min(clean.length - 4, 6))}${clean.slice(-4)}`
}

export function createBookingPdf(booking: Booking, language: Language) {
  const t = TRANSLATIONS[language]
  const labels = PDF_LABELS[language]
  const locale = language === 'fr' ? 'fr-FR' : 'en-GB'
  const money = (usd: number) => formatMoney(usd, { ...booking.currency, label: booking.currency.code }, locale, true)
  const cabinLabel = t[booking.search.cabin]
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  doc.setProperties({ title: `AfricAir ${booking.reference}`, subject: labels.title, creator: 'AfricAir' })

  const { margin, width, height } = PAGE
  const contentWidth = width - margin * 2
  let y = 0

  const color = (rgb: readonly number[], target: 'text' | 'fill' | 'draw' = 'text') => {
    if (target === 'text') doc.setTextColor(rgb[0], rgb[1], rgb[2])
    if (target === 'fill') doc.setFillColor(rgb[0], rgb[1], rgb[2])
    if (target === 'draw') doc.setDrawColor(rgb[0], rgb[1], rgb[2])
  }
  const font = (size: number, style: 'normal' | 'bold' = 'normal', rgb: readonly number[] = COLOR.ink) => {
    doc.setFont('helvetica', style)
    doc.setFontSize(size)
    color(rgb)
  }
  const text = (value: string, x: number, yy: number, options?: { align?: 'left' | 'right' | 'center'; maxWidth?: number }) => {
    doc.text(pdfSafe(value), x, yy, options)
  }
  const ensureSpace = (needed: number) => {
    if (y + needed > height - 60) {
      doc.addPage()
      y = margin + 10
    }
  }
  const sectionTitle = (title: string) => {
    ensureSpace(40)
    font(10, 'bold', COLOR.deep)
    text(title.toUpperCase(), margin, y)
    color(COLOR.line, 'draw')
    doc.setLineWidth(0.8)
    doc.line(margin, y + 7, width - margin, y + 7)
    y += 24
  }

  // Header band
  color(COLOR.deep, 'fill')
  doc.rect(0, 0, width, 118, 'F')
  font(26, 'bold', COLOR.sun)
  text('Afric', margin, 52)
  const afric = doc.getTextWidth('Afric')
  color(COLOR.coral)
  text('Air', margin + afric, 52)
  font(9, 'bold', [255, 255, 255])
  text(labels.title, margin, 74)
  font(9, 'normal', [214, 230, 226])
  text(`${labels.issued}: ${formatDate(booking.createdAt.slice(0, 10), locale)}`, margin, 92)
  font(9, 'bold', [214, 230, 226])
  text(t.reference.toUpperCase(), width - margin, 44, { align: 'right' })
  font(24, 'bold', [255, 255, 255])
  text(booking.reference, width - margin, 72, { align: 'right' })
  const cancelled = booking.status === 'cancelled'
  font(9, 'bold', cancelled ? COLOR.coral : COLOR.sun)
  text(`${t.status}: ${(cancelled ? t.cancelled : t.confirmed).toUpperCase()}`, width - margin, 92, { align: 'right' })
  y = 150

  if (cancelled) {
    color([253, 236, 232], 'fill')
    doc.roundedRect(margin, y - 16, contentWidth, 28, 6, 6, 'F')
    font(10, 'bold', COLOR.red)
    text(labels.cancelledBanner, width / 2, y + 2, { align: 'center' })
    y += 34
  }

  // Route summary
  const origin = AIRPORT_BY_CODE.get(booking.search.from)
  const destination = AIRPORT_BY_CODE.get(booking.search.to)
  font(18, 'bold')
  const routeLeft = `${origin?.city ?? booking.search.from} (${booking.search.from})`
  text(routeLeft, margin, y)
  const arrowX = margin + doc.getTextWidth(pdfSafe(routeLeft)) + 10
  color(COLOR.coral, 'draw')
  doc.setLineWidth(1.6)
  doc.line(arrowX, y - 6, arrowX + 22, y - 6)
  doc.line(arrowX + 16, y - 11, arrowX + 22, y - 6)
  doc.line(arrowX + 16, y - 1, arrowX + 22, y - 6)
  if (booking.inbound) {
    doc.line(arrowX, y - 6, arrowX + 6, y - 11)
    doc.line(arrowX, y - 6, arrowX + 6, y - 1)
  }
  text(`${destination?.city ?? booking.search.to} (${booking.search.to})`, arrowX + 32, y)
  y += 20
  font(10, 'normal', COLOR.muted)
  const travellerCount = booking.passengers.length
  const summary = [
    booking.inbound ? t.roundTrip : t.oneWay,
    booking.inbound ? `${formatDate(booking.outbound.segments[0].departDate, locale)} - ${formatDate(booking.inbound.segments[0].departDate, locale)}` : formatDate(booking.outbound.segments[0].departDate, locale),
    cabinLabel,
    `${travellerCount} ${travellerCount === 1 ? t.traveller : t.travellersPlural}`,
  ].join('   |   ')
  text(summary, margin, y)
  y += 30

  const drawLeg = (title: string, itinerary: Itinerary) => {
    sectionTitle(`${title} - ${formatDate(itinerary.segments[0].departDate, locale)} - ${formatDuration(itinerary.durationMin)} - ${itinerary.stops === 0 ? t.nonstop : `${itinerary.stops} ${itinerary.stops === 1 ? t.stop : t.stops}`}`)
    itinerary.segments.forEach((segment, index) => {
      const from = AIRPORT_BY_CODE.get(segment.from)
      const to = AIRPORT_BY_CODE.get(segment.to)
      const boxHeight = 104
      ensureSpace(boxHeight + 30)
      color(COLOR.mist, 'fill')
      color(COLOR.line, 'draw')
      doc.setLineWidth(0.6)
      doc.roundedRect(margin, y, contentWidth, boxHeight, 8, 8, 'FD')

      font(10, 'bold', COLOR.deep)
      text(segment.flightNumber, margin + 14, y + 20)
      font(9, 'normal', COLOR.muted)
      text(`${segment.airline}  |  ${labels.aircraft}: ${segment.aircraft}  |  ${labels.class}: ${cabinLabel}  |  ${t.baggage}: ${baggageAllowance(booking.search.cabin)}`, margin + 80, y + 20)

      const columnY = y + 48
      const leftX = margin + 14
      const rightX = width - margin - 14
      font(20, 'bold')
      text(segment.departTime, leftX, columnY)
      text(segment.arriveTime, rightX, columnY, { align: 'right' })
      font(9, 'bold', COLOR.coral)
      text(`${segment.from}  ${formatDate(segment.departDate, locale)}`, leftX, columnY + 16)
      text(`${formatDate(segment.arriveDate, locale)}  ${segment.to}`, rightX, columnY + 16, { align: 'right' })
      font(8.5, 'normal', COLOR.muted)
      const half = contentWidth / 2 - 70
      text(from ? `${from.name}, ${countryName(from.country, language)}` : segment.from, leftX, columnY + 31, { maxWidth: half })
      text(to ? `${to.name}, ${countryName(to.country, language)}` : segment.to, rightX, columnY + 31, { align: 'right', maxWidth: half })

      const midX = width / 2
      color(COLOR.line, 'draw')
      doc.setLineWidth(1)
      doc.line(midX - 60, columnY - 6, midX + 60, columnY - 6)
      color(COLOR.deep, 'fill')
      doc.circle(midX - 60, columnY - 6, 2.5, 'F')
      doc.circle(midX + 60, columnY - 6, 2.5, 'F')
      font(9, 'bold', COLOR.deep)
      text(formatDuration(segment.durationMin), midX, columnY - 12, { align: 'center' })
      y += boxHeight + 8

      const next = itinerary.segments[index + 1]
      if (next) {
        const [ah, am] = segment.arriveTime.split(':').map(Number)
        const [dh, dm] = next.departTime.split(':').map(Number)
        const dayGap = Math.round((Date.parse(next.departDate) - Date.parse(segment.arriveDate)) / 86_400_000)
        const layover = dayGap * 1440 + dh * 60 + dm - (ah * 60 + am)
        font(9, 'bold', COLOR.coral)
        text(`${formatDuration(layover)} ${t.layover} - ${to?.city ?? segment.to} (${segment.to})`, width / 2, y + 6, { align: 'center' })
        y += 18
      }
    })
    y += 12
  }

  drawLeg(t.outbound, booking.outbound)
  if (booking.inbound) drawLeg(t.return, booking.inbound)

  // Travellers
  sectionTitle(t.bookedFor)
  const columns = [
    { label: '#', x: margin },
    { label: labels.passenger, x: margin + 18 },
    { label: labels.type, x: margin + 180 },
    { label: t.dateOfBirth, x: margin + 232 },
    { label: labels.document, x: margin + 338 },
    { label: t.ticket, x: margin + 418 },
  ]
  font(8, 'bold', COLOR.muted)
  columns.forEach((column) => text(column.label.toUpperCase(), column.x, y))
  y += 16
  booking.passengers.forEach((passenger, index) => {
    ensureSpace(22)
    font(9.5, 'normal')
    const name = `${passenger.lastName.trim().toUpperCase()}, ${passenger.firstName.trim()}`
    const values = [String(index + 1), name, t[passenger.type], formatDate(passenger.dob, locale, 'numeric'), maskDocument(passenger.documentNumber), passenger.ticketNumber]
    values.forEach((value, i) => text(value, columns[i].x, y, i === 1 ? { maxWidth: 158 } : undefined))
    color(COLOR.line, 'draw')
    doc.setLineWidth(0.4)
    doc.line(margin, y + 7, width - margin, y + 7)
    y += 20
  })
  y += 6
  ensureSpace(20)
  font(9, 'normal', COLOR.muted)
  text(`${t.contact}: ${booking.contact.email}  |  ${booking.contact.phone}`, margin, y)
  y += 28

  // Fare
  sectionTitle(t.fareBreakdown)
  const fareRow = (label: string, value: string, bold = false) => {
    ensureSpace(18)
    font(bold ? 12 : 9.5, bold ? 'bold' : 'normal', bold ? COLOR.deep : COLOR.ink)
    text(label, margin, y)
    text(value, width - margin, y, { align: 'right' })
    y += bold ? 22 : 16
  }
  booking.fare.lines.forEach((line) => {
    fareRow(`${line.count} x ${t[line.type]}  (${t.baseFare} ${money(line.fareEach)} + ${t.taxes.toLowerCase()} ${money(line.taxEach)})`, money((line.fareEach + line.taxEach) * line.count))
  })
  fareRow(t.baseFare, money(booking.fare.base))
  fareRow(t.taxes, money(booking.fare.taxes))
  if (booking.fare.discount) fareRow(`${t.promoCode} ${booking.fare.discount.code} (-${booking.fare.discount.percent}%)`, `- ${money(booking.fare.discount.amountUsd)}`)
  fareRow(t.service, money(booking.fare.service))
  color(COLOR.line, 'draw')
  doc.line(margin, y - 6, width - margin, y - 6)
  y += 8
  fareRow(t.total, money(booking.fare.total), true)
  fareRow(labels.paymentStatus, labels.paymentNone)
  y += 12

  // Important information
  const lines = labels.important.flatMap((item) => doc.splitTextToSize(pdfSafe(`- ${item}`), contentWidth - 28) as string[])
  const boxHeight = 34 + lines.length * 12
  ensureSpace(boxHeight + 10)
  color(COLOR.mist, 'fill')
  doc.roundedRect(margin, y, contentWidth, boxHeight, 8, 8, 'F')
  font(9, 'bold', COLOR.deep)
  text(labels.importantTitle, margin + 14, y + 20)
  font(8.5, 'normal', COLOR.muted)
  doc.text(lines, margin + 14, y + 36)
  y += boxHeight

  // Footer on every page
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page)
    color(COLOR.line, 'draw')
    doc.setLineWidth(0.5)
    doc.line(margin, height - 38, width - margin, height - 38)
    font(8, 'normal', COLOR.muted)
    text(`AfricAir  |  ${t.reference}: ${booking.reference}  |  ${t.footerNote}`, margin, height - 24)
    text(`${labels.page} ${page} ${labels.of} ${pages}`, width - margin, height - 24, { align: 'right' })
  }
  return doc
}

export const pdfFileName = (booking: Booking) => `AfricAir-${booking.reference}${booking.status === 'cancelled' ? '-cancelled' : ''}.pdf`

export function downloadBookingPdf(booking: Booking, language: Language) {
  createBookingPdf(booking, language).save(pdfFileName(booking))
}
