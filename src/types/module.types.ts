export enum Difficulty {
  BEGINNER = "beginner",
  INTERMEDIATE = "intermediate",
  ADVANCED = "advanced",
  EXPERT = "expert",
}

export enum Category {
  BLOCKCHAIN = "blockchain",
  FINANCE = "finance",
  SECURITY = "security",
  DEVELOPMENT = "development",
  COMPLIANCE = "compliance",
  IDENTITY = "identity",
}

export enum ModuleStatus {
  DRAFT = "draft",
  PUBLISHED = "published",
  ARCHIVED = "archived",
}

export enum EnrollmentStatus {
  NOT_STARTED = "not_started",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  FAILED = "failed",
}

/**
 * @openapi
 * components:
 *   schemas:
 *     Module:
 *       type: object
 *       required: [id, title, description, difficulty, category, authorId, pointsReward]
 *       properties:
 *         id: { type: string, format: uuid }
 *         title: { type: string }
 *         description: { type: string }
 *         difficulty: { type: string, enum: [beginner, intermediate, advanced, expert] }
 *         category: { type: string, enum: [blockchain, finance, security, development, compliance, identity] }
 *         status: { type: string, enum: [draft, published, archived] }
 *         authorId: { type: string, format: uuid }
 *         estimatedMinutes: { type: number }
 *         pointsReward: { type: number }
 *         prerequisiteIds: { type: array, items: { type: string } }
 *         tags: { type: array, items: { type: string } }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *         publishedAt: { type: string, format: date-time }
 */
export interface Module {
  id: string;
  title: string;
  description: string;
  difficulty: Difficulty;
  category: Category;
  status: ModuleStatus;
  authorId: string;
  estimatedMinutes: number;
  pointsReward: number;
  prerequisiteIds: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export interface ModuleWithProgress extends Module {
  enrollment?: Enrollment;
  completionRate: number;
  totalEnrollments: number;
}

export interface Enrollment {
  id: string;
  userId: string;
  moduleId: string;
  status: EnrollmentStatus;
  progressPercent: number;
  startedAt: string;
  completedAt?: string;
  score?: number;
}

// Request types
/**
 * @openapi
 * components:
 *   schemas:
 *     CreateModuleRequest:
 *       type: object
 *       required: [title, description, difficulty, category, estimatedMinutes, pointsReward]
 *       properties:
 *         title: { type: string }
 *         description: { type: string }
 *         difficulty: { type: string, enum: [beginner, intermediate, advanced, expert] }
 *         category: { type: string, enum: [blockchain, finance, security, development, compliance, identity] }
 *         estimatedMinutes: { type: number }
 *         pointsReward: { type: number }
 *         prerequisiteIds: { type: array, items: { type: string } }
 *         tags: { type: array, items: { type: string } }
 */
export interface CreateModuleRequest {
  title: string;
  description: string;
  difficulty: Difficulty;
  category: Category;
  estimatedMinutes: number;
  pointsReward: number;
  prerequisiteIds?: string[];
  tags?: string[];
}

/**
 * @openapi
 * components:
 *   schemas:
 *     UpdateModuleRequest:
 *       type: object
 *       properties:
 *         title: { type: string }
 *         description: { type: string }
 *         difficulty: { type: string, enum: [beginner, intermediate, advanced, expert] }
 *         category: { type: string, enum: [blockchain, finance, security, development, compliance, identity] }
 *         status: { type: string, enum: [draft, published, archived] }
 *         estimatedMinutes: { type: number }
 *         pointsReward: { type: number }
 *         prerequisiteIds: { type: array, items: { type: string } }
 *         tags: { type: array, items: { type: string } }
 */
export interface UpdateModuleRequest {
  title?: string;
  description?: string;
  difficulty?: Difficulty;
  category?: Category;
  status?: ModuleStatus;
  estimatedMinutes?: number;
  pointsReward?: number;
  prerequisiteIds?: string[];
  tags?: string[];
}

/**
 * @openapi
 * components:
 *   schemas:
 *     UpdateProgressRequest:
 *       type: object
 *       required: [progressPercent]
 *       properties:
 *         progressPercent: { type: number, minimum: 0, maximum: 100 }
 *         status: { type: string, enum: [not_started, in_progress, completed, failed] }
 *         score: { type: number }
 */
export interface UpdateProgressRequest {
  progressPercent: number;
  status?: EnrollmentStatus;
  score?: number;
}

export interface ModuleFilterParams {
  difficulty?: Difficulty;
  category?: Category;
  status?: ModuleStatus;
  authorId?: string;
  tag?: string;
  search?: string;
}
