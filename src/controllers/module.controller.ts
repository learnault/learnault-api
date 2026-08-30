import { Request, Response } from 'express'

/** Sentinel score while a module is started but not yet completed (schema uses non-null Float). */
const COMPLETION_IN_PROGRESS_SCORE = -1
import { z } from 'zod'
import { prisma } from '../config/database'
import { NotificationService } from '../services/notification.service'
import { stroopsToXlmString } from '../utils/money'

const notificationService = new NotificationService()

// Query parameter schemas for validation
const listModulesSchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val) : 1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val) : 10)),
  category: z.string().optional(),
  difficulty: z.string().optional(),
  search: z.string().optional(),
})

const completeModuleSchema = z.object({
  quizAnswers: z.array(
    z.object({
      questionId: z.string(),
      answer: z.string(),
    }),
  ),
})

/**
 * @openapi
 * /modules:
 *   get:
 *     operationId: modulesList
 *     summary: List modules with filters and pagination
 *     description: Authentication is optional. When a valid token is supplied, each module includes the caller's progress.
 *     tags: [Modules]
 *     security: []
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
 *           default: 10
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *       - in: query
 *         name: difficulty
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of modules
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ModuleList'
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const listModules = async (req: Request, res: Response) => {
  try {
    const queryValidation = listModulesSchema.safeParse(req.query)
    if (!queryValidation.success) {
      return res.status(400).json({
        message: 'Invalid query parameters',
        errors: queryValidation.error.errors,
      })
    }

    const { page, limit, category, difficulty, search } = queryValidation.data
    const skip = (page - 1) * limit

    // Build where clause for filters
    const where: any = {}

    if (category) {
      where.category = category
    }

    if (difficulty) {
      where.difficulty = difficulty
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ]
    }

    // Get total count for pagination
    const total = await prisma.module.count({ where })

    // Get modules with pagination
    const modules = await prisma.module.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            completions: true,
          },
        },
      },
    })

    // If user is authenticated, include their progress
    const userProgress: any = {}
    if (req.user) {
      const userCompletions = await prisma.completion.findMany({
        where: { userId: req.user.id },
        select: { moduleId: true, score: true, completedAt: true },
      })

      userCompletions.forEach((completion: any) => {
        userProgress[completion.moduleId] = {
          completed: true,
          score: completion.score,
          completedAt: completion.completedAt,
        }
      })
    }

    // Transform response
    const transformedModules = modules.map((module: any) => ({
      id: module.id,
      title: module.title,
      description: module.description,
      category: module.category,
      difficulty: module.difficulty,
      reward: stroopsToXlmString(module.rewardStroops),
      createdAt: module.createdAt,
      updatedAt: module.updatedAt,
      completionCount: module._count.completions,
      userProgress: userProgress[module.id] || null,
    }))

    res.json({
      modules: transformedModules,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    })
  } catch (error) {
    console.error('Error listing modules:', error)
    res.status(500).json({ message: 'Internal server error' })
  }
}

/**
 * @openapi
 * /modules/{id}:
 *   get:
 *     operationId: modulesGetById
 *     summary: Get module details
 *     description: Authentication is optional. When a valid token is supplied, the response includes the caller's progress.
 *     tags: [Modules]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Module details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Module'
 *       404:
 *         description: Module not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const getModuleById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const module = await prisma.module.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            completions: true,
          },
        },
      },
    })

    if (!module) {
      return res.status(404).json({ message: 'Module not found' })
    }

    // Get user's progress if authenticated
    let userProgress = null
    if (req.user) {
      const completion = await prisma.completion.findUnique({
        where: {
          userId_moduleId: {
            userId: req.user.id,
            moduleId: id,
          },
        },
      })

      if (completion) {
        userProgress = {
          completed: true,
          score: completion.score,
          completedAt: completion.completedAt,
        }
      }
    }

    const response = {
      id: module.id,
      title: module.title,
      description: module.description,
      category: module.category,
      difficulty: module.difficulty,
      reward: stroopsToXlmString(module.rewardStroops),
      createdAt: module.createdAt,
      updatedAt: module.updatedAt,
      completionCount: module._count.completions,
      userProgress,
    }

    res.json(response)
  } catch (error) {
    console.error('Error getting module:', error)
    res.status(500).json({ message: 'Internal server error' })
  }
}

/**
 * @openapi
 * /modules/{id}/start:
 *   post:
 *     operationId: modulesStart
 *     summary: Start tracking progress on a module
 *     tags: [Modules]
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
 *       201:
 *         description: Module started successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 completionId:
 *                   type: string
 *                   format: uuid
 *                 startedAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Module already started or completed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Module not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const startModule = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' })
    }

    const { id } = req.params

    // Check if module exists
    const module = await prisma.module.findUnique({
      where: { id },
    })

    if (!module) {
      return res.status(404).json({ message: 'Module not found' })
    }

    // Check if user already has a completion record
    const existingCompletion = await prisma.completion.findUnique({
      where: {
        userId_moduleId: {
          userId: req.user.id,
          moduleId: id,
        },
      },
    })

    if (existingCompletion) {
      return res.status(400).json({
        message: 'Module already started or completed',
        status: existingCompletion.score >= 0 ? 'completed' : 'in_progress',
      })
    }

    // Create completion record with sentinel score until quiz is submitted
    const completion = await prisma.completion.create({
      data: {
        userId: req.user.id,
        moduleId: id,
        score: COMPLETION_IN_PROGRESS_SCORE,
      },
    })

    res.status(201).json({
      message: 'Module started successfully',
      completionId: completion.id,
      startedAt: completion.createdAt,
    })
  } catch (error) {
    console.error('Error starting module:', error)
    res.status(500).json({ message: 'Internal server error' })
  }
}

/**
 * @openapi
 * /modules/{id}/complete:
 *   post:
 *     operationId: modulesComplete
 *     summary: Submit quiz answers and complete a module
 *     description: >
 *       The module must have been started first via `POST /modules/{id}/start`.
 *       A score ≥ 70% qualifies for the XLM reward and triggers a push notification.
 *     tags: [Modules]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CompleteModuleInput'
 *     responses:
 *       200:
 *         description: Module completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ModuleCompletionResponse'
 *       400:
 *         description: Invalid request body, module not started, or already completed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Module not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const completeModule = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' })
    }

    const { id } = req.params
    const bodyValidation = completeModuleSchema.safeParse(req.body)

    if (!bodyValidation.success) {
      return res.status(400).json({
        message: 'Invalid request body',
        errors: bodyValidation.error.errors,
      })
    }

    const { quizAnswers } = bodyValidation.data

    // Check if module exists
    const module = await prisma.module.findUnique({
      where: { id },
    })

    if (!module) {
      return res.status(404).json({ message: 'Module not found' })
    }

    // Check if user has started this module
    const completion = await prisma.completion.findUnique({
      where: {
        userId_moduleId: {
          userId: req.user.id,
          moduleId: id,
        },
      },
    })

    if (!completion) {
      return res
        .status(400)
        .json({ message: 'Module must be started before completion' })
    }

    if (completion.score >= 0) {
      return res.status(400).json({ message: 'Module already completed' })
    }

    // Calculate score (simplified - in real implementation, this would validate against actual quiz questions)
    // For now, we'll simulate a scoring mechanism
    const correctAnswers = quizAnswers.length // Simplified: assume all answers are correct
    const totalQuestions = quizAnswers.length || 1 // Avoid division by zero
    const score = Math.round((correctAnswers / totalQuestions) * 100)

    // Update completion record
    const updatedCompletion = await prisma.completion.update({
      where: {
        userId_moduleId: {
          userId: req.user.id,
          moduleId: id,
        },
      },
      data: {
        score,
        completedAt: new Date(),
      },
    })

    // Check reward eligibility (score >= 70%)
    const isEligibleForReward = score >= 70
    let rewardTransaction = null

    if (isEligibleForReward) {
      // Create reward transaction
      rewardTransaction = await prisma.transaction.create({
        data: {
          userId: req.user.id,
          amountStroops: module.rewardStroops,
          type: 'reward',
          status: 'pending',
        },
      })
    }

    // Fire push notification for quiz pass/fail (non-blocking)
    notificationService
      .queueNotification(
        req.user.id,
        'quizPassFail',
        isEligibleForReward ? 'Quiz Passed!' : 'Quiz Completed',
        isEligibleForReward
          ? `Great job! You scored ${score}% on "${module.title}" and earned ${stroopsToXlmString(module.rewardStroops)} XLM.`
          : `You scored ${score}% on "${module.title}". Keep practicing to earn rewards!`,
      )
      .catch((err) =>
        console.error('[Notifications] Quiz notification error:', err),
      )

    res.json({
      message: 'Module completed successfully',
      score,
      isEligibleForReward,
      reward: isEligibleForReward
        ? stroopsToXlmString(module.rewardStroops)
        : '0.0000000',
      rewardTransaction: rewardTransaction?.id,
      completedAt: updatedCompletion.completedAt,
    })
  } catch (error) {
    console.error('Error completing module:', error)
    res.status(500).json({ message: 'Internal server error' })
  }
}
