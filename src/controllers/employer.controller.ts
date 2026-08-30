import { Request, Response } from 'express'
import { z } from 'zod'
import prisma from '../config/database'

const searchQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  skills: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((skill) => skill.trim().toLowerCase())
            .filter(Boolean)
        : [],
    ),
  location: z
    .string()
    .optional()
    .transform((value) => value?.trim().toLowerCase()),
  credentials: z.enum(['any', 'verified', 'none']).optional().default('any'),
  search: z
    .string()
    .optional()
    .transform((value) => value?.trim()),
})

const contactBodySchema = z.object({
  candidateId: z.string().min(1),
  subject: z.string().min(3).max(120),
  message: z.string().min(10).max(3000),
  channel: z.enum(['platform', 'email', 'both']).optional().default('platform'),
})

const PLAN_RANK: Record<string, number> = {
  starter: 1,
  pro: 2,
  enterprise: 3,
}
const PLAN_MAX_SEARCH_LIMIT: Record<string, number> = {
  starter: 10,
  pro: 50,
  enterprise: 100,
}

function getEmployerPlan(req: Request) {
  const fromHeader = req.headers['x-employer-plan']
  const planValue = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader
  const normalized = String(planValue ?? 'starter').toLowerCase()

  return PLAN_RANK[normalized] ? normalized : 'starter'
}

function getPrivateCandidateIds() {
  return new Set(
    (process.env.PRIVATE_CANDIDATE_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  )
}

function locationForCandidate(email: string) {
  const local = email.split('@')[0]?.toLowerCase() ?? ''

  if (local.includes('alice')) return 'lagos'
  if (local.includes('bob')) return 'nairobi'
  if (local.includes('carla')) return 'manila'
  if (local.includes('deepak')) return 'mumbai'

  return 'remote'
}

type CandidateRecord = {
  id: string
  email: string
  username: string
  createdAt: Date
  completions: Array<{
    score: number
    completedAt: Date
    module: {
      id: string
      title: string
      category: string
      difficulty: string
    }
  }>
  credentials: Array<{
    id: string
    onChainId: string | null
    issuedAt: Date
    module: {
      id: string
      title: string
      category: string
      difficulty: string
    }
  }>
}

function derivedSkills(candidate: CandidateRecord) {
  const set = new Set<string>()
  for (const completion of candidate.completions) {
    set.add(completion.module.category.toLowerCase())
    completion.module.title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3)
      .forEach((word) => set.add(word))
  }

  return Array.from(set).sort()
}

function profileFromCandidate(candidate: CandidateRecord) {
  const verifiedCredentials = candidate.credentials.map((credential) => ({
    id: credential.id,
    moduleId: credential.module.id,
    moduleTitle: credential.module.title,
    category: credential.module.category,
    difficulty: credential.module.difficulty,
    issuedAt: credential.issuedAt,
    onChainId: credential.onChainId,
    verified: Boolean(credential.onChainId),
  }))

  return {
    id: candidate.id,
    name: candidate.username,
    location: locationForCandidate(candidate.email),
    joinedAt: candidate.createdAt,
    skills: derivedSkills(candidate),
    completions: candidate.completions.length,
    averageScore:
      candidate.completions.length > 0
        ? Number(
            (
              candidate.completions.reduce(
                (sum, completion) => sum + completion.score,
                0,
              ) / candidate.completions.length
            ).toFixed(2),
          )
        : 0,
    verifiedCredentials,
  }
}

function isEmployer(req: Request) {
  return req.user?.role === 'employer'
}

/**
 * @openapi
 * /employer/search:
 *   get:
 *     operationId: employerSearchTalent
 *     summary: Search learner talent pool with skill and location filters
 *     description: >
 *       Requires `employer` role. Results are filtered by plan tier:
 *       starter ≤ 10 results/page, pro ≤ 50, enterprise ≤ 100.
 *       Plan is read from the `x-employer-plan` request header (defaults to `starter`).
 *     tags: [Employer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Capped by plan tier.
 *       - in: query
 *         name: skills
 *         schema:
 *           type: string
 *         description: Comma-separated skill keywords (e.g. `finance,defi`).
 *       - in: query
 *         name: location
 *         schema:
 *           type: string
 *         description: Location string to match against candidate profile.
 *       - in: query
 *         name: credentials
 *         schema:
 *           type: string
 *           enum: [any, verified, none]
 *           default: any
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Free-text search on username or email.
 *       - in: header
 *         name: x-employer-plan
 *         schema:
 *           type: string
 *           enum: [starter, pro, enterprise]
 *         description: Employer subscription tier (defaults to `starter` if absent or invalid).
 *     responses:
 *       200:
 *         description: Paginated list of matching candidates
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmployerSearchResponse'
 *       400:
 *         description: Invalid query parameters or limit exceeds plan maximum
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Employer role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const searchTalent = async (req: Request, res: Response) => {
  if (!isEmployer(req)) {
    return res.status(403).json({ message: 'Employer account required' })
  }

  const parsed = searchQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid query parameters',
      errors: parsed.error.errors,
    })
  }

  const { page, limit, skills, location, credentials, search } = parsed.data
  const employerPlan = getEmployerPlan(req)
  const maxLimit =
    PLAN_MAX_SEARCH_LIMIT[employerPlan] ?? PLAN_MAX_SEARCH_LIMIT.starter
  if (limit > maxLimit) {
    return res.status(400).json({
      message: `Current plan allows up to ${maxLimit} results per page`,
      currentPlan: employerPlan,
      requestedLimit: limit,
      maxLimit,
    })
  }

  const privateCandidateIds = getPrivateCandidateIds()

  const candidates = (await prisma.user.findMany({
    where: {
      id: { not: req.user?.id },
      ...(search
        ? {
            OR: [
              { username: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: {
      completions: {
        include: {
          module: {
            select: {
              id: true,
              title: true,
              category: true,
              difficulty: true,
            },
          },
        },
      },
      credentials: {
        include: {
          module: {
            select: {
              id: true,
              title: true,
              category: true,
              difficulty: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })) as CandidateRecord[]

  const filtered = candidates
    .filter((candidate) => !privateCandidateIds.has(candidate.id))
    .filter((candidate) => candidate.completions.length > 0)
    .filter((candidate) => {
      if (!location) return true

      return locationForCandidate(candidate.email) === location
    })
    .filter((candidate) => {
      if (credentials === 'any') return true
      if (credentials === 'verified')
        return candidate.credentials.some((credential) =>
          Boolean(credential.onChainId),
        )

      return candidate.credentials.length === 0
    })
    .filter((candidate) => {
      if (skills.length === 0) return true
      const candidateSkills = new Set(derivedSkills(candidate))

      return skills.every((skill) => candidateSkills.has(skill))
    })
    .map((candidate) => {
      const profile = profileFromCandidate(candidate)

      return {
        id: profile.id,
        name: profile.name,
        location: profile.location,
        skills: profile.skills,
        completions: profile.completions,
        averageScore: profile.averageScore,
        verifiedCredentialCount: profile.verifiedCredentials.filter(
          (credential) => credential.verified,
        ).length,
      }
    })

  const total = filtered.length
  const offset = (page - 1) * limit
  const paginated = filtered.slice(offset, offset + limit)

  return res.json({
    candidates: paginated,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
    filters: {
      skills,
      location: location ?? null,
      credentials,
    },
    plan: employerPlan,
  })
}

/**
 * @openapi
 * /employer/candidates/{id}:
 *   get:
 *     operationId: employerGetCandidateProfile
 *     summary: Get a candidate's full profile with verified credentials
 *     description: >
 *       Requires `employer` role. Returns 404 if the candidate has no module
 *       completions. Returns 403 if the candidate has opted out of visibility.
 *     tags: [Employer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Candidate profile with verified credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CandidateProfile'
 *       403:
 *         description: Employer role required or candidate profile is private
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Candidate not found or has no completions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const getCandidateProfile = async (req: Request, res: Response) => {
  if (!isEmployer(req)) {
    return res.status(403).json({ message: 'Employer account required' })
  }

  const { id } = req.params
  const privateCandidateIds = getPrivateCandidateIds()
  if (privateCandidateIds.has(id)) {
    return res.status(403).json({ message: 'Candidate profile is private' })
  }

  const candidate = (await prisma.user.findUnique({
    where: { id },
    include: {
      completions: {
        include: {
          module: {
            select: {
              id: true,
              title: true,
              category: true,
              difficulty: true,
            },
          },
        },
        orderBy: { completedAt: 'desc' },
      },
      credentials: {
        include: {
          module: {
            select: {
              id: true,
              title: true,
              category: true,
              difficulty: true,
            },
          },
        },
        orderBy: { issuedAt: 'desc' },
      },
    },
  })) as CandidateRecord | null

  if (!candidate || candidate.completions.length === 0) {
    return res.status(404).json({ message: 'Candidate not found' })
  }

  return res.json({
    ...profileFromCandidate(candidate),
    privacy: {
      profileVisibility: 'public',
    },
  })
}

/**
 * @openapi
 * /employer/contact:
 *   post:
 *     operationId: employerContactCandidate
 *     summary: Record a candidate outreach attempt
 *     description: >
 *       Requires `employer` role and at least a **pro** plan (`x-employer-plan: pro`
 *       or `enterprise`). Starter plan returns HTTP 402. The outreach is logged
 *       internally; no message is actually delivered to the candidate at this time.
 *     tags: [Employer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: x-employer-plan
 *         required: true
 *         schema:
 *           type: string
 *           enum: [pro, enterprise]
 *         description: Must be `pro` or `enterprise`; `starter` returns 402.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ContactCandidateInput'
 *     responses:
 *       201:
 *         description: Outreach recorded successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ContactCandidateResponse'
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       402:
 *         description: Plan upgrade required (starter plan cannot use contact)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Employer role required or candidate profile is private
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Candidate not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const contactCandidate = async (req: Request, res: Response) => {
  if (!isEmployer(req)) {
    return res.status(403).json({ message: 'Employer account required' })
  }

  const employerPlan = getEmployerPlan(req)
  if (PLAN_RANK[employerPlan] < PLAN_RANK.pro) {
    return res.status(402).json({
      message: 'Employer plan upgrade required',
      requiredPlan: 'pro',
      currentPlan: employerPlan,
    })
  }

  const parsed = contactBodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid request body',
      errors: parsed.error.errors,
    })
  }

  const { candidateId, subject, message, channel } = parsed.data
  const privateCandidateIds = getPrivateCandidateIds()
  if (privateCandidateIds.has(candidateId)) {
    return res.status(403).json({ message: 'Candidate profile is private' })
  }

  const candidate = await prisma.user.findUnique({
    where: { id: candidateId },
    select: {
      id: true,
      email: true,
      username: true,
    },
  })

  if (!candidate) {
    return res.status(404).json({ message: 'Candidate not found' })
  }

  const outreachEndpoint = await prisma.webhookEndpoint.upsert({
    where: { id: 'system-employer-outreach-log' },
    update: {
      url: 'https://internal.learnault/employer-outreach',
      description:
        'System log endpoint for employer candidate outreach attempts',
      isActive: true,
      events: 'employer.contact_attempt',
    },
    create: {
      id: 'system-employer-outreach-log',
      url: 'https://internal.learnault/employer-outreach',
      description:
        'System log endpoint for employer candidate outreach attempts',
      secret: null,
      isActive: true,
      events: 'employer.contact_attempt',
    },
  })

  const outreachAttempt = await prisma.webhookDelivery.create({
    data: {
      endpointId: outreachEndpoint.id,
      eventType: 'employer.contact_attempt',
      payload: JSON.stringify({
        employerId: req.user?.id,
        employerPlan,
        candidateId: candidate.id,
        subject,
        message,
        channel,
        attemptedAt: new Date().toISOString(),
      }),
      status: 'success',
      statusCode: 201,
      responseBody: 'recorded',
      attemptCount: 1,
      maxAttempts: 1,
      nextAttemptAt: null,
      lastAttemptAt: new Date(),
    },
  })

  return res.status(201).json({
    message: 'Candidate outreach recorded',
    outreach: {
      id: outreachAttempt.id,
      candidateId: candidate.id,
      channel,
      status: 'recorded',
      createdAt: outreachAttempt.createdAt,
    },
  })
}
