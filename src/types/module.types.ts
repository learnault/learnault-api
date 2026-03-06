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
