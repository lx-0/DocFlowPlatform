# DocFlow Frontend

React + Vite frontend for the DocFlow Platform.

## Prerequisites

- Node.js >= 18
- Backend API running on port 3000 (see `../backend/README.md`)

## Setup

```bash
cd frontend
npm install
```

## Development

```bash
npm run dev
```

The dev server starts at <http://localhost:5173>. API requests to `/api/*` are proxied to the backend at `http://localhost:3000`.

## Build

```bash
npm run build
```

Output goes to `dist/`. Serve it with `npm run preview` for a local production preview.

## Project Structure

```
frontend/
├── src/
│   ├── pages/
│   │   ├── Login.jsx       # Sign-in page
│   │   └── Dashboard.jsx   # Main dashboard stub
│   ├── App.jsx             # Router and route definitions
│   ├── main.jsx            # React entry point
│   └── index.css           # Global styles
├── index.html
└── vite.config.js          # Vite config + API proxy
```

## Routes

| Path         | Component   | Description          |
|:-------------|:------------|:---------------------|
| `/login`     | `Login`     | Email/password login |
| `/dashboard` | `Dashboard` | Main dashboard stub  |
| `/`          | —           | Redirects to `/dashboard` |
