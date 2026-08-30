import { z } from 'zod'

export const walletHistoryQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    direction: z.enum(['all', 'incoming', 'outgoing']).default('all'),
  })
  .strict()

export type WalletHistoryQuery = z.infer<typeof walletHistoryQuerySchema>
