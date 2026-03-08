export interface FormatDateOptions extends Intl.DateTimeFormatOptions {
  locale?: string;
  timeZone?: string;
}

/**
 * Format a date using Intl.DateTimeFormat with optional timezone support.
 *
 * @param date - input date (Date object, timestamp, or ISO string)
 * @param opts - formatting options
 * @returns formatted date string
 */
export function formatDate(
  date: Date | string | number,
  opts: FormatDateOptions = {}
): string {
  const { locale = 'en-US', timeZone, ...rest } = opts
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  const formatter = new Intl.DateTimeFormat(locale, { timeZone, ...rest })
  
return formatter.format(d)
}

/**
 * Parse an ISO 8601 string and return a Date object.
 */
export function parseISO(isoString: string): Date {
  return new Date(isoString)
}
