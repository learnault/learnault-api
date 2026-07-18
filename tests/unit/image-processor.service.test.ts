import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { ImageProcessor } from '../../src/services/image-processor.service'
import { makePng, makeTextBuffer } from '../helpers'

describe('ImageProcessor', () => {
  const processor = new ImageProcessor()

  it('generates original + small/medium/large variants with correct formats', async () => {
    const input = await makePng(200, 200)

    const result = await processor.process(input)

    expect(result.original.width).toBe(200)
    expect(result.original.height).toBe(200)
    expect(result.original.mimeType).toBe('image/png')

    const variantNames = result.variants.map((v) => v.variant).sort()
    expect(variantNames).toEqual(['large', 'medium', 'original', 'small'])

    const original = result.variants.find((v) => v.variant === 'original')
    const small = result.variants.find((v) => v.variant === 'small')
    const medium = result.variants.find((v) => v.variant === 'medium')
    const large = result.variants.find((v) => v.variant === 'large')
    expect(original?.format).toBe('webp')
    expect(small?.format).toBe('webp')
    expect(medium?.format).toBe('webp')
    expect(large?.format).toBe('png')

    expect(small?.width).toBeLessThanOrEqual(100)
    expect(small?.height).toBeLessThanOrEqual(100)
    expect(medium?.width).toBeLessThanOrEqual(256)
    expect(large?.width).toBeLessThanOrEqual(512)
  })

  it('strips metadata from output variants', async () => {
    const inputWithExif = await sharp({
      create: { width: 32, height: 32, channels: 3, background: 'red' },
    })
      .withExif({
        IFD0: { Make: 'TestCam' },
      })
      .jpeg()
      .toBuffer()

    const result = await processor.process(inputWithExif)
    const originalVariant = result.variants.find((v) => v.variant === 'original')
    const outputMeta = await sharp(originalVariant!.buffer).metadata()
    // EXIF 'Make' must not propagate to the cleaned output.
    expect(JSON.stringify(outputMeta)).not.toContain('TestCam')
    expect(JSON.stringify(outputMeta)).not.toContain('Make')
  })

  it('rejects a text buffer spoofed as image/png (MIME spoofing defense)', async () => {
    const spoofed = makeTextBuffer('pretend this is an avatar')

    await expect(processor.process(spoofed)).rejects.toThrow(
      /not a valid image/i,
    )
  })

  it('preserves the reported source dimensions even after resizing variants', async () => {
    const input = await makePng(180, 90)

    const result = await processor.process(input)

    expect(result.original.width).toBe(180)
    expect(result.original.height).toBe(90)

    const original = result.variants.find((v) => v.variant === 'original')
    expect(original?.buffer.length).toBeGreaterThan(0)
  })
})
