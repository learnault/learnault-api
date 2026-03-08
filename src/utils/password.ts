import bcrypt from 'bcrypt'

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
  saltRounds = 10
): Promise<string> {
  return bcrypt.hash(password, saltRounds)
}

export async function comparePassword(
  password: string,
  hashed: string
): Promise<boolean> {
  return bcrypt.compare(password, hashed)
}
