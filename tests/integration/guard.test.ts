import { describe, it, expect } from 'vitest'
import { validateTestDatabaseUrl, UnsafeDatabaseError } from '../helpers/guard'

describe('Database safety guard', () => {
  it('rejects production database URLs', () => {
    const unsafeUrls = [
      'postgresql://user:pass@prod.example.com:5432/mydb',
      'postgresql://user:pass@db.myapp.com:5432/production',
      'postgresql://user:pass@myapp-prod.cluster.amazonaws.com:5432/mydb',
      'postgresql://user:pass@myapp-production.rds.amazonaws.com:5432/mydb',
      'postgresql://user:pass@myapp.database.azure.com:5432/mydb',
      'postgresql://user:pass@myapp.db.heroku.com:5432/mydb',
      'postgresql://user:pass@myapp.onrender.com:5432/mydb',
      'postgresql://user:pass@myapp.fly.dev:5432/mydb',
      'postgresql://user:pass@myapp.railway.app:5432/mydb',
    ]

    for (const url of unsafeUrls) {
      expect(() => validateTestDatabaseUrl(url)).toThrow(UnsafeDatabaseError)
    }
  })

  it('accepts local test database URLs', () => {
    const safeUrls = [
      'postgresql://user:pass@localhost:5432/learnault_test',
      'postgresql://user:pass@localhost:5433/learnault',
      'postgresql://user:pass@127.0.0.1:5432/test_db',
      'postgresql://user:pass@localhost:5432/ci_learnault',
    ]

    for (const url of safeUrls) {
      expect(() => validateTestDatabaseUrl(url)).not.toThrow()
    }
  })

  it('rejects empty DATABASE_URL', () => {
    expect(() => validateTestDatabaseUrl('')).toThrow(UnsafeDatabaseError)
  })

  it('throws UnsafeDatabaseError with descriptive message', () => {
    try {
      validateTestDatabaseUrl(
        'postgresql://user:pass@prod.example.com:5432/mydb',
      )
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(UnsafeDatabaseError)
      expect((err as UnsafeDatabaseError).message).toContain('production')
    }
  })
})
