import { createContext, useContext } from 'react'
import type { Currency } from './data/currencies'
import type { Translation } from './i18n'
import type { RuntimeConfig } from './lib/api'
import type { Language } from './lib/types'

export type AppContextValue = {
  language: Language
  locale: string
  t: Translation
  currency: Currency
  money: (usd: number) => string
  date: (iso: string, style?: 'long' | 'short' | 'numeric') => string
  /** Runtime configuration from the API (/api/config), or static defaults when there is no API. */
  config: RuntimeConfig
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp() {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside AppContext')
  return value
}
