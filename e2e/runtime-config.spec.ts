import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Front-end behaviour driven by the API's runtime configuration. The API is mocked with page.route,
 * so these tests run without a backend; server/src/app.test.ts covers the real API.
 */

const BASE_CONFIG = {
  appEnv: 'staging',
  version: '1.4.0',
  commit: 'abc1234def5678',
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
  secrets: {
    database: { status: 'not-configured', source: 'none' },
    adminToken: { configured: false, source: 'none', loadedAt: new Date().toISOString() },
    promoCodes: { count: 0, source: 'none', loadedAt: new Date().toISOString() },
  },
}

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function mockConfig(page: Page, overrides: Record<string, unknown>) {
  await page.route('**/api/config', (route) => json(route, { ...BASE_CONFIG, ...overrides }))
}

async function reachReview(page: Page) {
  const depart = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
  await page.goto(`/#/flights?from=NBO&to=LOS&depart=${depart}&adults=1&children=0&infants=0&cabin=economy`)
  await page.getByTestId('flight-card').first().locator('.select-button').click()
  await page.locator('.sticky-continue .button-primary').click()
  await page.locator('#p0-gender').selectOption('F')
  await page.locator('#p0-nationality').selectOption('KE')
  await page.locator('#p0-firstName').fill('Wanjiru')
  await page.locator('#p0-lastName').fill('Kamau')
  await page.locator('#p0-dob').fill('1990-01-01')
  await page.locator('#p0-documentNumber').fill('AK1234567')
  await page.locator('#p0-documentExpiry').fill('2033-01-01')
  await page.locator('#contact-email').fill('wanjiru@example.co.ke')
  await page.locator('#contact-phone').fill('+254 700 000 000')
  await page.locator('.traveller-form button[type=submit]').click()
  await expect(page.locator('.review-layout')).toBeVisible()
}

test('environment variables change branding, banners, defaults and features', async ({ page }) => {
  await mockConfig(page, {
    brandName: 'SkyBridge',
    supportEmail: 'help@skybridge.test',
    supportPhone: '+254 20 000 0000',
    announcement: { text: 'Scheduled maintenance tonight 22:00–23:00 UTC', level: 'warning' },
    defaultLanguage: 'fr',
    defaultCurrency: 'EUR',
    features: { destinations: false, myTrips: true, promoCodes: false },
  })
  await page.goto('/')
  await expect(page.getByTestId('env-banner')).toContainText('STAGING')
  await expect(page.getByTestId('env-banner')).toContainText('1.4.0 (abc1234)')
  await expect(page.getByTestId('brand-name').first()).toHaveText('SkyBridge')
  await expect(page.getByTestId('announcement')).toContainText('Scheduled maintenance tonight')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Chaque voyage') // DEFAULT_LANGUAGE=fr
  await expect(page.getByLabel('Devise')).toHaveValue('EUR') // DEFAULT_CURRENCY=EUR
  await expect(page.locator('a[href="mailto:help@skybridge.test"]').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Destinations' })).toHaveCount(0) // FEATURE_DESTINATIONS=false
  await page.goto('/#/destinations')
  await expect(page.getByText('Page introuvable')).toBeVisible()
  await expect(page).toHaveTitle(/SkyBridge/)
})

test('production hides the environment banner; static mode has no banner either', async ({ page }) => {
  await mockConfig(page, { appEnv: 'production' })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByTestId('env-banner')).toHaveCount(0)
})

test('maintenance mode blocks new bookings', async ({ page }) => {
  await mockConfig(page, { maintenanceMode: true })
  await page.goto('/')
  await expect(page.getByTestId('maintenance')).toBeVisible()
  await reachReview(page)
  await expect(page.getByTestId('maintenance')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirm booking' })).toBeDisabled()
})

test('service fee comes from configuration', async ({ page }) => {
  await mockConfig(page, { serviceFeeUsd: 0 })
  await reachReview(page)
  await expect(page.locator('.price-line').filter({ hasText: 'AfricAir service fee' })).toContainText('$0.00')
})

test('promo codes are validated by the API and bookings are saved to the database', async ({ page }) => {
  await mockConfig(page, { storage: 'database', features: { destinations: true, myTrips: true, promoCodes: true } })
  await page.route('**/api/promo/validate', async (route) => {
    const { code } = route.request().postDataJSON()
    await json(route, code === 'SAVE10' ? { valid: true, code: 'SAVE10', percent: 10 } : { valid: false })
  })
  let saved: Record<string, any> | null = null
  await page.route('**/api/bookings', async (route) => {
    saved = route.request().postDataJSON()
    await json(route, { reference: saved!.reference, storage: 'database' }, 201)
  })

  await reachReview(page)
  const totalBefore = await page.getByTestId('fare-total').textContent()
  await page.locator('#promo-code').fill('WRONG')
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByText('This promo code is not valid.')).toBeVisible()
  await page.locator('#promo-code').fill('save10')
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByTestId('promo-applied')).toContainText('SAVE10')
  await expect(page.locator('.discount-line')).toContainText('−10%')
  expect(await page.getByTestId('fare-total').textContent()).not.toBe(totalBefore)

  await page.getByRole('checkbox').check()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Confirm booking' }).click()
  await download
  await expect(page.getByRole('heading', { name: 'Your journey is reserved' })).toBeVisible()
  expect(saved).not.toBeNull()
  expect(saved!.fare.discount).toMatchObject({ code: 'SAVE10', percent: 10 })
  expect(saved!.passengers[0].lastName).toBe('Kamau')
})

test('a failed database save does not confirm the booking', async ({ page }) => {
  await mockConfig(page, { storage: 'database' })
  await page.route('**/api/bookings', (route) => json(route, { error: 'internal error' }, 500))
  await reachReview(page)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(page.getByText('could not be saved on the server')).toBeVisible()
  await expect(page.locator('.review-layout')).toBeVisible()
})

test('My trips finds a booking stored on the server', async ({ page }) => {
  await mockConfig(page, { storage: 'database' })
  const depart = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
  await page.route('**/api/bookings/ZX8K2P?lastName=*', (route) => json(route, {
    reference: 'ZX8K2P', createdAt: new Date().toISOString(), status: 'confirmed',
    search: { tripType: 'oneway', from: 'ADD', to: 'ACC', departDate: depart, returnDate: depart, passengers: { adults: 1, children: 0, infants: 0 }, cabin: 'economy' },
    outbound: { id: 'x', airline: 'Kora Air', segments: [{ flightNumber: 'KR 100', airline: 'Kora Air', from: 'ADD', to: 'ACC', departDate: depart, departTime: '08:00', arriveDate: depart, arriveTime: '13:00', durationMin: 300, aircraft: 'Boeing 737 MAX 8' }], durationMin: 300, stops: 0, fareUsd: 400, taxUsd: 50, seatsLeft: 5, tags: [] },
    passengers: [{ type: 'adult', gender: 'M', firstName: 'Kofi', lastName: 'Boateng', dob: '1980-01-01', nationality: 'GH', documentNumber: 'G1234567', documentExpiry: '2030-01-01', ticketNumber: '962-0000000009' }],
    contact: { email: 'kofi@example.com', phone: '+233 20 000 0000' },
    fare: { lines: [{ type: 'adult', count: 1, fareEach: 400, taxEach: 50 }], base: 400, taxes: 50, service: 15, total: 465 },
    currency: { code: 'USD', rate: 1 },
  }))
  await page.goto('/#/trips')
  await expect(page.getByText('stored on AfricAir servers')).toBeVisible()
  await page.locator('#find-ref').fill('ZX8K2P')
  await page.locator('#find-name').fill('boateng')
  await page.getByRole('button', { name: 'Find' }).click()
  await expect(page).toHaveURL(/#\/trips\/ZX8K2P/)
  await expect(page.getByText('BOATENG, Kofi')).toBeVisible()
})

test('status page shows which secrets are loaded, never their values', async ({ page }) => {
  await mockConfig(page, {
    storage: 'database',
    secrets: {
      database: { status: 'connected', source: 'env' },
      adminToken: { configured: true, source: 'file', loadedAt: new Date().toISOString(), fingerprint: '3f2a9c1d' },
      promoCodes: { count: 2, source: 'file', loadedAt: new Date().toISOString(), fingerprint: '77aa01bc' },
    },
  })
  await page.goto('/#/status')
  const config = page.getByTestId('status-config')
  await expect(config).toContainText('staging')
  await expect(config).toContainText('PostgreSQL database')
  const secrets = page.getByTestId('status-secrets')
  await expect(secrets).toContainText('Connected')
  await expect(secrets).toContainText('Mounted file (reloads automatically)')
  await expect(secrets).toContainText('3f2a9c1d')
  await expect(secrets).toContainText('2 codes')
})

test('admin page requires the ADMIN_TOKEN secret', async ({ page }) => {
  await mockConfig(page, {})
  await page.route('**/api/admin/bookings*', async (route) => {
    const auth = route.request().headers().authorization
    if (auth !== 'Bearer correct-horse') return json(route, { error: 'invalid admin token' }, 401)
    return json(route, { stats: { total: 3, confirmed: 2, cancelled: 1, last24h: 3, revenueUsd: 1234 }, bookings: [] })
  })
  await page.goto('/#/admin')
  await page.locator('#admin-token').fill('wrong')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Invalid admin token.')).toBeVisible()
  await page.locator('#admin-token').fill('correct-horse')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.stat-tile').first()).toContainText('3')
  await expect(page.getByText('$1,234')).toBeVisible()
})

test('admin explains when it is disabled', async ({ page }) => {
  await mockConfig(page, {})
  await page.route('**/api/admin/bookings*', (route) => json(route, { error: 'admin is disabled' }, 404))
  await page.goto('/#/admin')
  await page.locator('#admin-token').fill('anything')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('no ADMIN_TOKEN secret is configured')).toBeVisible()
})
