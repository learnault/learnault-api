/**
 * Format a number as currency using Intl.NumberFormat.
 *
 * @param value - numeric amount
 * @param currency - ISO 4217 currency code (e.g. "USD", "EUR")
 * @param locale - locale string for formatting
 * @param decimals - number of fraction digits to show
 */
export function formatCurrency(
  value: number,
  currency = "USD",
  locale = "en-US",
  decimals = 2
): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return formatter.format(value);
}
