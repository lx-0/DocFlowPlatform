# DocFlow Backend API

Express-based REST API for the DocFlow Platform.

## Prerequisites

- Node.js >= 18
- npm
- PostgreSQL >= 14

## Setup

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env` and set `DATABASE_URL` to your local PostgreSQL connection string:

```
DATABASE_URL="postgresql://postgres:password@localhost:5432/docflow"
```

## Database Setup

The project uses [Prisma](https://www.prisma.io/) as the ORM with PostgreSQL.

### First-time setup (development)

```bash
# Generate Prisma client
npm run db:generate

# Apply migrations to your local database
npm run db:migrate:dev
```

### Apply migrations (production / CI)

```bash
npm run db:migrate
```

### Explore data with Prisma Studio

```bash
npm run db:studio
```

## Running the Dev Server

```bash
npm run dev
```

The server starts on `http://localhost:3000` by default (configurable via `PORT` in `.env`).

## API Endpoints

| Method | Path | Description | Auth required |
|:-------|:-----|:------------|:--------------|
| `GET` | `/health` | Health check | No |
| `POST` | `/api/auth/register` | Register a new user | No |
| `POST` | `/api/auth/login` | Log in, receive JWT | No |

See [docs/api-reference.md](../docs/api-reference.md) for full request/response details.

## Project Structure

```
backend/
├── src/
│   ├── index.js             # Entry point — loads env and starts server
│   ├── app.js               # Express app setup
│   ├── db/
│   │   └── client.js        # Prisma client singleton
│   └── generated/           # Auto-generated Prisma client (do not edit)
├── prisma/
│   ├── schema.prisma        # Database schema definition
│   └── migrations/          # Migration history
├── routes/                  # Route definitions
│   ├── health.js
│   └── auth.js
├── controllers/             # Request handlers
│   ├── healthController.js
│   └── authController.js
├── middleware/
│   └── auth.js              # JWT verification middleware
├── .env.example             # Example environment variables
└── package.json
```
