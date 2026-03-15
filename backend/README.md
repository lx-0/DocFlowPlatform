# DocFlow Backend API

Express-based REST API for the DocFlow Platform.

## Prerequisites

- Node.js >= 18
- npm

## Setup

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env` to set your environment variables (defaults work for local dev).

## Running the Dev Server

```bash
npm run dev
```

The server starts on `http://localhost:3000` by default (configurable via `PORT` in `.env`).

## Health Check

```
GET /health
```

Returns `200 OK` with `{ "status": "ok" }` when the server is running.

## Project Structure

```
backend/
├── src/
│   ├── index.js         # Entry point — loads env and starts server
│   └── app.js           # Express app setup
├── routes/              # Route definitions
│   └── health.js
├── controllers/         # Request handlers
│   └── healthController.js
├── models/              # Data models
├── middleware/          # Custom middleware
├── config/              # Configuration files
├── .env.example         # Example environment variables
└── package.json
```
