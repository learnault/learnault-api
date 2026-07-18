import sharp from 'sharp'
import jwt from 'jsonwebtoken'

export const flushPromises = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0))

export const makeToken = (
  userId: string = 'user-1',
  role: string = 'learner',
  secret: string = process.env.JWT_SECRET ?? 'your_jwt_secret',
): string => jwt.sign({ id: userId, role }, secret, { expiresIn: '1h' })

/**
 * Returns a small PNG buffer of the supplied dimensions. Used to drive
 * ImageProcessor and AvatarUploadService tests without committing any
 * binary fixtures to the repo.
 */
export const makePng = async (width: number = 32, height: number = 32): Promise<Buffer> => {
  const raw = Buffer.alloc(width * height * 3, 0)
  for (let i = 0; i < raw.length; i += 3) {
    raw[i] = (i % 256)
    raw[i + 1] = ((i + 80) % 256)
    raw[i + 2] = ((i + 160) % 256)
  }

  return sharp(raw, {
    raw: { width, height, channels: 3 },
  })
    .png()
    .toBuffer()
}

export const makeTextBuffer = (text: string = 'this is not an image'): Buffer => {
  return Buffer.from(text, 'utf8')
}
