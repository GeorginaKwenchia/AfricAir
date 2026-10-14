import type { Booking } from './types'

/**
 * Client for the optional AfricAir API (server/). The site still works as a purely static
 * deployment: when /api is missing, every call falls back to browser-only behaviour.
 */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api'

type SecretStatus = { configured?: boolean; count?: number; source: 'file' | 'env' | 'none'; loadedAt?: string; error?: string; fingerprint?: string | null }

export type RuntimeConfig = {
  available: boolean
  appEnv: string
  version: string
  commit: string
  brandName: string
  supportEmail: string
  supportPhone: string | null
  announcement: { text: string; level: 'info' | 'warning' | 'critical' } | null
  defaultLanguage: 'en' | 'fr' | null
  defaultCurrency: string | null
  serviceFeeUsd: number
  maintenanceMode: boolean
  features: { destinations: boolean; myTrips: boolean; promoCodes: boolean }
  storage: 'database' | 'browser'
  secrets: {
    database: { status: 'connected' | 'error' | 'not-configured'; source: string }
    adminToken: SecretStatus
    promoCodes: SecretStatus
  } | null
}

export const DEFAULT_CONFIG: RuntimeConfig = {
  available: false,
  appEnv: 'static',
  version: 'static',
  commit: 'unknown',
  brandName: 'AfricAir',
  supportEmail: 'support@africair.example',
  supportPhone: null,
  announcement: null,
  defaultLanguage: null,
  defaultCurrency: null,
  serviceFeeUsd: 15,
  maintenanceMode: false,
  features: { destinations: true, myTrips: true, promoCodes: false },
  storage: 'browser',
  secrets: null,
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 8000): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new ApiError(0, (error as Error).message || 'network error')
  }
  const isJson = response.headers.get('content-type')?.includes('application/json')
  const body = isJson ? await response.json().catch(() => null) : null
  if (!response.ok || !isJson) throw new ApiError(response.status, (body as { error?: string } | null)?.error ?? `HTTP ${response.status}`)
  return body as T
}

export async function fetchConfig(): Promise<RuntimeConfig> {
  try {
    const config = await request<Omit<RuntimeConfig, 'available'>>('/config', {}, 3000)
    return { ...DEFAULT_CONFIG, ...config, features: { ...DEFAULT_CONFIG.features, ...config.features }, available: true }
  } catch {
    return DEFAULT_CONFIG
  }
}

export const validatePromo = (code: string) =>
  request<{ valid: boolean; code?: string; percent?: number }>('/promo/validate', { method: 'POST', body: JSON.stringify({ code }) })

export const saveRemoteBooking = (booking: Booking) =>
  request<{ reference: string }>('/bookings', { method: 'POST', body: JSON.stringify(booking) })

export const findRemoteBooking = (reference: string, lastName: string) =>
  request<Booking>(`/bookings/${encodeURIComponent(reference)}?lastName=${encodeURIComponent(lastName)}`)

export const cancelRemoteBooking = (reference: string, lastName: string) =>
  request<Booking>(`/bookings/${encodeURIComponent(reference)}/cancel`, { method: 'POST', body: JSON.stringify({ lastName }) })

export type AdminData = {
  stats: { total: number; confirmed: number; cancelled: number; last24h: number; revenueUsd: number }
  bookings: Booking[]
}

export const fetchAdminBookings = (token: string) =>
  request<AdminData>('/admin/bookings?limit=100', { headers: { Authorization: `Bearer ${token}` } })
