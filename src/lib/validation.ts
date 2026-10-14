import type { Translation } from '../i18n'
import { ageOn, daysBetween, isValidIso } from './dates'
import type { Contact, Passenger, SearchParams } from './types'

export type ErrorKey = keyof Pick<Translation,
  'errRequired' | 'errName' | 'errEmail' | 'errPhone' | 'errDobFuture' | 'errAdultAge' | 'errChildAge' |
  'errInfantAge' | 'errDocument' | 'errExpiry' | 'errSameAirport' | 'errChooseAirport' | 'errDepartDate' | 'errReturnDate' | 'errTooFar'>

export type PassengerErrors = Partial<Record<keyof Passenger, ErrorKey>>
export type ContactErrors = Partial<Record<keyof Contact, ErrorKey>>

const NAME_PATTERN = /^[\p{L}][\p{L}\p{M}' .-]*$/u
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE_PATTERN = /^\+?[0-9 ()-]{7,20}$/
const DOCUMENT_PATTERN = /^[A-Z0-9]{5,20}$/i

export function validateSearch(search: SearchParams, isKnownAirport: (code: string) => boolean, today: string): ErrorKey | null {
  if (!isKnownAirport(search.from) || !isKnownAirport(search.to)) return 'errChooseAirport'
  if (search.from === search.to) return 'errSameAirport'
  if (!isValidIso(search.departDate) || search.departDate < today) return 'errDepartDate'
  if (daysBetween(today, search.departDate) > 360) return 'errTooFar'
  if (search.tripType === 'round') {
    if (!isValidIso(search.returnDate) || search.returnDate < search.departDate) return 'errReturnDate'
    if (daysBetween(today, search.returnDate) > 360) return 'errTooFar'
  }
  return null
}

/** `travelDate` is the first flight's date (age rules), `lastTravelDate` the final flight's date (document validity). */
export function validatePassenger(passenger: Passenger, travelDate: string, lastTravelDate: string, today: string): PassengerErrors {
  const errors: PassengerErrors = {}
  for (const key of ['gender', 'firstName', 'lastName', 'dob', 'nationality', 'documentNumber', 'documentExpiry'] as const) {
    if (!passenger[key].trim()) errors[key] = 'errRequired'
  }
  if (!errors.firstName && !NAME_PATTERN.test(passenger.firstName.trim())) errors.firstName = 'errName'
  if (!errors.lastName && !NAME_PATTERN.test(passenger.lastName.trim())) errors.lastName = 'errName'
  if (!errors.dob) {
    if (!isValidIso(passenger.dob) || passenger.dob > today) errors.dob = 'errDobFuture'
    else {
      const age = ageOn(passenger.dob, travelDate)
      if (passenger.type === 'adult' && age < 12) errors.dob = 'errAdultAge'
      if (passenger.type === 'child' && (age < 2 || age > 11)) errors.dob = 'errChildAge'
      if (passenger.type === 'infant' && age >= 2) errors.dob = 'errInfantAge'
    }
  }
  if (!errors.documentNumber && !DOCUMENT_PATTERN.test(passenger.documentNumber.trim())) errors.documentNumber = 'errDocument'
  if (!errors.documentExpiry && (!isValidIso(passenger.documentExpiry) || passenger.documentExpiry <= lastTravelDate)) errors.documentExpiry = 'errExpiry'
  return errors
}

export function validateContact(contact: Contact): ContactErrors {
  const errors: ContactErrors = {}
  if (!contact.email.trim()) errors.email = 'errRequired'
  else if (!EMAIL_PATTERN.test(contact.email.trim())) errors.email = 'errEmail'
  if (!contact.phone.trim()) errors.phone = 'errRequired'
  else if (!PHONE_PATTERN.test(contact.phone.trim()) || contact.phone.replace(/\D/g, '').length < 7) errors.phone = 'errPhone'
  return errors
}
