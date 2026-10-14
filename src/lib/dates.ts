/** Today's date in the browser's local time zone as YYYY-MM-DD (toISOString would give the UTC date). */
export function todayIso(now = new Date()) {
  return toIso(now)
}

export function toIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function addDays(iso: string, days: number) {
  const [year, month, day] = iso.split('-').map(Number)
  return toIso(new Date(year, month - 1, day + days))
}

export function isValidIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

export function daysBetween(fromIso: string, toIsoDate: string) {
  const [a, b] = [fromIso, toIsoDate].map((iso) => {
    const [year, month, day] = iso.split('-').map(Number)
    return Date.UTC(year, month - 1, day)
  })
  return Math.round((b - a) / 86_400_000)
}

/** Age in whole years on a given date. */
export function ageOn(dobIso: string, onIso: string) {
  const [by, bm, bd] = dobIso.split('-').map(Number)
  const [oy, om, od] = onIso.split('-').map(Number)
  return oy - by - (om < bm || (om === bm && od < bd) ? 1 : 0)
}

const DATE_STYLES: Record<'long' | 'short' | 'numeric', Intl.DateTimeFormatOptions> = {
  long: { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
  short: { weekday: 'short', day: 'numeric', month: 'short' },
  numeric: { day: '2-digit', month: 'short', year: 'numeric' },
}

export function formatDate(iso: string, locale: string, style: keyof typeof DATE_STYLES = 'long') {
  if (!isValidIso(iso)) return '—'
  const [year, month, day] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, DATE_STYLES[style]).format(new Date(year, month - 1, day, 12))
}

export function formatDuration(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}
