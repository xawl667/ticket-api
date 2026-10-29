# Support Ticket API

API REST de gestion de tickets de support. Stack : Node.js, Express, TypeScript, PostgreSQL, Prisma.

## Prérequis
- Node.js 18+
- Docker Desktop

## Installation
```bash
npm install
cp .env.example .env
docker compose up -d
npx prisma migrate dev
npm run dev
```
L'API tourne sur http://localhost:3000

## Endpoints

| Méthode | Route | Description |
|---|---|---|
| POST | /tickets | Créer un ticket (`title`, `description`) |
| GET | /tickets | Lister les tickets (filtre `?status=OPEN`) |
| GET | /tickets/:id | Récupérer un ticket |
| PATCH | /tickets/:id/status | Modifier le statut |

Statuts : `OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`

## Exemple
```bash
curl -X POST http://localhost:3000/tickets \
  -H "Content-Type: application/json" \
  -d '{"title":"Bug login","description":"Impossible de me connecter"}'
```
