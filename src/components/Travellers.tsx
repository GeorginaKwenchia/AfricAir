import { useMemo } from 'react'
import { ArrowLeft, ArrowRight, CircleAlert, Plane, Route } from 'lucide-react'
import { useApp } from '../context'
import { AIRPORT_BY_CODE, COUNTRY_CODES, countryName } from '../data/airports'
import { addDays, todayIso } from '../lib/dates'
import type { Contact, FareBreakdown, Itinerary, Passenger, SearchParams } from '../lib/types'
import type { ContactErrors, PassengerErrors } from '../lib/validation'
import { JourneyHeading, Progress } from './Shared'

type Props = {
  search: SearchParams
  outbound: Itinerary
  inbound?: Itinerary
  fare: FareBreakdown
  passengers: Passenger[]
  contact: Contact
  passengerErrors: PassengerErrors[]
  contactErrors: ContactErrors
  showErrors: boolean
  onPassenger: (index: number, change: Partial<Passenger>) => void
  onContact: (change: Partial<Contact>) => void
  onBack: () => void
  onSubmit: () => void
}

export function Travellers(props: Props) {
  const { search, outbound, inbound, fare, passengers, contact, passengerErrors, contactErrors, showErrors, onPassenger, onContact, onBack, onSubmit } = props
  const { t, language, money, date } = useApp()
  const today = todayIso()
  const origin = AIRPORT_BY_CODE.get(search.from)
  const destination = AIRPORT_BY_CODE.get(search.to)
  const countries = useMemo(() => COUNTRY_CODES
    .map((code) => ({ code, name: countryName(code, language) }))
    .sort((a, b) => a.name.localeCompare(b.name, language)), [language])
  const hasErrors = showErrors && (passengerErrors.some((errors) => Object.keys(errors).length) || Object.keys(contactErrors).length > 0)

  const field = (index: number, key: keyof Passenger, label: string, input: React.ReactNode, wide = false) => {
    const error = showErrors ? passengerErrors[index]?.[key] : undefined
    return <div className={`form-field ${wide ? 'wide' : ''} ${error ? 'has-error' : ''}`}>
      <label htmlFor={`p${index}-${key}`}>{label} <b>{t.required}</b></label>
      {input}
      {error && <small className="field-error" id={`p${index}-${key}-error`}>{t[error]}</small>}
    </div>
  }
  const inputProps = (index: number, key: keyof Passenger) => ({
    id: `p${index}-${key}`,
    name: `p${index}-${key}`,
    value: passengers[index][key],
    'aria-invalid': showErrors && !!passengerErrors[index]?.[key],
    'aria-describedby': showErrors && passengerErrors[index]?.[key] ? `p${index}-${key}-error` : undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onPassenger(index, { [key]: event.target.value }),
  })

  return <main className="booking-shell narrow-shell">
    <Progress step={2} />
    <JourneyHeading title={t.travellersTitle} subtitle={t.travellersSubtitle} />
    <div className="traveller-layout">
      <form className="traveller-form" noValidate onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
        {passengers.map((passenger, index) => <fieldset key={index}>
          <legend><span>{index + 1}</span>{t[passenger.type]} {passengers.slice(0, index + 1).filter((p) => p.type === passenger.type).length}</legend>
          <div className="field-grid">
            {field(index, 'gender', t.gender, <select {...inputProps(index, 'gender')}>
              <option value="">{t.select}</option><option value="F">{t.female}</option><option value="M">{t.male}</option><option value="X">{t.unspecified}</option>
            </select>)}
            {field(index, 'nationality', t.nationality, <select {...inputProps(index, 'nationality')}>
              <option value="">{t.select}</option>
              {countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
            </select>)}
            {field(index, 'firstName', t.firstName, <input {...inputProps(index, 'firstName')} autoComplete={index === 0 ? 'given-name' : 'off'} />)}
            {field(index, 'lastName', t.lastName, <input {...inputProps(index, 'lastName')} autoComplete={index === 0 ? 'family-name' : 'off'} />)}
            {field(index, 'dob', t.dateOfBirth, <input type="date" {...inputProps(index, 'dob')} max={today} min="1900-01-01" />)}
            {field(index, 'documentNumber', t.documentNumber, <input {...inputProps(index, 'documentNumber')} placeholder="A1234567" autoCapitalize="characters" />)}
            {field(index, 'documentExpiry', t.documentExpiry, <input type="date" {...inputProps(index, 'documentExpiry')} min={addDays(today, 1)} />)}
          </div>
        </fieldset>)}

        <fieldset className="contact-fieldset">
          <legend><span>@</span>{t.contactTitle}</legend>
          <p className="fieldset-hint">{t.contactSubtitle}</p>
          <div className="field-grid">
            {(['email', 'phone'] as const).map((key) => {
              const error = showErrors ? contactErrors[key] : undefined
              return <div className={`form-field ${error ? 'has-error' : ''}`} key={key}>
                <label htmlFor={`contact-${key}`}>{key === 'email' ? t.email : t.phone} <b>{t.required}</b></label>
                <input id={`contact-${key}`} name={`contact-${key}`} type={key === 'email' ? 'email' : 'tel'} autoComplete={key === 'email' ? 'email' : 'tel'}
                  placeholder={key === 'email' ? 'name@example.com' : '+254 700 000 000'} value={contact[key]}
                  aria-invalid={!!error} aria-describedby={error ? `contact-${key}-error` : undefined}
                  onChange={(event) => onContact({ [key]: event.target.value })} />
                {error && <small className="field-error" id={`contact-${key}-error`}>{t[error]}</small>}
              </div>
            })}
          </div>
        </fieldset>

        {hasErrors && <p className="inline-error" role="alert"><CircleAlert size={16} />{t.errFormSummary}</p>}
        <div className="form-actions">
          <button type="button" className="button button-ghost" onClick={onBack}><ArrowLeft size={16} />{t.back}</button>
          <button className="button button-primary" type="submit">{t.saveContinue}<ArrowRight size={16} /></button>
        </div>
      </form>
      <aside className="mini-itinerary">
        <span className="eyebrow"><Route size={14} />{t.itinerary}</span>
        <h3>{origin?.city} <ArrowRight size={17} /> {destination?.city}</h3>
        <p>{date(search.departDate)}{inbound && ` – ${date(search.returnDate)}`}</p>
        {[outbound, inbound].filter((item): item is Itinerary => !!item).map((item) => <div key={item.id}><Plane size={16} /><span>{item.segments[0].from} → {item.segments[item.segments.length - 1].to} · {item.segments[0].departTime}<small>{item.segments.map((segment) => segment.flightNumber).join(' / ')}</small></span></div>)}
        <strong>{money(fare.total)}</strong>
        <small className="mini-note">{t.total} · {passengers.length} {passengers.length === 1 ? t.traveller : t.travellersPlural}</small>
      </aside>
    </div>
  </main>
}
