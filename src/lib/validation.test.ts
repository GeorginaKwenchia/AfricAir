import { describe, expect, it } from 'vitest'
import { AIRPORT_BY_CODE } from '../data/airports'
import { validateContact, validatePassenger, validateSearch } from './validation'
import type { Passenger, SearchParams } from './types'

const today = '2026-10-13'
const known = (code: string) => AIRPORT_BY_CODE.has(code)
const search: SearchParams = { tripType: 'round', from: 'NBO', to: 'LOS', departDate: '2026-11-01', returnDate: '2026-11-08', passengers: { adults: 1, children: 0, infants: 0 }, cabin: 'economy' }
const adult: Passenger = { type: 'adult', gender: 'F', firstName: 'Amina', lastName: "N'Diaye-Okafor", dob: '1990-05-04', nationality: 'SN', documentNumber: 'A1234567', documentExpiry: '2030-01-01' }

describe('search validation', () => {
  it('accepts a valid search', () => expect(validateSearch(search, known, today)).toBeNull())
  it('rejects bad routes and dates', () => {
    expect(validateSearch({ ...search, to: 'NBO' }, known, today)).toBe('errSameAirport')
    expect(validateSearch({ ...search, to: 'QQQ' }, known, today)).toBe('errChooseAirport')
    expect(validateSearch({ ...search, departDate: '2026-10-12' }, known, today)).toBe('errDepartDate')
    expect(validateSearch({ ...search, departDate: '' }, known, today)).toBe('errDepartDate')
    expect(validateSearch({ ...search, returnDate: '2026-10-30' }, known, today)).toBe('errReturnDate')
    expect(validateSearch({ ...search, tripType: 'oneway', returnDate: '' }, known, today)).toBeNull()
    expect(validateSearch({ ...search, departDate: '2028-01-01', returnDate: '2028-01-02' }, known, today)).toBe('errTooFar')
  })
})

describe('passenger validation', () => {
  it('accepts a complete adult, including accented and hyphenated names', () => {
    expect(validatePassenger(adult, '2026-11-01', '2026-11-08', today)).toEqual({})
    expect(validatePassenger({ ...adult, firstName: 'Zoë', lastName: 'Ságúa' }, '2026-11-01', '2026-11-08', today)).toEqual({})
  })
  it('flags missing and malformed fields', () => {
    const errors = validatePassenger({ ...adult, firstName: '', lastName: 'B0b', documentNumber: '12', gender: '' }, '2026-11-01', '2026-11-08', today)
    expect(errors).toEqual({ firstName: 'errRequired', lastName: 'errName', documentNumber: 'errDocument', gender: 'errRequired' })
  })
  it('checks ages against the passenger type on the travel date', () => {
    expect(validatePassenger({ ...adult, dob: '2016-01-01' }, '2026-11-01', '2026-11-08', today).dob).toBe('errAdultAge')
    expect(validatePassenger({ ...adult, type: 'child', dob: '2016-01-01' }, '2026-11-01', '2026-11-08', today).dob).toBeUndefined()
    expect(validatePassenger({ ...adult, type: 'child', dob: '2025-01-01' }, '2026-11-01', '2026-11-08', today).dob).toBe('errChildAge')
    expect(validatePassenger({ ...adult, type: 'infant', dob: '2025-01-01' }, '2026-11-01', '2026-11-08', today).dob).toBeUndefined()
    expect(validatePassenger({ ...adult, type: 'infant', dob: '2024-10-01' }, '2026-11-01', '2026-11-08', today).dob).toBe('errInfantAge')
    expect(validatePassenger({ ...adult, dob: '2027-01-01' }, '2026-11-01', '2026-11-08', today).dob).toBe('errDobFuture')
  })
  it('requires the document to outlast the trip', () => {
    expect(validatePassenger({ ...adult, documentExpiry: '2026-11-05' }, '2026-11-01', '2026-11-08', today).documentExpiry).toBe('errExpiry')
  })
})

describe('contact validation', () => {
  it('validates email and phone', () => {
    expect(validateContact({ email: 'a@b.co', phone: '+254 700 000 000' })).toEqual({})
    expect(validateContact({ email: 'nope', phone: '12' })).toEqual({ email: 'errEmail', phone: 'errPhone' })
    expect(validateContact({ email: '', phone: '' })).toEqual({ email: 'errRequired', phone: 'errRequired' })
  })
})
