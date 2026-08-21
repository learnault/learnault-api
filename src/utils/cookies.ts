/**
 * Minimal RFC 6265 cookie-header parser.
 *
 * Used to read the optional httpOnly `refresh_token` cookie without pulling in
 * a cookie-parsing dependency. This intentionally handles only the simple
 * `name=value; name2=value2` shape a browser sends — it does not implement
 * cookie attributes (Path/Domain/SameSite/Expires), which never appear on the
 * request side anyway.
 */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}

  if (!header) {
    return cookies
  }

  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) {
      continue
    }

    const name = part.slice(0, separator).trim()
    if (!name) {
      continue
    }

    const value = part.slice(separator + 1).trim()
    try {
      cookies[name] = decodeURIComponent(value)
    } catch {
      cookies[name] = value
    }
  }

  return cookies
}
