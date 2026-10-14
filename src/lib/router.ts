import { useEffect, useState } from 'react'
import { AIRPORT_BY_CODE } from '../data/airports'
import type { Cabin, SearchParams } from './types'

export type Route = { path: string; params: URLSearchParams }

export function readRoute(): Route {
  const hash = window.location.hash.replace(/^#/, '') || '/'
  const [path, query = ''] = hash.split('?')
  return { path: path || '/', params: new URLSearchParams(query) }
}

export function navigate(to: string, { replace = false } = {}) {
  const url = `#${to}`
  if (window.location.hash === url) return
  if (replace) window.location.replace(url)
  else window.location.hash = to
}

export function useRoute() {
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    const onChange = () => {
      setRoute(readRoute())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

const CABINS: Cabin[] = ['economy', 'premium', 'business', 'first']

export function searchToQuery(search: SearchParams) {
  const params = new URLSearchParams({
    from: search.from,
    to: search.to,
    depart: search.departDate,
    ...(search.tripType === 'round' ? { return: search.returnDate } : {}),
    adults: String(search.passengers.adults),
    children: String(search.passengers.children),
    infants: String(search.passengers.infants),
    cabin: search.cabin,
  })
  return params.toString()
}

/** Parses a shareable /flights URL. Returns null when the URL is incomplete or names unknown airports. */
export function queryToSearch(params: URLSearchParams): SearchParams | null {
  const from = params.get('from')?.toUpperCase() ?? ''
  const to = params.get('to')?.toUpperCase() ?? ''
  const departDate = params.get('depart') ?? ''
  const returnDate = params.get('return') ?? ''
  const count = (key: string, min: number) => Math.max(min, Math.min(9, Number.parseInt(params.get(key) ?? '', 10) || min))
  const adults = count('adults', 1)
  const children = count('children', 0)
  const infants = Math.min(count('infants', 0), adults)
  const cabin = CABINS.includes(params.get('cabin') as Cabin) ? (params.get('cabin') as Cabin) : 'economy'
  if (!AIRPORT_BY_CODE.has(from) || !AIRPORT_BY_CODE.has(to) || !departDate) return null
  if (adults + children + infants > 9) return null
  return {
    tripType: returnDate ? 'round' : 'oneway',
    from, to, departDate,
    returnDate: returnDate || departDate,
    passengers: { adults, children, infants },
    cabin,
  }
}
