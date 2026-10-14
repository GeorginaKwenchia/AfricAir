// Builds src/data/airports.json from the OurAirports open dataset (public domain).
// Usage: node scripts/build-airports.mjs [airports.csv] [countries.csv]
// Without arguments the CSVs are downloaded from https://davidmegginson.github.io/ourairports-data/
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const BASE = 'https://davidmegginson.github.io/ourairports-data/'

async function load(path, name) {
  if (path) return readFile(path, 'utf8')
  const response = await fetch(BASE + name)
  if (!response.ok) throw new Error(`Download failed for ${name}: ${response.status}`)
  return response.text()
}

function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const [header, ...body] = rows
  return body.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])))
}

const [airportsPath, countriesPath] = process.argv.slice(2)
const airports = parseCsv(await load(airportsPath, 'airports.csv'))
const countries = parseCsv(await load(countriesPath, 'countries.csv'))

const SIZE = { large_airport: 3, medium_airport: 2, small_airport: 1 }
const byCode = new Map()
for (const a of airports) {
  const iata = a.iata_code?.trim()
  if (!/^[A-Z]{3}$/.test(iata) || a.scheduled_service !== 'yes' || !SIZE[a.type]) continue
  const entry = [iata, a.name.trim(), (a.municipality || a.name).trim(), a.iso_country, +(+a.latitude_deg).toFixed(3), +(+a.longitude_deg).toFixed(3), SIZE[a.type]]
  const existing = byCode.get(iata)
  if (!existing || existing[6] < entry[6]) byCode.set(iata, entry)
}

const list = [...byCode.values()].sort((a, b) => a[3].localeCompare(b[3]) || b[6] - a[6] || a[2].localeCompare(b[2]))
const usedCountries = new Set(list.map((a) => a[3]))
// Every country/territory is kept (even without a scheduled airport) so it can be listed and used as a nationality.
const realCountries = countries.filter((c) => /^[A-Z]{2}$/.test(c.code) && c.code !== 'ZZ' && c.code !== 'XP')
const countryNames = Object.fromEntries(realCountries.map((c) => [c.code, c.name]))
const continents = Object.fromEntries(realCountries.map((c) => [c.code, c.continent]))

await mkdir(new URL('../src/data/', import.meta.url), { recursive: true })
await writeFile(new URL('../src/data/airports.json', import.meta.url), JSON.stringify({
  source: 'OurAirports (https://ourairports.com/data/), public domain',
  fields: ['code', 'name', 'city', 'country', 'lat', 'lon', 'size'],
  countries: countryNames,
  continents,
  airports: list,
}))
console.log(`${list.length} airports in ${usedCountries.size} of ${realCountries.length} countries/territories`)
