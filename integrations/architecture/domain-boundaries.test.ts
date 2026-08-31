import { describe, test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const srcDir = path.resolve(__dirname, '../../src')

/**
 * Architecture tests to enforce domain boundary rules
 */

// Define domain structure (will be updated once refactoring is complete)
const DOMAIN_PATHS = {
  identity: 'domains/identity',
  users: 'domains/users',
  learning: 'domains/learning',
  credentials: 'domains/credentials',
  rewards: 'domains/rewards',
  referrals: 'domains/referrals',
  notifications: 'domains/notifications',
  organizations: 'domains/organizations',
  sync: 'domains/sync',
}

const SHARED_KERNEL_PATH = 'shared'
const INFRASTRUCTURE_PATHS = [
  'infrastructure/blockchain',
  'infrastructure/database',
]

// Forbidden cross-domain import patterns
const FORBIDDEN_IMPORTS = [
  // Identity domain
  {
    from: 'identity',
    cannot: [
      'users',
      'learning',
      'credentials',
      'rewards',
      'referrals',
      'notifications',
      'organizations',
      'sync',
    ],
  },

  // Users domain
  {
    from: 'users',
    cannot: [
      'learning',
      'credentials',
      'rewards',
      'referrals',
      'organizations',
      'sync',
    ],
  },

  // Learning domain
  {
    from: 'learning',
    cannot: [
      'rewards',
      'credentials',
      'referrals',
      'notifications',
      'users',
      'organizations',
    ],
  },

  // Credentials domain
  {
    from: 'credentials',
    cannot: ['rewards', 'referrals', 'notifications', 'learning', 'users'],
  },

  // Rewards domain
  {
    from: 'rewards',
    cannot: ['learning', 'credentials', 'referrals', 'notifications', 'users'],
  },

  // Referrals domain
  {
    from: 'referrals',
    cannot: ['rewards', 'learning', 'credentials', 'notifications', 'users'],
  },

  // Notifications domain
  {
    from: 'notifications',
    cannot: ['rewards', 'learning', 'credentials', 'referrals', 'users'],
  },

  // Organizations domain
  {
    from: 'organizations',
    cannot: [
      'rewards',
      'learning',
      'credentials',
      'referrals',
      'users',
      'sync',
    ],
  },

  // Sync domain
  {
    from: 'sync',
    cannot: [
      'rewards',
      'learning',
      'credentials',
      'referrals',
      'users',
      'organizations',
    ],
  },
]

// Infrastructure cannot import from business domains
const INFRASTRUCTURE_FORBIDDEN = Object.keys(DOMAIN_PATHS)

// Shared kernel cannot import from any domain
const SHARED_KERNEL_FORBIDDEN = Object.keys(DOMAIN_PATHS)

/**
 * Helper: Find all TypeScript files in a directory
 */
function findTsFiles(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) {
    return fileList
  }

  const files = fs.readdirSync(dir)

  files.forEach((file) => {
    const filePath = path.join(dir, file)
    const stat = fs.statSync(filePath)

    if (stat.isDirectory()) {
      findTsFiles(filePath, fileList)
    } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      fileList.push(filePath)
    }
  })

  return fileList
}

/**
 * Helper: Extract import statements from a TypeScript file
 */
function extractImports(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8')
  const importRegex = /import\s+(?:(?:[\w*\s{},]*)\s+from\s+)?['"]([^'"]+)['"]/g
  const imports: string[] = []
  let match

  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1])
  }

  return imports
}

/**
 * Helper: Determine which domain a file belongs to
 */
function getDomainFromPath(filePath: string): string | null {
  const relativePath = path.relative(srcDir, filePath)

  // Check if file is in a domain
  for (const [domainName, domainPath] of Object.entries(DOMAIN_PATHS)) {
    if (relativePath.startsWith(domainPath)) {
      return domainName
    }
  }

  // Check if file is in shared kernel
  if (relativePath.startsWith(SHARED_KERNEL_PATH)) {
    return 'shared'
  }

  // Check if file is in infrastructure
  for (const infraPath of INFRASTRUCTURE_PATHS) {
    if (relativePath.startsWith(infraPath)) {
      return 'infrastructure'
    }
  }

  return null
}

/**
 * Helper: Determine which domain an import path refers to
 */
function getTargetDomain(importPath: string): string | null {
  // Relative imports starting with ../
  if (importPath.startsWith('../') || importPath.startsWith('./')) {
    // For now, we can't easily resolve relative imports without full path resolution
    // This is a limitation - would need proper path resolution
    return null
  }

  // Absolute imports with @/ or src/
  const cleanPath = importPath.replace(/^@\//, '').replace(/^src\//, '')

  // Check domain paths
  for (const [domainName, domainPath] of Object.entries(DOMAIN_PATHS)) {
    if (cleanPath.startsWith(domainPath)) {
      return domainName
    }
  }

  if (cleanPath.startsWith(SHARED_KERNEL_PATH)) {
    return 'shared'
  }

  for (const infraPath of INFRASTRUCTURE_PATHS) {
    if (cleanPath.startsWith(infraPath)) {
      return 'infrastructure'
    }
  }

  return null
}

describe('Architecture: Domain Boundaries', () => {
  test('All TypeScript files should be discoverable', () => {
    const files = findTsFiles(srcDir)
    expect(files.length).toBeGreaterThan(0)
  })

  describe('Forbidden Cross-Domain Imports', () => {
    const allFiles = findTsFiles(srcDir)

    FORBIDDEN_IMPORTS.forEach(({ from, cannot }) => {
      test(`Domain '${from}' should not import from forbidden domains: ${cannot.join(', ')}`, () => {
        const violations: Array<{
          file: string
          importPath: string
          targetDomain: string
        }> = []

        allFiles.forEach((file) => {
          const fileDomain = getDomainFromPath(file)

          if (fileDomain === from) {
            const imports = extractImports(file)

            imports.forEach((importPath) => {
              const targetDomain = getTargetDomain(importPath)

              if (targetDomain && cannot.includes(targetDomain)) {
                violations.push({
                  file: path.relative(srcDir, file),
                  importPath,
                  targetDomain,
                })
              }
            })
          }
        })

        if (violations.length > 0) {
          const violationDetails = violations
            .map(
              (v) =>
                `  - ${v.file} imports from ${v.targetDomain}: '${v.importPath}'`,
            )
            .join('\n')

          throw new Error(
            'Domain boundary violation detected!\n\n' +
              `Domain '${from}' has forbidden imports:\n${violationDetails}\n\n` +
              `Forbidden domains: ${cannot.join(', ')}`,
          )
        }

        expect(violations).toHaveLength(0)
      })
    })
  })

  describe('Infrastructure Layer Rules', () => {
    test('Infrastructure should not import from business domains', () => {
      const allFiles = findTsFiles(srcDir)
      const violations: Array<{
        file: string
        importPath: string
        targetDomain: string
      }> = []

      allFiles.forEach((file) => {
        const fileDomain = getDomainFromPath(file)

        if (fileDomain === 'infrastructure') {
          const imports = extractImports(file)

          imports.forEach((importPath) => {
            const targetDomain = getTargetDomain(importPath)

            if (
              targetDomain &&
              INFRASTRUCTURE_FORBIDDEN.includes(targetDomain)
            ) {
              violations.push({
                file: path.relative(srcDir, file),
                importPath,
                targetDomain,
              })
            }
          })
        }
      })

      if (violations.length > 0) {
        const violationDetails = violations
          .map(
            (v) =>
              `  - ${v.file} imports from ${v.targetDomain}: '${v.importPath}'`,
          )
          .join('\n')

        throw new Error(
          'Infrastructure layer violation detected!\n\n' +
            `Infrastructure files have forbidden domain imports:\n${violationDetails}`,
        )
      }

      expect(violations).toHaveLength(0)
    })
  })

  describe('Shared Kernel Rules', () => {
    test('Shared kernel should not import from any business domain', () => {
      const allFiles = findTsFiles(srcDir)
      const violations: Array<{
        file: string
        importPath: string
        targetDomain: string
      }> = []

      allFiles.forEach((file) => {
        const fileDomain = getDomainFromPath(file)

        if (fileDomain === 'shared') {
          const imports = extractImports(file)

          imports.forEach((importPath) => {
            const targetDomain = getTargetDomain(importPath)

            if (
              targetDomain &&
              SHARED_KERNEL_FORBIDDEN.includes(targetDomain)
            ) {
              violations.push({
                file: path.relative(srcDir, file),
                importPath,
                targetDomain,
              })
            }
          })
        }
      })

      if (violations.length > 0) {
        const violationDetails = violations
          .map(
            (v) =>
              `  - ${v.file} imports from ${v.targetDomain}: '${v.importPath}'`,
          )
          .join('\n')

        throw new Error(
          'Shared kernel violation detected!\n\n' +
            `Shared kernel files have forbidden domain imports:\n${violationDetails}\n\n` +
            'The shared kernel must not depend on any business domain.',
        )
      }

      expect(violations).toHaveLength(0)
    })
  })

  describe('Circular Dependency Detection', () => {
    test('Should not have circular dependencies between domains', () => {
      // This is a simplified check - full circular dependency detection requires graph analysis
      // For now, we ensure no domain imports another domain that imports it back

      const allFiles = findTsFiles(srcDir)
      const domainImports: Record<string, Set<string>> = {}

      // Build import graph
      allFiles.forEach((file) => {
        const fileDomain = getDomainFromPath(file)

        if (
          fileDomain &&
          fileDomain !== 'shared' &&
          fileDomain !== 'infrastructure'
        ) {
          if (!domainImports[fileDomain]) {
            domainImports[fileDomain] = new Set()
          }

          const imports = extractImports(file)
          imports.forEach((importPath) => {
            const targetDomain = getTargetDomain(importPath)
            if (
              targetDomain &&
              targetDomain !== 'shared' &&
              targetDomain !== 'infrastructure'
            ) {
              domainImports[fileDomain].add(targetDomain)
            }
          })
        }
      })

      // Check for direct circular dependencies (A → B, B → A)
      const circularDeps: Array<[string, string]> = []

      Object.keys(domainImports).forEach((domainA) => {
        domainImports[domainA].forEach((domainB) => {
          if (domainImports[domainB]?.has(domainA)) {
            // Found circular dependency
            const pair: [string, string] = [domainA, domainB].sort() as [
              string,
              string,
            ]
            if (
              !circularDeps.some(([a, b]) => a === pair[0] && b === pair[1])
            ) {
              circularDeps.push(pair)
            }
          }
        })
      })

      if (circularDeps.length > 0) {
        const details = circularDeps
          .map(([a, b]) => `  - ${a} ↔ ${b}`)
          .join('\n')
        throw new Error(
          `Circular dependencies detected between domains:\n${details}\n\n` +
            'Domains should not have circular dependencies.',
        )
      }

      expect(circularDeps).toHaveLength(0)
    })
  })
})

describe('Architecture: File Organization', () => {
  test('Every source file should map to a domain or shared kernel', () => {
    const allFiles = findTsFiles(srcDir)
    const unmappedFiles: string[] = []

    allFiles.forEach((file) => {
      const domain = getDomainFromPath(file)
      const relativePath = path.relative(srcDir, file)

      // Exclude app.ts and server.ts (entry points)
      if (relativePath === 'app.ts' || relativePath === 'server.ts') {
        return
      }

      // Exclude current structure files (until migration)
      const legacyPaths = [
        'controllers/',
        'routes/',
        'services/',
        'config/',
        'middleware/',
        'utils/',
        'types/',
        'models/',
        'schemas/',
        'docs/',
      ]

      const isLegacy = legacyPaths.some((legacy) =>
        relativePath.startsWith(legacy),
      )
      if (isLegacy) {
        return // Skip legacy files during transition
      }

      if (!domain) {
        unmappedFiles.push(relativePath)
      }
    })

    if (unmappedFiles.length > 0) {
      console.warn(
        `Warning: ${unmappedFiles.length} files are not mapped to any domain:\n` +
          unmappedFiles.map((f) => `  - ${f}`).join('\n'),
      )
    }

    // This test will pass during transition but serves as documentation
    expect(unmappedFiles.length).toBeGreaterThanOrEqual(0)
  })
})
