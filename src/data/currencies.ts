/** Indicative exchange rates against USD. Fares are priced in USD and converted for display only. */
export type Currency = { code: string; label: string; rate: number }

export const CURRENCIES: Currency[] = [
  { code: 'USD', label: 'US Dollar', rate: 1 },
  { code: 'EUR', label: 'Euro', rate: 0.92 },
  { code: 'GBP', label: 'British Pound', rate: 0.79 },
  { code: 'CHF', label: 'Swiss Franc', rate: 0.88 },
  { code: 'CAD', label: 'Canadian Dollar', rate: 1.36 },
  { code: 'AUD', label: 'Australian Dollar', rate: 1.52 },
  { code: 'JPY', label: 'Japanese Yen', rate: 150 },
  { code: 'CNY', label: 'Chinese Yuan', rate: 7.2 },
  { code: 'INR', label: 'Indian Rupee', rate: 83.5 },
  { code: 'BRL', label: 'Brazilian Real', rate: 5.4 },
  { code: 'AED', label: 'UAE Dirham', rate: 3.67 },
  { code: 'SAR', label: 'Saudi Riyal', rate: 3.75 },
  { code: 'TRY', label: 'Turkish Lira', rate: 34 },
  { code: 'ZAR', label: 'South African Rand', rate: 18.25 },
  { code: 'NGN', label: 'Nigerian Naira', rate: 1540 },
  { code: 'KES', label: 'Kenyan Shilling', rate: 130 },
  { code: 'GHS', label: 'Ghanaian Cedi', rate: 15.6 },
  { code: 'EGP', label: 'Egyptian Pound', rate: 50.4 },
  { code: 'MAD', label: 'Moroccan Dirham', rate: 10.1 },
  { code: 'TND', label: 'Tunisian Dinar', rate: 3.12 },
  { code: 'DZD', label: 'Algerian Dinar', rate: 134 },
  { code: 'XOF', label: 'West African CFA franc', rate: 604 },
  { code: 'XAF', label: 'Central African CFA franc', rate: 604 },
  { code: 'RWF', label: 'Rwandan Franc', rate: 1320 },
  { code: 'UGX', label: 'Ugandan Shilling', rate: 3760 },
  { code: 'TZS', label: 'Tanzanian Shilling', rate: 2510 },
  { code: 'ETB', label: 'Ethiopian Birr', rate: 124 },
  { code: 'ZMW', label: 'Zambian Kwacha', rate: 27.5 },
  { code: 'BWP', label: 'Botswana Pula', rate: 13.6 },
  { code: 'NAD', label: 'Namibian Dollar', rate: 18.2 },
  { code: 'MUR', label: 'Mauritian Rupee', rate: 46 },
  { code: 'SCR', label: 'Seychellois Rupee', rate: 13.5 },
  { code: 'AOA', label: 'Angolan Kwanza', rate: 910 },
  { code: 'MZN', label: 'Mozambican Metical', rate: 64 },
  { code: 'CDF', label: 'Congolese Franc', rate: 2850 },
]

export const findCurrency = (code: string) => CURRENCIES.find((currency) => currency.code === code) ?? CURRENCIES[0]

/** Formats a USD amount in the target currency. `codeOnly` avoids symbols (used for the PDF, whose fonts lack e.g. ₦). */
export function formatMoney(amountUsd: number, currency: Currency, locale: string, codeOnly = false) {
  const digits = ['JPY', 'XOF', 'XAF', 'RWF', 'UGX'].includes(currency.code) ? 0 : 2
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.code,
    currencyDisplay: codeOnly ? 'code' : 'symbol',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amountUsd * currency.rate)
}
