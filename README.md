# Ticket API

API REST pour la gestion de tickets de support avec authentification complète, RBAC, invitations, réinitialisation de mot de passe, audit logs et pagination.

## Prérequis

- Node.js 22+
- PostgreSQL 16 (via Docker)
- npm

## Installation

```bash
# 1. Cloner et installer les dépendances
cd ticket-api
npm install

# 2. Démarrer PostgreSQL
docker compose up -d

# 3. Configurer l'environnement
cp .env.example .env
# Éditer .env avec vos valeurs (notamment JWT_SECRET, RESEND_API_KEY, etc.)

# 4. Appliquer la migration
npx prisma migrate deploy

# 5. Créer le Super Admin initial
npm run seed
# IMPORTANT : Retirez SEED_SUPER_ADMIN_PASSWORD de votre .env après exécution !

# 6. Lancer l'API en développement
npm run dev
# API disponible sur http://localhost:3000
```

## Variables d'environnement

| Variable | Description | Défaut | Requis |
|----------|-------------|--------|--------|
| `DATABASE_URL` | URL PostgreSQL | `postgresql://user:pass@localhost:5433/tickets` | Oui |
| `NODE_ENV` | Environnement | `development` | Non |
| `PORT` | Port HTTP | `3000` | Non |
| `JWT_SECRET` | Secret pour signer les JWT (min 32 caractères) | - | Oui |
| `JWT_ISSUER` | Issuer des JWT | `ticket-api` | Non |
| `JWT_AUDIENCE` | Audience des JWT | `ticket-api` | Non |
| `APP_URL` | URL publique de l'application (pour liens email) | `http://localhost:3000` | Non |
| `RESEND_API_KEY` | Clé API Resend (format `re_...`) | - | Prod seulement |
| `EMAIL_FROM` | Expéditeur des emails | `onboarding@resend.dev` | Non |
| `RATE_LIMIT_ENABLED` | Activer le rate limiting | `true` | Non |
| `ENABLE_DOCS` | Activer `/docs` (Swagger UI) et `/openapi.json` | `false` | Non |
| `SEED_SUPER_ADMIN_EMAIL` | Email du Super Admin initial | - | Pour seed seulement |
| `SEED_SUPER_ADMIN_PASSWORD` | Mot de passe du Super Admin initial (min 12 caractères) | - | Pour seed seulement |

> En production : `RESEND_API_KEY` et `APP_URL` (HTTPS) sont obligatoires. `EMAIL_FROM` doit être un email vérifié sur votre domaine Resend.

## Rôles et permissions

### Matrice des permissions (hypothèses par défaut)

| Action | SUPER_ADMIN | ADMIN | AGENT | USER |
|--------|-------------|-------|-------|------|
| Créer / inviter un utilisateur | ✅ | ❌ | ❌ | ❌ |
| Désactiver / réactiver un utilisateur | ✅ | ❌ | ❌ | ❌ |
| Changer le rôle d'un utilisateur | ✅ | ❌ | ❌ | ❌ |
| Lister les utilisateurs | ✅ | ✅ | ❌ | ❌ |
| Voir les audit logs | ✅ | ❌ | ❌ | ❌ |
| Créer un ticket | ✅ | ✅ | ✅ | ✅ |
| Voir tous les tickets | ✅ | ✅ | ✅ | ❌ (siens seulement) |
| Voir un ticket par ID | ✅ | ✅ | ✅ | Siens seulement (404 sinon) |
| Changer le statut d'un ticket | ✅ | ✅ | ✅ | ❌ |

> **Note** : Cette matrice reflète les hypothèses par défaut implémentées dans le code. Elle peut être ajustée selon les besoins métier.
>
> **Question ouverte** : Un SUPER_ADMIN peut-il promouvoir un autre utilisateur en SUPER_ADMIN ? Actuellement non (le schéma `changeRoleSchema` n'accepte que `ADMIN`, `AGENT`, `USER`). À confirmer avec Yaaqoub.

## Endpoints

### Authentification

| Méthode | Route | Rôle requis | Body | Réponses |
|---------|-------|-------------|------|----------|
| POST | `/auth/login` | Public | `{ email, password }` | 200 `{ accessToken, refreshToken }`, 401 |
| POST | `/auth/refresh` | Public | `{ refreshToken }` | 200 `{ accessToken, refreshToken }`, 401 |
| POST | `/auth/logout` | Public | `{ refreshToken }` | 200 `{ success: true }` |
| POST | `/auth/forgot-password` | Public | `{ email }` | 200 (toujours, anti-énumération) |
| POST | `/auth/reset-password` | Public | `{ token, password }` | 204, 400 |
| POST | `/auth/accept-invitation` | Public | `{ token, password }` | 204, 400 |
| GET | `/auth/me` | Authentifié | - | 200 `{ id, email, role, status, createdAt }`, 401 |

### Utilisateurs (protégés par `authenticate`)

| Méthode | Route | Rôle requis | Body | Réponses |
|---------|-------|-------------|------|----------|
| POST | `/users` | SUPER_ADMIN | `{ email, role? }` | 201 `{ id, email, role, status, createdAt }`, 409, 403 |
| GET | `/users` | SUPER_ADMIN, ADMIN | - | 200 `[{ id, email, role, status, createdAt }]`, 403 |
| PATCH | `/users/:id/disable` | SUPER_ADMIN | - | 200 `{ id, email, role, status }`, 400, 404, 403 |
| PATCH | `/users/:id/enable` | SUPER_ADMIN | - | 200 `{ id, email, role, status }`, 400, 404, 403 |
| PATCH | `/users/:id/role` | SUPER_ADMIN | `{ role }` | 200 `{ id, email, role, status, createdAt }`, 400, 404, 403 |

> Le body de `POST /users` accepte `role` optionnel (défaut `USER`). Valeurs : `ADMIN`, `AGENT`, `USER`. `SUPER_ADMIN` ne peut pas être créé via cette route.
>
> `PATCH /users/:id/role` : valeurs acceptées `ADMIN`, `AGENT`, `USER`. Ne peut pas changer son propre rôle. Ne peut pas rétrograder le dernier SUPER_ADMIN actif. Crée un audit log `ROLE_CHANGED` avec metadata `{ previousRole, newRole }`.

### Tickets (protégés par `authenticate`)

| Méthode | Route | Rôle requis | Body / Query | Réponses |
|---------|-------|-------------|--------------|----------|
| POST | `/tickets` | Tous (authentifié) | `{ title, description }` | 201 `{ ticket }`, 400, 401 |
| GET | `/tickets` | Tous (authentifié) | `?status=&page=&limit=&sort=&order=` | 200 `{ data, meta }`, 400, 401 |
| GET | `/tickets/:id` | Tous (authentifié) | - | 200 `{ ticket }`, 404, 401 |
| PATCH | `/tickets/:id/status` | SUPER_ADMIN, ADMIN, AGENT | `{ status }` | 200 `{ ticket }`, 400, 403, 404, 401 |

> **Visibilité** : SUPER_ADMIN, ADMIN, AGENT voient tous les tickets (y compris ceux sans créateur `createdById: null`). USER ne voit que ses propres tickets (`createdById = user.id`) → 404 si ticket d'un autre.
> **Création** : `createdById` est automatiquement défini sur l'utilisateur authentifié, jamais lu depuis le body.
> **Pagination** : `GET /tickets` retourne `{ data: Ticket[], meta: { page, limit, total, totalPages } }`.
> - `page` : défaut 1, minimum 1
> - `limit` : défaut 20, maximum 100 (valeurs > 100 sont plafonnées à 100)
> - `sort` : `createdAt` | `updatedAt` | `status` (défaut `createdAt`)
> - `order` : `asc` | `desc` (défaut `desc`)
> - `status` : `OPEN` | `IN_PROGRESS` | `RESOLVED` | `CLOSED`
> - Paramètres invalides (ex: `page=0`, `sort=passwordHash`, `order=x`, paramètre inconnu) → 400

### Audit Logs (protégés par `authenticate` + `requireRole("SUPER_ADMIN")`)

| Méthode | Route | Rôle requis | Query | Réponses |
|---------|-------|-------------|-------|----------|
| GET | `/audit-logs` | SUPER_ADMIN | `?action=&actorId=&targetType=&targetId=&page=&limit=&sortBy=&sortOrder=` | 200 `{ data, meta }`, 401, 403 |

> **Actions auditées** : `USER_INVITED`, `INVITATION_ACCEPTED`, `USER_DISABLED`, `USER_ENABLED`, `ROLE_CHANGED`, `PASSWORD_RESET_COMPLETED`.
> **Pagination** : même format que `/tickets` (`page`, `limit` max 100, `sortBy=createdAt`, `sortOrder=asc|desc`).
> **Filtres** : `action`, `actorId`, `targetType`, `targetId`.
> **Sécurité** : aucun champ sensible (token, mot de passe, hash, email) dans `metadata` ni dans la réponse.

## Format d'erreur unifié

Toutes les erreurs retournent `{ "error": "message" }`.

| Code | Situation | Exemple `error` |
|------|-----------|-----------------|
| 400 | Validation Zod échouée | `"Validation failed"` |
| 400 | Paramètres invalides (pagination, etc.) | `"Validation failed"` |
| 401 | Non authentifié / token invalide / utilisateur DISABLED | `"Unauthorized"` |
| 401 | Identifiants invalides | `"Invalid credentials"` |
| 403 | Rôle insuffisant | `"Forbidden"` |
| 404 | Ressource non trouvée (ou accès refusé USER) | `"Not found"` |
| 409 | Conflit unicité (email, etc.) | `"Conflict"` |
| 413 | Body > 10kb | `"Payload too large"` |
| 429 | Rate limit dépassé | `"Too many login attempts"` / `"Too many requests"` |
| 500 | Erreur interne | `"Internal server error"` |

Les erreurs de validation Zod incluent aussi `details: ZodIssue[]`.

## Documentation OpenAPI / Swagger UI

- **Spécification** : écrite à la main dans `src/openapi.ts` (pas de génération automatique).
- **Endpoints** :
  - `GET /openapi.json` — Spécification OpenAPI 3.0.3 brute
  - `GET /docs` — Interface Swagger UI interactive
- **Activation** : variable `ENABLE_DOCS=true` (défaut `false`).
  - En développement : mettre `ENABLE_DOCS=true` dans `.env` pour tester.
  - En production : laisser `false` sauf besoin explicite.
- **Helmet CSP** : assouplie automatiquement sur `/docs` quand `ENABLE_DOCS=true` (scripts/styles inline autorisés pour Swagger UI), inchangée ailleurs.

## Tests

### Lancer les tests (base de test isolée)

```bash
# 1. Créer .env.test (copier .env.example, modifier)
#    DATABASE_URL=postgresql://user:pass@localhost:5434/tickets_test
#    RATE_LIMIT_ENABLED=false
#    NODE_ENV=test
#    JWT_SECRET=test-secret-min-32-chars-abcdefghijklmnop

# 2. Lancer base test (port 5434)
docker run -d --name pg_test -e POSTGRES_USER=user -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=tickets_test -p 5434:5432 postgres:16

# 3. Migrer base test
DATABASE_URL=postgresql://user:pass@localhost:5434/tickets_test npx prisma migrate deploy

# 4. Lancer tests
npm test
```

### Garde-fous

- `tests/setup.ts` charge `.env.test` **avant** tout import applicatif.
- Vérifie que `DATABASE_URL` finit par `_test` → refuse de tourner sinon.
- Vérifie `NODE_ENV=test`, `JWT_SECRET >= 32 chars`, `RATE_LIMIT_ENABLED` défini.
- `sendEmail` mocké (aucune email réel envoyé).
- `truncateTestDatabase()` vide toutes les tables entre chaque `beforeEach`.
- Les tests tournent en **single thread** (`vitest.config.ts`) pour éviter les conditions de course sur la base.

### Couverture actuelle (418 tests)

- Auth : login, refresh (rotation + détection vol), logout, forgot/reset password, accept-invitation, me
- Users : créer (SUPER_ADMIN), lister, désactiver, réactiver, changer rôle
- Tickets : CRUD + visibilité RBAC + pagination/tri/filtre
- Audit logs : création pour 6 actions, pas de log sur échec, pas de données sensibles, atomicité, endpoint GET
- Injection/validation : null bytes, SQL/XSS/NoSQL/LFI/STTI payloads acceptés comme texte, body > 10kb = 413, Zod `.strict()` rejette champs en trop
- Rate limiting : 10 req/15min sur endpoints sensibles, 30 req/15min sur refresh
- OpenAPI coverage : test bidirectionnel (toutes routes de l'app dans la spec, et vice-versa)

## CI / GitHub Actions

Workflow `.github/workflows/ci.yml` déclenché sur **push** et **pull_request** vers `main` :

1. `ubuntu-latest`, Node 22, cache npm
2. Service `postgres:16` avec healthcheck
3. `npm ci` → `npx prisma generate` → `npx prisma migrate deploy` (sur `tickets_test`)
4. `npx tsc --noEmit`
5. `npm test`

**Variables d'environnement CI** : toutes factices (pas de vrais secrets). `DATABASE_URL` finit par `_test` pour satisfaire le garde-fou.

### Vérifier la CI

1. Poussez sur GitHub (`git push origin main` ou ouvrez une PR).
2. Allez dans l'onglet **Actions** du dépôt.
3. Le workflow "CI" doit apparaître, cliquer sur le run.
4. Vérifier que les 5 étapes (Install, Generate, Migrate, TypeScript, Test) passent en vert.
5. Si échec : regarder les logs de l'étape qui a échoué.

## Commandes utiles

```bash
# Typecheck
npx tsc --noEmit

# Migration DB
npx prisma migrate dev --name <nom>

# Studio Prisma
npx prisma studio

# Seed Super Admin (idempotent)
npm run seed

# Dev avec hot reload
npm run dev
```

## Architecture

```
src/
+-- app.ts              # Express app, middleware globaux, rate limiting, Swagger
+-- index.ts            # Bootstrap, validation env au démarrage
+-- env.ts              # Validation Zod des variables d'environnement
+-- prisma.ts           # Client Prisma singleton
+-- schema.ts           # Schémas Zod (strict) pour tous les inputs
+-- email.ts            # Envoi emails via Resend (dev: console)
+-- openapi.ts          # Spécification OpenAPI 3.0.3 + setup Swagger UI
+-- auth/
|   +-- tokens.ts       # JWT access + refresh token utils
|   +-- passwords.ts    # bcrypt hash/verify + dummy hash
|   +-- middleware.ts   # authenticate + requireRole
|   +-- service.ts      # Logique auth (login, refresh, reset, invite)
|   +-- controller.ts   # Handlers /auth/*
|   +-- routes.ts       # Router /auth
+-- users/
|   +-- service.ts      # Logique users (create, disable, enable, changeRole)
|   +-- controller.ts   # Handlers /users/*
|   +-- routes.ts       # Router /users
+-- tickets/
|   +-- service.ts      # Logique tickets (CRUD + pagination/filtre/tri + RBAC)
|   +-- controller.ts   # Handlers /tickets/*
|   +-- routes.ts       # Router /tickets
+-- audit/
|   +-- service.ts      # Logique audit (create, get paginé/filtré/trié)
|   +-- controller.ts   # Handler GET /audit-logs
|   +-- routes.ts       # Router /audit-logs
```

## Choix de sécurité et justifications

| Choix | Justification |
|-------|---------------|
| **JWT HS256 + secret 32+ chars** | Choix de conception (pas exigence du sujet). Symétrique, simple, pas de gestion de paires de clés. Secret long = résistance brute-force. |
| **Algorithme fixé à `["HS256"]`** | Prévention attaque "alg: none" et confusion RS256/HS256. |
| **Issuer + Audience vérifiés** | Token non réutilisable sur autre service. |
| **Access token 15 min, claims `sub` + `role`** | Court TTL = fenêtre d'exploitation réduite. Pas de données sensibles dans le token. |
| **Refresh token : `randomBytes(32)` hex, SHA-256 stocké, 7 jours** | Entropie forte, pas de secret en base. Rotation à chaque refresh. |
| **Famille de refresh tokens + révocation complète sur réutilisation** | Détection de vol de token : si un ancien token est réutilisé, toute la famille est révoquée. |
| **Rotation atomique en transaction** | `updateMany(revokedAt=null)` + count check = pas de race condition. |
| **bcryptjs coût 12** | Coût élevé = lent, résistant GPU. Pas de dépendance native. |
| **Hash factice bcrypt coût 12 pour anti-énumération login** | Même temps de réponse user inconnu / mauvais pwd / compte inactif. |
| **Réponse 200 identique sur forgot-password** | Anti-énumération : impossible de savoir si un email existe. |
| **Consommation atomique tokens (updateMany conditionnel)** | `count !== 1` ? 400 générique. Pas de race condition, usage unique garanti. |
| **Rôle revérifié en base à chaque requête (`authenticate`)** | Token valide mais user désactivé ? 401 immédiat. Pas d'élévation via token modifié. |
| **USER voit ses tickets en 404 (pas 403)** | Pas de fuite d'existence de tickets d'autres utilisateurs. |
| **Rate limiting par IP sur endpoints sensibles** | 10 req/15min login/forgot/reset/invite, 30 req/15min refresh. Configurable via `RATE_LIMIT_ENABLED`. |
| **Helmet + `x-powered-by` désactivé + body limit 10kb** | Headers sécurisés, pas de fuite version, DoS basique limité. |
| **Trust proxy conditionnel (`NODE_ENV === production`)** | En dev : IP directe. En prod derrière reverse proxy : header `X-Forwarded-For` fiable. |
| **Zod `.strict()` sur tous les inputs** | Rejet champs inattendus (ex: `role` dans login). |
| **Select explicite sans `passwordHash`** | Fuite impossible dans réponses. |
| **Pas de token/mot de passe/email dans les logs** | Seuls messages d'erreur génériques loggués. |
| **Gestion erreurs Prisma : P2025→404, P2002→409 génériques** | Pas de fuite "email déjà utilisé" ou "ticket non trouvé" précis. |
| **SEED_SUPER_ADMIN_PASSWORD retiré après seed** | Secret temporaire seulement. |

## Limites connues

- Pas de vérification d'email avant activation (invitation = activation)
- Pas de MFA / 2FA
- Pas de gestion de sessions multiples par utilisateur (famille unique par login)
- Rate limiting en mémoire (pas de store Redis) : ne persiste pas Across redémarrages, pas partagé entre instances
- Resend sans domaine vérifié : envoi possible uniquement vers l'email du compte Resend (limitation Resend, pas du code)