import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  Retention,
  lifecycleRuleFor,
  lifecycleRules,
  modelsInClass,
  recordClassFor,
  requiresAudit,
  retentionCutoff,
} from '../../src/audit/classification'
import { DataCategory, ErasureAction, RecordClass } from '../../src/audit/types'

/** Model names declared in prisma/schema.prisma. */
function schemaModels(): string[] {
  const schema = readFileSync(
    join(process.cwd(), 'prisma', 'schema.prisma'),
    'utf8',
  )
  const matches = schema.matchAll(/^model\s+(\w+)\s*\{/gm)

  return [...matches].map((match) => match[1])
}

describe('lifecycle classification', () => {
  describe('coverage', () => {
    it('classifies every model in the Prisma schema', () => {
      const unclassified = schemaModels().filter(
        (model) => !lifecycleRuleFor(model),
      )

      // A model with no rule has no retention, no erasure behaviour and no
      // audit requirement. Add it to src/audit/classification.ts and document
      // it in docs/DATA_LIFECYCLE.md.
      expect(unclassified).toEqual([])
    })

    it('does not classify models that no longer exist in the schema', () => {
      const models = new Set(schemaModels())
      const stale = lifecycleRules()
        .map((rule) => rule.model)
        .filter((model) => !models.has(model))

      expect(stale).toEqual([])
    })

    it('assigns each model exactly one rule', () => {
      const seen = new Set<string>()
      const duplicates: string[] = []

      for (const rule of lifecycleRules()) {
        if (seen.has(rule.model)) duplicates.push(rule.model)
        seen.add(rule.model)
      }

      expect(duplicates).toEqual([])
    })

    it('uses all four lifecycle classes', () => {
      for (const recordClass of Object.values(RecordClass)) {
        expect(modelsInClass(recordClass).length).toBeGreaterThan(0)
      }
    })
  })

  describe('internal consistency', () => {
    it('gives every purgeable model a retention anchor', () => {
      const missing = lifecycleRules()
        .filter((rule) => rule.retentionDays !== null && !rule.retentionAnchor)
        .map((rule) => rule.model)

      expect(missing).toEqual([])
    })

    it('anchors archivable models on archivedAt', () => {
      const wrong = lifecycleRules()
        .filter(
          (rule) =>
            rule.recordClass === RecordClass.ARCHIVABLE &&
            rule.retentionAnchor !== 'archivedAt',
        )
        .map((rule) => rule.model)

      expect(wrong).toEqual([])
    })

    it('states a rationale for every rule', () => {
      const undocumented = lifecycleRules()
        .filter((rule) => rule.notes.trim().length < 20)
        .map((rule) => rule.model)

      expect(undocumented).toEqual([])
    })
  })

  describe('policy invariants', () => {
    it('retains money records for the statutory window and never deletes them on erasure', () => {
      const money = lifecycleRules().filter(
        (rule) => rule.category === DataCategory.MONEY,
      )

      expect(money.length).toBeGreaterThan(0)

      for (const rule of money) {
        // A ledger a subject can erase is not a ledger. Money rows either
        // survive erasure outright or disappear with their parent.
        expect([ErasureAction.RETAIN, ErasureAction.CASCADE]).toContain(
          rule.onErasure,
        )

        if (rule.retentionDays !== null) {
          expect(rule.retentionDays).toBeGreaterThanOrEqual(Retention.ONE_YEAR)
        }
      }
    })

    it('keeps credentials verifiable indefinitely', () => {
      const credentials = lifecycleRules().filter(
        (rule) => rule.category === DataCategory.CREDENTIAL,
      )

      expect(credentials.length).toBeGreaterThan(0)

      for (const rule of credentials) {
        expect(rule.recordClass).toBe(RecordClass.IMMUTABLE)
        expect(rule.retentionDays).toBeNull()
      }
    })

    it('retains consent proof beyond the account it describes', () => {
      const consent = lifecycleRules().filter(
        (rule) => rule.category === DataCategory.CONSENT,
      )

      expect(consent.length).toBeGreaterThan(0)

      for (const rule of consent) {
        expect(rule.recordClass).toBe(RecordClass.IMMUTABLE)
        expect(rule.onErasure).toBe(ErasureAction.RETAIN)
        expect(rule.retentionDays).toBe(Retention.SEVEN_YEARS)
      }
    })

    it('bounds how long security events are kept', () => {
      const security = lifecycleRules().filter(
        (rule) => rule.category === DataCategory.SECURITY,
      )

      expect(security.length).toBeGreaterThan(0)

      for (const rule of security) {
        // Indefinite retention of security data is the failure mode this
        // category exists to prevent. ManagedKeyReference is the one exception:
        // destroying a key handle orphans the funds held under it.
        if (rule.model === 'ManagedKeyReference') {
          expect(rule.retentionDays).toBeNull()
          continue
        }

        expect(rule.retentionDays).not.toBeNull()
        expect(rule.retentionDays!).toBeLessThanOrEqual(Retention.SEVEN_YEARS)
      }
    })

    it('gives the export artifact the shortest retention in the schema', () => {
      const shortest = Math.min(
        ...lifecycleRules()
          .map((rule) => rule.retentionDays)
          .filter((days): days is number => days !== null),
      )

      expect(lifecycleRuleFor('DataExportRequest')!.retentionDays).toBe(
        shortest,
      )
    })

    it('audits every money, credential and consent mutation', () => {
      const sensitive = [
        DataCategory.MONEY,
        DataCategory.CREDENTIAL,
        DataCategory.CONSENT,
      ]

      // Append-only history tables are exempt: a row in one of them *is* the
      // audit record, and auditing it would only produce a second row saying
      // the first was written.
      const selfAuditing = new Set([
        'AuditEvent',
        'AuditLog',
        'PreferenceAuditLog',
      ])

      const unaudited = lifecycleRules()
        .filter((rule) => sensitive.includes(rule.category) && !rule.audited)
        .map((rule) => rule.model)
        .filter((model) => !selfAuditing.has(model))

      // JobAttempt and WalletProvisioningJob are OPERATIONAL, not MONEY, so
      // queue bookkeeping is not swept up by this rule.
      expect(unaudited).toEqual([])
    })

    it('does not require the audit tables to audit themselves', () => {
      expect(requiresAudit('AuditEvent')).toBe(false)
      expect(requiresAudit('AuditLog')).toBe(false)
      expect(requiresAudit('PreferenceAuditLog')).toBe(false)
    })

    it('keeps every self-auditing history table immutable', () => {
      // The exemption above is only safe because these tables cannot be edited:
      // an unaudited *and* mutable history table would be rewritable in silence.
      for (const model of ['AuditEvent', 'AuditLog', 'PreferenceAuditLog']) {
        expect(lifecycleRuleFor(model)!.recordClass).toBe(RecordClass.IMMUTABLE)
      }
    })
  })

  describe('archive classification', () => {
    it('marks exactly the models that carry archive columns', () => {
      expect([...modelsInClass(RecordClass.ARCHIVABLE)].sort()).toEqual([
        'Avatar',
        'LearnerProfile',
        'Module',
        'ReferralCode',
        'WebhookEndpoint',
      ])
    })

    it('declares archivedAt on every archivable model in the schema', () => {
      const schema = readFileSync(
        join(process.cwd(), 'prisma', 'schema.prisma'),
        'utf8',
      )

      for (const model of modelsInClass(RecordClass.ARCHIVABLE)) {
        const block = schema.match(
          new RegExp(`model\\s+${model}\\s*\\{([\\s\\S]*?)\\n\\}`),
        )

        expect(block, `model ${model} not found in schema`).not.toBeNull()
        expect(
          block![1],
          `${model} is ARCHIVABLE but has no archivedAt`,
        ).toContain('archivedAt')
        expect(block![1]).toContain('archivedById')
        expect(block![1]).toContain('archivedReason')
      }
    })

    it('does not declare archive columns on models outside the archivable class', () => {
      const schema = readFileSync(
        join(process.cwd(), 'prisma', 'schema.prisma'),
        'utf8',
      )
      const archivable = new Set(modelsInClass(RecordClass.ARCHIVABLE))

      const unexpected = lifecycleRules()
        .filter((rule) => !archivable.has(rule.model))
        .filter((rule) => {
          const block = schema.match(
            new RegExp(`model\\s+${rule.model}\\s*\\{([\\s\\S]*?)\\n\\}`),
          )

          return block ? /^\s*archivedAt\s/m.test(block[1]) : false
        })
        .map((rule) => rule.model)

      expect(unexpected).toEqual([])
    })
  })

  describe('recordClassFor', () => {
    it('resolves a classified model', () => {
      expect(recordClassFor('Transaction')).toBe(RecordClass.IMMUTABLE)
      expect(recordClassFor('Module')).toBe(RecordClass.ARCHIVABLE)
      expect(recordClassFor('DeviceToken')).toBe(RecordClass.DELETABLE)
      expect(recordClassFor('User')).toBe(RecordClass.MUTABLE)
    })

    it('falls back to MUTABLE for an unknown model rather than throwing', () => {
      // Called from inside an audit write, so it must not be able to fail the
      // mutation it is describing.
      expect(recordClassFor('SomeFutureModel')).toBe(RecordClass.MUTABLE)
    })
  })

  describe('retentionCutoff', () => {
    const now = new Date('2026-08-24T00:00:00.000Z')

    it('subtracts the retention window from now', () => {
      expect(retentionCutoff('EmailDelivery', now)?.toISOString()).toBe(
        '2026-07-25T00:00:00.000Z',
      )
    })

    it('returns null for indefinitely retained models', () => {
      expect(retentionCutoff('Credential', now)).toBeNull()
      expect(retentionCutoff('User', now)).toBeNull()
    })

    it('returns null for an unclassified model', () => {
      expect(retentionCutoff('SomeFutureModel', now)).toBeNull()
    })

    it('puts the audit-event cutoff seven years back', () => {
      const cutoff = retentionCutoff('AuditEvent', now)!
      const years =
        (now.getTime() - cutoff.getTime()) / (365.25 * 24 * 60 * 60_000)

      expect(years).toBeCloseTo(7, 1)
    })
  })
})
