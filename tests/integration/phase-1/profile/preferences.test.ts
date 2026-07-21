import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createAuthenticatedClient } from '../helpers/api-client'
import { cleanupDatabase } from '../helpers/database'
import { createUser } from '../factories/user.factory'
import { createToken } from '../factories/session.factory'
import prisma from '../../../../src/config/database'

describe('Learner Preferences', () => {
  beforeEach(async () => {
    await cleanupDatabase()
  })

  afterEach(async () => {
    await cleanupDatabase()
  })

  describe('GET /preferences', () => {
    it('should return learner preferences with defaults', async () => {
      const { user } = await createUser()
      const token = createToken(user.id, user.email)
      const client = createAuthenticatedClient(token)

      const response = await client.get('/preferences')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        locale: 'en-US',
        timezone: 'UTC',
        lowDataMode: false,
        highContrast: false,
        reduceMotion: false,
        screenReaderOptimized: false,
        textSize: 'medium',
        preferredDifficulty: 'beginner',
        preferredCategories: [],
        profileVisibility: 'public',
        analyticsConsent: false,
        dataSharingConsent: false,
      })
    })

    it('should create preferences row on first access', async () => {
      const { user } = await createUser()
      const token = createToken(user.id, user.email)
      const client = createAuthenticatedClient(token)

      // Verify no preferences exist yet
      const before = await prisma.learnerPreference.findUnique({
        where: { userId: user.id },
      })
      expect(before).toBeNull()

      // GET creates the row
      await client.get('/preferences')

      // Verify preferences created
      const after = await prisma.learnerPreference.findUnique({
        where: { userId: user.id },
      })
      expect(after).toBeTruthy()
    })
  })

  describe('PATCH /preferences', () => {
    it('should update preferences partially', async () => {
      const { user } = await createUser()
      const token = createToken(user.id, user.email)
      const client = createAuthenticatedClient(token)

      // Update specific fields
      const response = await client.patch('/preferences', {
        locale: 'es-ES',
        lowDataMode: true,
        textSize: 'large',
      })

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        locale: 'es-ES',
        lowDataMode: true,
        textSize: 'large',
        timezone: 'UTC', // Unchanged default
      })

      // Verify database updated
      const prefs = await prisma.learnerPreference.findUnique({
        where: { userId: user.id },
      })
      expect(prefs!.locale).toBe('es-ES')
      expect(prefs!.lowDataMode).toBe(true)
      expect(prefs!.textSize).toBe('large')
    })

    it('should audit privacy-impacting preference changes', async () => {
      const { user } = await createUser()
      const token = createToken(user.id, user.email)
      const client = createAuthenticatedClient(token)

      // Update privacy preferences
      await client.patch('/preferences', {
        profileVisibility: 'private',
        analyticsConsent: true,
        dataSharingConsent: true,
      })

      // Verify audit logs created
      const logs = await prisma.preferenceAuditLog.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
      })

      expect(logs.length).toBe(3)

      const fields = logs.map(l => l.field)
      expect(fields).toContain('profileVisibility')
      expect(fields).toContain('analyticsConsent')
      expect(fields).toContain('dataSharingConsent')

      // Verify old/new values logged
      const visibilityLog = logs.find(l => l.field === 'profileVisibility')
      expect(visibilityLog!.oldValue).toBe('public')
      expect(visibilityLog!.newValue).toBe('private')
    })

    it('should not audit non-privacy fields', async () => {
      const { user } = await createUser()
      const token = createToken(user.id, user.email)
      const client = createAuthenticatedClient(token)

      // Update non-privacy preference
      await client.patch('/preferences', {
        textSize: 'large',
        lowDataMode: true,
      })

      // Verify no audit logs created
      const logs = await prisma.preferenceAuditLog.findMany({
        where: { userId: user.id },
      })

      expect(logs.length).toBe(0)
    })

    it('should validate preference values', async () => {
      const { user } = await createUser()
      const token = createToken(user.id, user.email)
      const client = createAuthenticatedClient(token)

      // Invalid textSize value
      const response = await client.patch('/preferences', {
        textSize: 'invalid',
      })

      expect(response.status).toBe(400)
    })

    it('should handle concurrent preference updates safely', async () => {
      const { user } = await createUser()
      const token = createToken(user.id, user.email)
      const client = createAuthenticatedClient(token)

      // Concurrent updates
      const [resp1, resp2] = await Promise.all([
        client.patch('/preferences', { locale: 'fr-FR' }),
        client.patch('/preferences', { timezone: 'America/New_York' }),
      ])

      // Both should succeed
      expect(resp1.status).toBe(200)
      expect(resp2.status).toBe(200)

      // Final state should have both changes
      const final = await client.get('/preferences')
      expect(final.body.locale).toBe('fr-FR')
      expect(final.body.timezone).toBe('America/New_York')
    })

    it('should preserve unspecified fields', async () => {
      const { user } = await createUser()
      const token = createToken(user.id, user.email)
      const client = createAuthenticatedClient(token)

      // Set initial values
      await client.patch('/preferences', {
        locale: 'de-DE',
        textSize: 'extra_large',
        highContrast: true,
      })

      // Update only one field
      await client.patch('/preferences', {
        locale: 'it-IT',
      })

      // Verify other fields unchanged
      const response = await client.get('/preferences')
      expect(response.body).toMatchObject({
        locale: 'it-IT',
        textSize: 'extra_large',
        highContrast: true,
      })
    })
  })
})
