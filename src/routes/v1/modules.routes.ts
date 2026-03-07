import { Router } from 'express';
import { ModuleController } from '../../controllers/module.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
const moduleController = new ModuleController();

/**
 * @openapi
 * tags:
 *   name: Modules
 *   description: Learning modules and progress
 */

/**
 * @openapi
 * /v1/modules:
 *   get:
 *     summary: Get all modules
 *     tags: [Modules]
 *     responses:
 *       200:
 *         description: List of modules
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Module'
 */
router.get('/', moduleController.getAllModules.bind(moduleController));

/**
 * @openapi
 * /v1/modules/{id}:
 *   get:
 *     summary: Get module by ID
 *     tags: [Modules]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Module details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Module'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/:id', moduleController.getModuleById.bind(moduleController));

/**
 * @openapi
 * /v1/modules:
 *   post:
 *     summary: Create a new module
 *     tags: [Modules]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateModuleRequest'
 *     responses:
 *       201:
 *         description: Module created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Module'
 */
router.post('/', authenticate, moduleController.createModule.bind(moduleController));

/**
 * @openapi
 * /v1/modules/{id}:
 *   patch:
 *     summary: Update an existing module
 *     tags: [Modules]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateModuleRequest'
 *     responses:
 *       200:
 *         description: Module updated
 */
router.patch('/:id', authenticate, moduleController.updateModule.bind(moduleController));

/**
 * @openapi
 * /v1/modules/{id}:
 *   delete:
 *     summary: Delete a module
 *     tags: [Modules]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Module deleted
 */
router.delete('/:id', authenticate, moduleController.deleteModule.bind(moduleController));

/**
 * @openapi
 * /v1/modules/{id}/enroll:
 *   post:
 *     summary: Enroll in a module
 *     tags: [Modules]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Enrolled successfully
 */
router.post('/:id/enroll', authenticate, moduleController.enrollInModule.bind(moduleController));

/**
 * @openapi
 * /v1/modules/{id}/progress:
 *   patch:
 *     summary: Update module progress
 *     tags: [Modules]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateProgressRequest'
 *     responses:
 *       200:
 *         description: Progress updated
 */
router.patch('/:id/progress', authenticate, moduleController.updateProgress.bind(moduleController));

export default router;
