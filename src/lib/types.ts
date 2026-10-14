export type Language = 'en' | 'fr'
export type Cabin = 'economy' | 'premium' | 'business' | 'first'
export type TripType = 'round' | 'oneway'
export type PassengerType = 'adult' | 'child' | 'infant'
export type PassengerCounts = { adults: number; children: number; infants: number }

export type SearchParams = {
  tripType: TripType
  from: string
  to: string
  departDate: string // YYYY-MM-DD
  returnDate: string // YYYY-MM-DD, ignored for one-way
  passengers: PassengerCounts
  cabin: Cabin
}

export type Segment = {
  flightNumber: string
  airline: string
  from: string
  to: string
  departDate: string
  departTime: string
  arriveDate: string
  arriveTime: string
  durationMin: number
  aircraft: string
}

export type Itinerary = {
  id: string
  airline: string
  segments: Segment[]
  durationMin: number
  stops: number
  /** Base fare for one adult, in USD. */
  fareUsd: number
  /** Taxes and carrier charges per paying traveller, in USD. */
  taxUsd: number
  seatsLeft: number
  tags: ('cheapest' | 'fastest' | 'best')[]
}

export type Passenger = {
  type: PassengerType
  gender: '' | 'F' | 'M' | 'X'
  firstName: string
  lastName: string
  dob: string
  nationality: string
  documentNumber: string
  documentExpiry: string
}

export type Contact = { email: string; phone: string }

export type FareLine = { type: PassengerType; count: number; fareEach: number; taxEach: number }
export type FareDiscount = { code: string; percent: number; amountUsd: number }
export type FareBreakdown = { lines: FareLine[]; base: number; taxes: number; service: number; discount?: FareDiscount; total: number }

export type Booking = {
  reference: string
  createdAt: string
  status: 'confirmed' | 'cancelled'
  search: SearchParams
  outbound: Itinerary
  inbound?: Itinerary
  passengers: (Passenger & { ticketNumber: string })[]
  contact: Contact
  fare: FareBreakdown
  currency: { code: string; rate: number }
}
