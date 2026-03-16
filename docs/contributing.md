# Contributing to DocFlow Platform

## Prerequisites

- Node.js >= 18
- npm >= 9
- PostgreSQL >= 14
- Git

## Local Setup

1. **Clone the repository**

   ```bash
   git clone <repo-url>
   cd DocFlowPlatform
   ```

2. **Backend**

   ```bash
   cd backend
   npm install
   cp .env.example .env
   # Edit .env — set DATABASE_URL and JWT_SECRET
   npm run db:generate
   npm run db:migrate:dev
   npm run dev
   ```

3. **Frontend** (separate terminal)

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

   The frontend dev server at `http://localhost:5173` automatically proxies `/api/*` to the backend on port 3000.

## Branch Workflow

- `main` is the stable branch. All work goes through pull requests.
- Branch naming: `feat/<short-description>`, `fix/<short-description>`, `docs/<short-description>`.
- Keep branches short-lived and focused on a single concern.

## Making Changes

1. Create a branch from `main`.
2. Make your changes. Keep commits atomic and well-described.
3. Run checks locally before pushing (see below).
4. Open a pull request against `main`.

## Running Checks

**Backend**

```bash
cd backend
npm test          # run tests (when implemented)
```

**Frontend**

```bash
cd frontend
npm run lint      # ESLint
npm run build     # verify production build succeeds
npm test          # run tests (when implemented)
```

CI runs these same checks on every PR via GitHub Actions.

## Database Migrations

Add a new migration when you change `prisma/schema.prisma`:

```bash
cd backend
npm run db:migrate:dev
```

Commit both the schema change and the generated migration file. Never edit migration files after they have been merged to `main`.

## Code Style

- Follow the existing patterns in each file — no dedicated linter config beyond ESLint for the frontend yet.
- No unused imports or `console.log` statements in committed code.
- Use descriptive variable and function names.

## Commit Messages

Use the imperative present tense and reference the relevant area:

```
feat: add document upload endpoint
fix: correct JWT expiry calculation
docs: update API reference for register endpoint
chore: upgrade Prisma to v7.6
```

## Pull Requests

- Give your PR a clear title that matches the commit style above.
- Describe **what** changed and **why** in the PR body.
- Link any related issues.
- PRs require at least one approval before merge.

## Project Structure

```
DocFlowPlatform/
├── backend/        # Node.js/Express REST API
├── frontend/       # React SPA
├── docs/           # Project documentation (you are here)
└── .github/        # GitHub Actions CI workflows
```

See [docs/architecture.md](architecture.md) for a full component map and system design overview.
