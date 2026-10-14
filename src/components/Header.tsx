import { useState } from 'react'
import { ChevronDown, Globe2, Menu, Plane, X } from 'lucide-react'
import { useApp } from '../context'
import { CURRENCIES } from '../data/currencies'
import { navigate } from '../lib/router'
import type { Language } from '../lib/types'

type Props = {
  path: string
  onLanguage: (language: Language) => void
  onCurrency: (code: string) => void
}

export function Header({ path, onLanguage, onCurrency }: Props) {
  const { t, language, currency, config } = useApp()
  const [open, setOpen] = useState(false)
  const go = (to: string) => {
    setOpen(false)
    navigate(to)
  }
  const isActive = (prefix: string) => (prefix === '/' ? path === '/' : path.startsWith(prefix)) ? 'is-active' : ''

  return <header className="site-header">
    <a className="brand" href="#/" aria-label={t.home} onClick={() => setOpen(false)}>
      <span className="brand-mark"><Plane size={19} strokeWidth={2.4} /></span><BrandName name={config.brandName} />
    </a>
    <button className="mobile-menu" onClick={() => setOpen(!open)} aria-label={t.toggleMenu} aria-expanded={open}>{open ? <X /> : <Menu />}</button>
    <nav className={open ? 'is-open' : ''}>
      <button type="button" className={isActive('/')} onClick={() => go('/')}>{t.navFlights}</button>
      {config.features.destinations && <button type="button" className={isActive('/destinations')} onClick={() => go('/destinations')}>{t.navDestinations}</button>}
      {config.features.myTrips && <button type="button" className={isActive('/trips')} onClick={() => go('/trips')}>{t.navTrips}</button>}
      <a href={`mailto:${config.supportEmail}`} onClick={() => setOpen(false)}>{t.navHelp}</a>
    </nav>
    <div className="header-controls">
      <label className="compact-select">
        <Globe2 size={15} aria-hidden="true" /><span className="sr-only">{t.language}</span>
        <select value={language} onChange={(event) => onLanguage(event.target.value as Language)}>
          <option value="en">EN</option><option value="fr">FR</option>
        </select><ChevronDown size={13} aria-hidden="true" />
      </label>
      <label className="compact-select currency-select">
        <span className="sr-only">{t.currency}</span>
        <select value={currency.code} onChange={(event) => onCurrency(event.target.value)}>
          {CURRENCIES.map((item) => <option key={item.code} value={item.code} title={item.label}>{item.code}</option>)}
        </select><ChevronDown size={13} aria-hidden="true" />
      </label>
    </div>
  </header>
}

/** "AfricAir" keeps its two-tone logo; any other BRAND_NAME is shown as plain text. */
export function BrandName({ name }: { name: string }) {
  return name === 'AfricAir' ? <span className="brand-name">Afric<span>Air</span></span> : <span className="brand-name" data-testid="brand-name">{name}</span>
}
