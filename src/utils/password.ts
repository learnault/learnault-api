// bcryptjs, not bcrypt: it's the package actually listed as a runtime
// dependency and already used by the auth/account controllers.
import bcrypt from 'bcryptjs'

// Cost factor is read from env so it can be raised over time (e.g. as
// hardware gets faster) without a code change; existing hashes carry their
// own cost and are upgraded lazily via needsRehash()/currentHashCost().
export function getConfiguredSaltRounds(): number {
  const parsed = parseInt(process.env.BCRYPT_SALT_ROUNDS || '', 10)

  return Number.isInteger(parsed) && parsed >= 10 && parsed <= 15 ? parsed : 12
}

/**
 * Basic strength check: 8+ characters, upper, lower, number, symbol.
 */
export function isStrongPassword(password: string): boolean {
  const minLength = 8
  const hasUpper = /[A-Z]/.test(password)
  const hasLower = /[a-z]/.test(password)
  const hasNumber = /[0-9]/.test(password)
  const hasSymbol = /[^A-Za-z0-9]/.test(password)
  
return (
    password.length >= minLength &&
    hasUpper &&
    hasLower &&
    hasNumber &&
    hasSymbol
  )
}

export async function hashPassword(
  password: string,
  saltRounds = getConfiguredSaltRounds()
): Promise<string> {
  return bcrypt.hash(password, saltRounds)
}

export async function comparePassword(
  password: string,
  hashed: string
): Promise<boolean> {
  return bcrypt.compare(password, hashed)
}

/** Cost factor embedded in a bcrypt hash (`$2b$<cost>$...`), or null if unreadable. */
export function currentHashCost(hashed: string): number | null {
  const match = /^\$2[aby]?\$(\d{2})\$/.exec(hashed)

  return match ? parseInt(match[1], 10) : null
}

/** True when a stored hash was made with a weaker cost than today's config. */
export function needsRehash(hashed: string): boolean {
  const cost = currentHashCost(hashed)

  return cost === null || cost < getConfiguredSaltRounds()
}
