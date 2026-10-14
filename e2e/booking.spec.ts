import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function pickAirport(page: Page, name: 'from' | 'to', query: string, code: string) {
  const input = page.locator(`input[name="${name}"]`)
  await input.click()
  await input.pressSequentially(query, { delay: 20 })
  await page.getByRole('option').filter({ hasText: code }).first().click()
  await expect(input).toHaveValue(new RegExp(`\\(${code}\\)`))
}

async function fillTraveller(page: Page, index: number, data: { gender: string; first: string; last: string; dob: string; nationality: string; doc: string }) {
  await page.locator(`#p${index}-gender`).selectOption(data.gender)
  await page.locator(`#p${index}-nationality`).selectOption(data.nationality)
  // Typed character by character: the form must keep focus between keystrokes.
  await page.locator(`#p${index}-firstName`).pressSequentially(data.first, { delay: 10 })
  await page.locator(`#p${index}-lastName`).pressSequentially(data.last, { delay: 10 })
  await page.locator(`#p${index}-dob`).fill(data.dob)
  await page.locator(`#p${index}-documentNumber`).pressSequentially(data.doc, { delay: 10 })
  await page.locator(`#p${index}-documentExpiry`).fill('2032-05-01')
}

test('complete round-trip booking with mixed travellers, PDF and My trips', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    // Without the API (static mode) the /api/config probe fails by design; anything else is a real error.
    if (message.type() === 'error' && !message.location().url.includes('/api/')) errors.push(message.text())
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Every journey')

  // Worldwide airport search, including accent-insensitive and country-name matches.
  await pickAirport(page, 'from', 'yaounde', 'NSI')
  await pickAirport(page, 'to', 'Brazil', 'GRU')

  // Travellers: 2 adults, 1 child, 1 infant.
  await page.getByRole('button', { name: /1 traveller/ }).click()
  await page.getByRole('button', { name: '+ Adults' }).click()
  await page.getByRole('button', { name: '+ Children' }).click()
  await page.getByRole('button', { name: '+ Infants' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  await page.locator('select[name="cabin"]').selectOption('business')
  await page.getByRole('button', { name: 'Search flights' }).click()

  await expect(page).toHaveURL(/#\/flights\?from=NSI&to=GRU/)
  await expect(page.getByRole('heading', { name: 'Choose your flights' })).toBeVisible()
  const continueButton = page.getByRole('button', { name: 'Continue' })
  await expect(continueButton).toBeDisabled()

  const cards = page.getByTestId('flight-card')
  expect(await cards.count()).toBeGreaterThanOrEqual(4)
  await cards.first().getByRole('button', { name: 'Flight details' }).click()
  await expect(cards.first().locator('.segment-timeline')).toBeVisible()

  // Select outbound (first list) and return (after the Return heading).
  await cards.first().getByRole('button', { name: 'Select' }).click()
  await expect(continueButton).toBeDisabled()
  const returnCards = page.locator('.return-leg ~ [data-testid="flight-card"]')
  await returnCards.first().getByRole('button', { name: 'Select' }).click()
  await expect(continueButton).toBeEnabled()
  await continueButton.click()

  await expect(page.getByRole('heading', { name: 'Traveller details' })).toBeVisible()
  // Submitting empty shows field errors and stays on the page.
  await page.getByRole('button', { name: 'Review booking' }).click()
  await expect(page.getByText('Please correct the highlighted fields.')).toBeVisible()
  await expect(page).toHaveURL(/#\/travellers/)

  await fillTraveller(page, 0, { gender: 'F', first: 'Zoë', last: 'Mbarga', dob: '1988-02-03', nationality: 'CM', doc: 'CM1234567' })
  await fillTraveller(page, 1, { gender: 'M', first: 'Paul', last: 'Mbarga', dob: '1985-07-09', nationality: 'CM', doc: 'CM7654321' })
  // Wrong age for a child is rejected, then corrected.
  await fillTraveller(page, 2, { gender: 'F', first: 'Ana', last: 'Mbarga', dob: '2000-01-01', nationality: 'CM', doc: 'CM7654322' })
  await fillTraveller(page, 3, { gender: 'M', first: 'Léo', last: 'Mbarga', dob: '2026-01-15', nationality: 'CM', doc: 'CM7654323' })
  await page.locator('#contact-email').pressSequentially('zoe@example.com', { delay: 10 })
  await page.locator('#contact-phone').pressSequentially('+237 600 000 000', { delay: 10 })
  await page.getByRole('button', { name: 'Review booking' }).click()
  await expect(page.getByText('Children must be 2–11 years old')).toBeVisible()
  await page.locator('#p2-dob').fill('2018-04-04')
  await page.getByRole('button', { name: 'Review booking' }).click()

  await expect(page.getByRole('heading', { name: 'Review your journey' })).toBeVisible()
  await expect(page.getByText('MBARGA, Zoë')).toBeVisible()
  await expect(page.locator('.fare-line')).toHaveCount(3)

  // Reload keeps the in-progress booking (session draft).
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Review your journey' })).toBeVisible()

  await page.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(page.getByText('Please confirm the traveller details first.')).toBeVisible()
  await page.getByRole('checkbox').check()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Confirm booking' }).click()
  const download = await downloadPromise
  await expect(page.getByRole('heading', { name: 'Your journey is reserved' })).toBeVisible()
  const reference = (await page.getByTestId('booking-reference').textContent())!.trim()
  expect(reference).toMatch(/^[A-Z2-9]{6}$/)
  expect(download.suggestedFilename()).toBe(`AfricAir-${reference}.pdf`)
  const pdf = readFileSync(await download.path())
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  await expect(page.getByText('PDF downloaded')).toBeVisible()

  // Download again from the confirmation page.
  const again = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PDF itinerary' }).click()
  expect((await again).suggestedFilename()).toBe(`AfricAir-${reference}.pdf`)

  // My trips: listed, findable by reference + surname, cancellable.
  await page.goto('/#/trips')
  await expect(page.locator('.trip-card')).toContainText(reference)
  await page.locator('#find-ref').fill(reference)
  await page.locator('#find-name').fill('mbarga')
  await page.getByRole('button', { name: 'Find' }).click()
  await expect(page).toHaveURL(new RegExp(`#/trips/${reference}`))
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Cancel booking' }).click()
  await expect(page.getByText('This booking has been cancelled.')).toBeVisible()
  const cancelledPdf = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PDF itinerary' }).click()
  expect((await cancelledPdf).suggestedFilename()).toBe(`AfricAir-${reference}-cancelled.pdf`)

  // Unknown lookups fail gracefully.
  await page.goto('/#/trips')
  await page.locator('#find-ref').fill('ZZZZZZ')
  await page.locator('#find-name').fill('nobody')
  await page.getByRole('button', { name: 'Find' }).click()
  await expect(page.getByText('No booking matches')).toBeVisible()

  expect(errors).toEqual([])
})

test('one-way booking in French with currency switch', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Currency').selectOption('XOF')
  await page.getByLabel('Language').selectOption('fr')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Chaque voyage')
  await page.getByRole('radio', { name: 'Aller simple' }).click()
  await expect(page.locator('input[name="return"]')).toHaveCount(0)
  await pickAirport(page, 'from', 'Dakar', 'DSS')
  await pickAirport(page, 'to', 'Abidjan', 'ABJ')
  await page.getByRole('button', { name: 'Rechercher' }).click()
  await expect(page.getByRole('heading', { name: 'Choisissez vos vols' })).toBeVisible()
  await expect(page.locator('.price-cell strong').first()).toContainText('F CFA')

  // Sort and filter.
  await page.getByLabel('Trier par').selectOption('cheapest')
  const prices = await page.locator('[data-testid="flight-card"] .price-cell strong').allTextContents()
  const values = prices.map((text) => Number(text.replace(/\D/g, '')))
  expect([...values].sort((a, b) => a - b)).toEqual(values)
  await page.getByLabel('Sans escale').check()
  for (const label of await page.locator('[data-testid="flight-card"] .route-line b').allTextContents()) expect(label).toContain('Sans escale')

  await page.getByTestId('flight-card').first().getByRole('button', { name: 'Choisir' }).click()
  await page.getByRole('button', { name: 'Continuer' }).click()
  await fillTraveller(page, 0, { gender: 'X', first: 'Awa', last: 'Diop', dob: '1995-03-03', nationality: 'SN', doc: 'SN998877' })
  await page.locator('#contact-email').fill('awa@example.sn')
  await page.locator('#contact-phone').fill('+221 77 000 00 00')
  await page.getByRole('button', { name: 'Vérifier la réservation' }).click()
  await page.getByRole('checkbox').check()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Confirmer la réservation' }).click()
  await download
  await expect(page.getByRole('heading', { name: 'Votre voyage est réservé' })).toBeVisible()
})

test('search validation, swap, destinations and shareable URLs', async ({ page }) => {
  await page.goto('/')
  await pickAirport(page, 'from', 'NBO', 'NBO')
  await pickAirport(page, 'to', 'nairobi', 'NBO')
  await page.getByRole('button', { name: 'Search flights' }).click()
  await expect(page.getByText('Choose two different airports.')).toBeVisible()

  await pickAirport(page, 'to', 'Monaco', 'NCE')
  await expect(page.getByText('Nearest airport for Monaco').first()).toBeHidden()
  await page.getByRole('button', { name: 'Swap origin and destination' }).click()
  await expect(page.locator('input[name="from"]')).toHaveValue(/NCE/)

  await page.goto('/#/destinations')
  await expect(page.locator('.country-card')).toHaveCount(247)
  await page.getByPlaceholder('Filter by country, city or airport code').fill('Eswatini')
  await expect(page.locator('.country-card')).toHaveCount(1)
  await expect(page.locator('.country-card')).toHaveAttribute('open', '') // small matches open automatically
  await page.getByRole('button', { name: /Fly here:/ }).first().click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.locator('input[name="to"]')).toHaveValue(/SHO/)

  // Deep link straight to results; bad links bounce home; guarded steps redirect.
  const inAMonth = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
  await page.goto(`/#/flights?from=CAI&to=JNB&depart=${inAMonth}&adults=1&children=0&infants=0&cabin=economy`)
  await expect(page.getByTestId('flight-card').first()).toBeVisible()
  await page.goto(`/#/flights?from=XXX&to=JNB&depart=${inAMonth}`)
  await expect(page).toHaveURL(/#\/$/)
  await page.goto('/#/review')
  await expect(page).toHaveURL(/#\/flights/)
  await page.goto('/#/nope')
  await expect(page.getByText('Page not found')).toBeVisible()
})
