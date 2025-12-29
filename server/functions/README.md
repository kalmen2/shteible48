# Express backend (Base44-compatible wrapper)

This folder contains a small Node.js/Express API that mimics the Base44 entity + integrations API *shape* used by this app.

## Run

From the repo root:

```powershell
npm install
npm run dev:server
```

- API: `http://localhost:3001/api`
- Uploaded files: `http://localhost:3001/uploads/...`

## Data

Data is stored in MongoDB.

Required env vars:
- `MONGODB_URI`
- `MONGODB_DB_NAME` (optional)
