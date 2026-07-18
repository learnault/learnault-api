import sharp from 'sharp'
import {
  AssetVariantFormat,
  AssetVariantName,
  AVATAR_VARIANTS,
} from '../types/avatar.types'
import { BadRequestError } from '../utils/errors'

export interface VariantSpec {
  variant: AssetVariantName
  format: AssetVariantFormat
  buffer: Buffer
  width: number
  height: number
  sizeBytes: number
  mimeType: string
}

export interface ProcessingResult {
  original: { width: number; height: number; mimeType: string }
  variants: VariantSpec[]
}

export interface ImageVariantConfig {
  name: AssetVariantName
  size: number
  format: AssetVariantFormat
}

interface RenderedVariant {
  buffer: Buffer
  width: number
  height: number
  sizeBytes: number
}

export class ImageProcessor {
  constructor(private readonly variantConfigs: ImageVariantConfig[] = AVATAR_VARIANTS) {}

  /**
   * Validates that the input buffer is a real image (defends against MIME
   * spoofing), strips all metadata/EXIF for privacy, and generates the
   * configured variants. The "original" variant is always emitted as a
   * metadata-stripped webp version of the source image.
   */
  async process(inputBuffer: Buffer): Promise<ProcessingResult> {
    let metadata
    try {
      metadata = await sharp(inputBuffer).metadata()
    } catch {
      throw new BadRequestError('File is not a valid image')
    }

    if (!metadata.format || !metadata.width || !metadata.height) {
      throw new BadRequestError('File is not a valid image')
    }

    const originalWidth = metadata.width
    const originalHeight = metadata.height
    const originalMimeType = `image/${metadata.format}`

    const variants: VariantSpec[] = []
    const originalFormat: AssetVariantFormat = 'webp'
    const originalRendered = await this.renderVariant(inputBuffer, originalFormat, undefined)
    variants.push({
      variant: 'original',
      format: originalFormat,
      buffer: originalRendered.buffer,
      width: originalRendered.width,
      height: originalRendered.height,
      sizeBytes: originalRendered.sizeBytes,
      mimeType: 'image/webp',
    })

    for (const config of this.variantConfigs) {
      const result = await this.renderVariant(inputBuffer, config.format, config.size)
      variants.push({
        variant: config.name,
        format: config.format,
        buffer: result.buffer,
        width: result.width,
        height: result.height,
        sizeBytes: result.sizeBytes,
        mimeType: `image/${config.format}`,
      })
    }

    return {
      original: { width: originalWidth, height: originalHeight, mimeType: originalMimeType },
      variants,
    }
  }

  private async renderVariant(
    inputBuffer: Buffer,
    format: AssetVariantFormat,
    size: number | undefined,
  ): Promise<RenderedVariant> {
    const pipeline = sharp(inputBuffer, { animated: false })
    if (size !== undefined) {
      pipeline.resize(size, size, { fit: 'cover', withoutEnlargement: true })
    }
    if (format === 'webp') {
      pipeline.webp({ quality: 80 })
    } else {
      pipeline.png({ compressionLevel: 9 })
    }
    // Sharp strips EXIF/metadata by default; no withMetadata() call needed.

    const output = await pipeline.toBuffer({ resolveWithObject: true })

    return {
      buffer: output.data,
      width: output.info.width,
      height: output.info.height,
      sizeBytes: output.info.size,
    }
  }
}

export const imageProcessor = new ImageProcessor()
