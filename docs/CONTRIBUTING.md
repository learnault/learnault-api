# Contributing to Learnault

First off, thank you for considering contributing to Learnault! It's people like you that make Learnault such a great tool for education and financial inclusion.

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the issue list as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples** (e.g., screenshots, code snippets)
- **Describe the behavior you observed vs what you expected**
- **Include details about your environment** (browser, device, OS)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

- **A clear and descriptive title**
- **A detailed description of the proposed feature**
- **Explain why this enhancement would be useful** to most users
- **Provide examples** of how it would work

### Your First Code Contribution

Unsure where to start? Look for issues labeled `good-first-issue` or `help-wanted`. These are specifically curated for newcomers.

### Pull Requests

1. Fork the repository
2. Create a new branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`pnpm test`)
5. Commit your changes (`git commit -m 'Add some amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## Development Setup

### 1. Fork & Clone

```bash
git clone https://github.com/toneflix/learnault.git
cd learnault
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Set Up Environment

```bash
# Copy environment templates
cp packages/api/.env.example packages/api/.env
cp packages/app/.env.example packages/app/.env

# Edit with your local values
```

### 4. Run Development

```bash
# Start all services
pnpm dev

# Or run specific package
pnpm --filter api dev
pnpm --filter app dev
pnpm --filter contracts build
```

## Coding Guidelines

### TypeScript Style

- Use TypeScript for all new code
- Enable strict mode in tsconfig
- Define interfaces for all data structures
- Avoid `any` type

### Testing

- Write tests for new features
- Maintain or improve coverage
- Run tests before committing

```bash
pnpm test
```

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation only
- `style:` Code style changes
- `refactor:` Code refactoring
- `test:` Adding tests
- `chore:` Maintenance

Example: `feat(api): add user wallet creation endpoint`

### Branch Naming

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation
- `refactor/` - Code refactoring
- `test/` - Testing

## Package Structure

### Smart Contracts (`packages/contracts/`)

- Rust code with Soroban SDK
- Unit tests in same file with `#[test]`
- Integration tests in `tests/`
- Follow Rust naming conventions

### API (`packages/api/`)

- RESTful endpoints
- Input validation using Zod or similar
- Error handling with consistent format
- Database migrations in `prisma/`

### Frontend (`packages/app/`)

- Functional components with hooks
- Tailwind CSS for styling
- State management with Redux Toolkit
- Responsive, mobile-first design

## Review Process

1. All PRs require at least one review
2. CI checks must pass
3. No merge conflicts
4. Documentation updated if needed
5. Tests added/updated

## Community

- Join our [Discord](https://discord.gg) for real-time chat

## Recognition

Contributors will be:

- Listed in the README
- Mentioned in release notes
- Eligible for contributor rewards program

Thank you for contributing!
