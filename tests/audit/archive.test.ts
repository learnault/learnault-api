import { describe, it, expect, vi } from 'vitest'
import {
  ARCHIVABLE_MODELS,
  activeOnly,
  archivePatch,
  archivedOnly,
  archivedPurgeCutoff,
  archiveExclusionExtension,
  assertActive,
  excludeArchivedFromReads,
  includeArchived,
  isArchived,
  mentionsArchivedAt,
  restorePatch,
} from '../../src/audit/archive'

/** Run the interceptor and return the args it forwarded to the actual query. */
async function forwardedArgs(
  model: string | undefined,
  operation: string,
  args: unknown
): Promise<Record<string, unknown>> {
  const query = vi.fn().mockResolvedValue(null)
  await excludeArchivedFromReads({ model, operation, args, query })

  return query.mock.calls[0][0] as Record<string, unknown>
}

describe('archive semantics', () => {
  describe('ARCHIVABLE_MODELS', () => {
    it('is derived from the lifecycle matrix, not a second hand-kept list', () => {
      expect([...ARCHIVABLE_MODELS].sort()).toEqual([
        'Avatar',
        'LearnerProfile',
        'Module',
        'ReferralCode',
        'WebhookEndpoint',
      ])
    })
  })

  describe('extension wiring', () => {
    it('registers the tested interceptor for every model and operation', () => {
      // Without this, the extension object could drift from the function the
      // rest of this file exercises and nothing would fail.
      expect(archiveExclusionExtension).toMatchObject({
        name: 'archiveExclusion',
        query: { $allModels: { $allOperations: excludeArchivedFromReads } },
      })
    })
  })

  describe('default exclusion', () => {
    it('hides archived rows from findMany on an archivable model', async () => {
      expect(await forwardedArgs('Module', 'findMany', { where: { category: 'stellar' } })).toEqual(
        { where: { category: 'stellar', archivedAt: null } }
      )
    })

    it('adds the filter when there is no where clause at all', async () => {
      expect(await forwardedArgs('Module', 'findMany', {})).toEqual({
        where: { archivedAt: null },
      })
    })

    it('adds the filter when args are absent entirely', async () => {
      expect(await forwardedArgs('Module', 'findMany', undefined)).toEqual({
        where: { archivedAt: null },
      })
    })

    it.each(['findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy'])(
      'filters %s',
      async (operation) => {
        const args = await forwardedArgs('Module', operation, {})

        expect(args.where).toEqual({ archivedAt: null })
      }
    )

    it('preserves other arguments while injecting the filter', async () => {
      const args = await forwardedArgs('Module', 'findMany', {
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true },
      })

      expect(args).toEqual({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true },
        where: { archivedAt: null },
      })
    })
  })

  describe('exemptions', () => {
    it('leaves non-archivable models alone', async () => {
      // Injecting archivedAt here would reference a column that does not exist.
      expect(await forwardedArgs('User', 'findMany', { where: { status: 'ACTIVE' } })).toEqual({
        where: { status: 'ACTIVE' },
      })
    })

    it('leaves findUnique alone, so a point lookup by id still resolves', async () => {
      // A silent filter here would turn a found row into null and read as
      // "deleted" to code that has the id in hand.
      expect(await forwardedArgs('Module', 'findUnique', { where: { id: 'm-1' } })).toEqual({
        where: { id: 'm-1' },
      })
    })

    it('leaves writes alone, so archive and restore can see their own row', async () => {
      for (const operation of ['update', 'updateMany', 'delete', 'deleteMany', 'upsert']) {
        expect(await forwardedArgs('Module', operation, { where: { id: 'm-1' } })).toEqual({
          where: { id: 'm-1' },
        })
      }
    })

    it('leaves raw and model-less operations alone', async () => {
      expect(await forwardedArgs(undefined, 'findMany', { where: { id: 'x' } })).toEqual({
        where: { id: 'x' },
      })
    })

    it('stands down when the caller filters on archivedAt explicitly', async () => {
      expect(
        await forwardedArgs('Module', 'findMany', { where: { archivedAt: { not: null } } })
      ).toEqual({ where: { archivedAt: { not: null } } })
    })

    it('stands down for includeArchived, which opts out by naming the key', async () => {
      const args = await forwardedArgs('Module', 'findMany', {
        where: includeArchived({ category: 'stellar' }),
      })

      // Prisma ignores an undefined filter, so this reads both live and
      // archived rows — and the opt-out is visible at the call site.
      expect(args.where).toEqual({ category: 'stellar', archivedAt: undefined })
    })

    it('stands down when archivedAt appears inside a combinator', async () => {
      const where = { OR: [{ archivedAt: null }, { archivedAt: { gt: new Date(0) } }] }

      expect(await forwardedArgs('Module', 'findMany', { where })).toEqual({ where })
    })
  })

  describe('mentionsArchivedAt', () => {
    it('detects the key at the top level', () => {
      expect(mentionsArchivedAt({ archivedAt: null })).toBe(true)
    })

    it('detects the key set to undefined, which is how opting out works', () => {
      expect(mentionsArchivedAt({ archivedAt: undefined })).toBe(true)
    })

    it.each(['AND', 'OR', 'NOT'])('detects the key nested under %s', (combinator) => {
      expect(mentionsArchivedAt({ [combinator]: [{ archivedAt: null }] })).toBe(true)
      expect(mentionsArchivedAt({ [combinator]: { archivedAt: null } })).toBe(true)
    })

    it('returns false for an unrelated clause', () => {
      expect(mentionsArchivedAt({ status: 'ACTIVE', AND: [{ title: 'x' }] })).toBe(false)
    })

    it('returns false for empty and non-object input', () => {
      expect(mentionsArchivedAt(undefined)).toBe(false)
      expect(mentionsArchivedAt(null)).toBe(false)
      expect(mentionsArchivedAt('archivedAt')).toBe(false)
    })
  })

  describe('scope helpers', () => {
    it('activeOnly restricts to live rows', () => {
      expect(activeOnly({ category: 'stellar' })).toEqual({
        category: 'stellar',
        archivedAt: null,
      })
    })

    it('archivedOnly restricts to archived rows', () => {
      expect(archivedOnly({ category: 'stellar' })).toEqual({
        category: 'stellar',
        archivedAt: { not: null },
      })
    })

    it('works with no base clause', () => {
      expect(activeOnly()).toEqual({ archivedAt: null })
      expect(archivedOnly()).toEqual({ archivedAt: { not: null } })
      expect(includeArchived()).toEqual({ archivedAt: undefined })
    })

    it('does not mutate the clause it was given', () => {
      const where = { category: 'stellar' }
      activeOnly(where)

      expect(where).toEqual({ category: 'stellar' })
    })
  })

  describe('patches', () => {
    it('archivePatch stamps time, actor and reason', () => {
      const now = new Date('2026-08-24T12:00:00.000Z')

      expect(archivePatch('withdrawn by author', 'admin-1', now)).toEqual({
        archivedAt: now,
        archivedById: 'admin-1',
        archivedReason: 'withdrawn by author',
      })
    })

    it('archivePatch tolerates a missing actor for system archives', () => {
      expect(archivePatch('retention sweep').archivedById).toBeNull()
    })

    it('restorePatch clears all three columns', () => {
      // Leaving a stale reason behind would make a live row look archived to
      // anyone reading the columns rather than the timestamp.
      expect(restorePatch()).toEqual({
        archivedAt: null,
        archivedById: null,
        archivedReason: null,
      })
    })
  })

  describe('record inspection', () => {
    it('isArchived reads the timestamp', () => {
      expect(isArchived({ archivedAt: new Date() })).toBe(true)
      expect(isArchived({ archivedAt: null })).toBe(false)
      expect(isArchived({})).toBe(false)
      expect(isArchived(null)).toBe(false)
    })

    it('assertActive passes a live record through', () => {
      const live = { id: 'm-1', archivedAt: null }

      expect(assertActive(live)).toBe(live)
    })

    it('assertActive nulls an archived record', () => {
      expect(assertActive({ id: 'm-1', archivedAt: new Date() })).toBeNull()
      expect(assertActive(null)).toBeNull()
    })
  })

  describe('archivedPurgeCutoff', () => {
    it('subtracts the retention window', () => {
      expect(
        archivedPurgeCutoff(365, new Date('2026-08-24T00:00:00.000Z'))?.toISOString()
      ).toBe('2025-08-24T00:00:00.000Z')
    })

    it('returns null for indefinite retention', () => {
      expect(archivedPurgeCutoff(null)).toBeNull()
    })
  })
})
