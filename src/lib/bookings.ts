import type { Booking } from './types'

const STORAGE_KEY = 'africair.bookings.v1'
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomInt(max: number) {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return values[0] % max
}

/** Six-character airline-style record locator, avoiding look-alike characters (0/O, 1/I). */
export function makeReference(existing: string[] = []) {
  let reference = ''
  do {
    reference = Array.from({ length: 6 }, () => REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)]).join('')
  } while (existing.includes(reference))
  return reference
}

export function makeTicketNumber() {
  return `962-${Array.from({ length: 10 }, () => randomInt(10)).join('')}`
}

export function loadBookings(): Booking[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.reference === 'string') : []
  } catch {
    return []
  }
}

function persist(bookings: Booking[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings))
    return true
  } catch {
    return false
  }
}

export function saveBooking(booking: Booking) {
  const bookings = loadBookings().filter((item) => item.reference !== booking.reference)
  return persist([booking, ...bookings])
}

export function updateBooking(reference: string, change: Partial<Booking>) {
  const bookings = loadBookings().map((item) => (item.reference === reference ? { ...item, ...change } : item))
  persist(bookings)
  return bookings.find((item) => item.reference === reference)
}

export function removeBooking(reference: string) {
  persist(loadBookings().filter((item) => item.reference !== reference))
}

export function findBooking(reference: string, lastName: string) {
  const ref = reference.trim().toUpperCase()
  const name = lastName.trim().toLowerCase()
  return loadBookings().find((booking) => booking.reference === ref && booking.passengers.some((passenger) => passenger.lastName.trim().toLowerCase() === name))
}
