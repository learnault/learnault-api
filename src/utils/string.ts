/**
 * Convert a string to a URL-friendly slug.
 * Removes accents, lowercases, and replaces non-alphanumeric with dashes.
 */
export function slugify(input: string): string {
  // decompose letters, remove diacritics, then clean up
  return input
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // replace non-alphanumeric groups with dash
    .replace(/^-+|-+$/g, '') // trim dashes
}

/**
 * Truncate a string to a maximum length and append an ellipsis if truncated.
 */
export function truncate(
  input: string,
  maxLength: number,
  ellipsis = '...'
): string {
  if (input.length <= maxLength) return input
  
return input.slice(0, maxLength - ellipsis.length) + ellipsis
}
