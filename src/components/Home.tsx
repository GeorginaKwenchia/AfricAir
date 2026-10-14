import { CheckCircle2, Globe2, MapPin, Plane, ShieldCheck, Sparkles, Star } from 'lucide-react'
import { useApp } from '../context'
import { AIRPORTS, COUNTRY_CODES } from '../data/airports'
import { navigate } from '../lib/router'
import type { SearchParams } from '../lib/types'
import { MaintenanceNotice } from './Runtime'
import { SearchForm } from './SearchForm'

type Props = { search: SearchParams; onChange: (search: SearchParams) => void; onSubmit: () => void; error: string }

export function Home({ search, onChange, onSubmit, error }: Props) {
  const { t, language, config } = useApp()
  const airports = AIRPORTS.length.toLocaleString(language)
  const countries = String(COUNTRY_CODES.length)
  return <main>
    <section className="hero">
      <div className="hero-copy">
        <span className="eyebrow light"><Sparkles size={14} />{t.flyAfrica}</span>
        <h1>{t.heroTitle}</h1>
        <p>{t.heroText}</p>
        <div className="hero-trust"><span><ShieldCheck size={17} />{t.support}</span><span><CheckCircle2 size={17} />{t.clearPrices}</span></div>
      </div>
      <div className="hero-art" aria-hidden="true">
        <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="sun" /><div className="continent-shape" />
        <div className="plane-trail"><Plane size={28} /></div>
        <div className="place-marker marker-a"><MapPin size={15} /></div><div className="place-marker marker-b"><MapPin size={15} /></div>
      </div>
    </section>
    <div className="search-wrap">
      {config.maintenanceMode && <MaintenanceNotice />}
      <SearchForm value={search} onChange={onChange} onSubmit={onSubmit} error={error} />
      <p className="search-note"><MapPin size={15} />{t.routeHint(airports, countries)}</p>
    </div>
    <section className="benefit-strip" id="discover">
      <div className="benefit-title"><span className="eyebrow"><Sparkles size={14} />AFRICAIR</span><h2>{t.whyTitle}</h2></div>
      <article><span className="benefit-icon"><Star size={19} /></span><div><strong>{t.benefitFares}</strong><p>{t.benefitFaresCopy}</p></div></article>
      <article><span className="benefit-icon"><Globe2 size={19} /></span><div><strong>{t.benefitCoverage}</strong><p>{t.benefitCoverageCopy(countries)}</p></div></article>
      <article><span className="benefit-icon"><Globe2 size={19} /></span><div><strong>{t.benefitBilingual}</strong><p>{t.benefitBilingualCopy}</p></div></article>
    </section>
    <section className="lower-banner">
      <div>
        <span className="eyebrow light"><Plane size={14} />AFRICAIR NETWORK</span>
        <h2>{t.lowerTitle}</h2><p>{t.lowerText}</p>
        {config.features.destinations && <button className="button button-primary banner-button" onClick={() => navigate('/destinations')}>{t.exploreDestinations}</button>}
      </div>
      <div className="route-marks"><span>CAI</span><i /><span>NBO</span><i /><span>LOS</span><i /><span>CPT</span></div>
    </section>
  </main>
}
