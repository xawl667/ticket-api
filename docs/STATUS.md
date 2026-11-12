# Ticket API — Status Report

> Generated from code audit (commit `31cc499`). No `.env` read.

---

## 1. Exigences Yaaqoub (Partie 3) vs Code Réel

| # | Exigence | État | Fichiers concernés | Notes |
|---|----------|------|-------------------|-------|
| 1 | **Tests unitaires & d'intégration automatisés** | ❌ **Manquant** | — | Aucun fichier `*.test.ts` / `*.spec.ts`. Pas de `vitest`, `jest`, `@types/supertest`. |
| 2 | **Tests auth, permissions, accès tickets** | ❌ **Manquant** | — | Idem (1). |
| 3 | **Gestion d'erreurs centralisée + réponses API uniformes** | 🟡 **Partiel** | `src/app.ts:61-79` | Handler global présent (Zod, SyntaxError, Prisma P2025/P2002). **Manque** : format de réponse standardisé (`{ error, message, details? }` partout), classe `AppError` avec code/status, mapping 413 pour body trop gros (actuellement 500). |
| 4 | **Pagination, filtrage, tri sur liste tickets** | ❌ **Manquant** | `src/modules/tickets/{service,controller,routes}.ts`, `src/shared/schema.ts` | `GET /tickets` renvoie `Ticket[]` brut. Prévu : réponse `{ data: Ticket[], meta: { page, limit, total, totalPages } }` + query `page`, `limit`, `sortBy`, `sortOrder`, `status`. |
| 5 | **Protection brute-force / requêtes excessives** | 🟡 **Partiel** | `src/app.ts:24-49` | Rate limiting `express-rate-limit` configuré sur endpoints sensibles (login, forgot, reset, invite, refresh). **Non testé** (étape 9). Désactivable via `RATE_LIMIT_ENABLED`. |
| 6 | **Prévention injection SQL + validation entrées** | ✅ **Fait** | Partout (`schema.ts` strict, Prisma ORM) | Zod `.strict()` sur tous les inputs. Prisma = requêtes paramétrées. Pas de raw SQL. |
| 7 | **Audit logs (changements rôle, désactivation compte)** | ❌ **Manquant** | — | **Aucun endpoint ne change les rôles** (création user avec rôle fixe, pas de PATCH `/users/:id/role`). Désactivation/réactivation user (`disableUser`, `enableUser`) non loggées. Il faut : modèle `AuditLog`, middleware/service d'audit, endpoint `PATCH /users/:id/role` (SUPER_ADMIN). |
| 8 | **Documentation Swagger / OpenAPI** | ❌ **Manquant** | — | Pas de `swagger-jsdoc`, `@nestjs/swagger`, `swagger-ui-express`. |
| 9 | **CI GitHub Actions (tests à chaque push)** | ❌ **Manquant** | — | Pas de `.github/workflows/ci.yml`. |

---

## 2. Décisions Architecturales (non négociables)

| Décision | Justification |
|----------|---------------|
| **Refresh token dans le body** (pas cookie) | Choix explicite : stateless, pas de CSRF, compatible mobile/SPA. |
| **JWT HS256, secret ≥ 32 chars, access 15min / refresh 7j** | Choix de conception (symétrique, simple, pas de gestion de paires de clés). |
| **Matrice RBAC = hypothèses par défaut** | Non confirmée par Yaaqoub. Actuelle : SUPER_ADMIN tout, ADMIN users+read tickets, AGENT tickets status, USER own tickets (404 sinon). |
| **`createdById` nullable sur `Ticket`** | Permet tickets créés par système / migration. |
| **GET `/tickets` → pagination `{ data, meta }`** | Décidé. Implémentation future (Pass C). |

---

## 3. Points Ouverts / Dettes Techniques

| Point | Impact | Fichier / Action |
|-------|--------|------------------|
| **Body trop gros → 500 au lieu de 413** | Express `json({ limit: '10kb' })` lève erreur non gérée → handler global → 500. | Ajouter middleware `express.json()` error handler dédié **avant** routes, ou `app.use((err, req, res, next) => { if (err.type === 'entity.too.large') return res.status(413)... })`. |
| **Fichiers `tmp-*` et compte `testuser@example.com` à supprimer** | Livraison. | `tmp-create-user.ts`, `tmp-expire-invitation.ts` introuvables dans le repo (déjà supprimés ?). Vérifier en base si `testuser@example.com` existe et le supprimer. |
| **Rate limiting en mémoire** | Ne persiste pas Across redémarrages, pas partagé entre instances. | Accepté pour v1. Documenté dans README. |
| **Pas de vérification email avant activation** | Invitation = activation. | Accepté pour v1. |
| **Pas de MFA / 2FA** | | Accepté pour v1. |
| **Pas de tests automatisés** | Bloquant pour CI. | Pass B. |

---

## 4. Plan d'Action — 3 Passes

### **Pass B — Infrastructure de Tests + Suite d'Intégration (Existant)**

**Objectif** : Pouvoir lancer `npm test` et avoir une suite verte qui valide l'existant (auth, users, tickets, RBAC).

| Tâche | Détail |
|-------|--------|
| **B1. Dépendances test** | `npm i -D vitest supertest @types/supertest @vitest/coverage-v8` |
| **B2. Config `vitest.config.ts`** | `test` environment `node`, `setupFiles: ['./tests/setup.ts']`, `pool: 'forks'` (isolation Prisma). |
| **B3. Base de test séparée** | `docker compose` → `tickets_test` sur port 5434. `.env.test` avec `DATABASE_URL=postgresql://user:pass@localhost:5434/tickets_test`, `RATE_LIMIT_ENABLED=false`, `NODE_ENV=test`, `JWT_SECRET=test-secret-min-32-chars-abcdefghijklmnop`. |
| **B4. Garde-fou `DATABASE_URL`** | Dans `tests/setup.ts` : `if (!process.env.DATABASE_URL?.endsWith('_test')) throw new Error('REFUS: DATABASE_URL doit finir par _test')`. |
| **B5. Mock `sendEmail`** | `vi.mock('../../src/shared/email')` → capture tokens invitation/reset dans variable de test pour les réutiliser. |
| **B6. Helpers** | `createTestUser(role)`, `loginAs(role)`, `createTicketAs(user)`, `expectForbidden()`, `expectNotFound()`. |
| **B7. Suite intégration** | Fichiers : `tests/auth.test.ts`, `tests/users.test.ts`, `tests/tickets.test.ts`, `tests/rbac.test.ts`. Couverture : login, refresh, logout, me, invitation, accept, forgot, reset, disable/enable, CRUD tickets, visibilité USER vs ADMIN/AGENT, 403/404. |
| **B8. Rate limit test dédié** | `tests/rate-limit.test.ts` avec `RATE_LIMIT_ENABLED=true` (fichier `.env.test.ratelimit` chargé seulement pour ce fichier). |
| **B9. Scripts `package.json`** | `"test": "vitest run", "test:watch": "vitest", "test:coverage": "vitest run --coverage"` |
| **B10. Rapport final** | La sortie `vitest` réelle (stdout/stderr) fait foi. |

> **Règles strictes B** : Jamais toucher à `.env` ni à la base de dev. `DATABASE_URL` se termine par `_test`. `sendEmail` mocké. Rate limit OFF par défaut.

---

### **Pass C — Erreurs Uniformes + 413, Pagination/Filtre/Tri, Audit Logs + Role Change, avec Tests**

| Tâche | Détail |
|-------|--------|
| **C1. Format d'erreur unifié** | Classe `AppError extends Error { constructor(public statusCode: number, public code: string, message: string) }`. Codes : `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `INTERNAL_ERROR`. |
| **C2. Middleware 413** | Dans `app.ts` **avant** routes : `app.use((err, req, res, next) => { if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' }); next(err); })`. |
| **C3. Pagination tickets** | `listQuerySchema` étendu : `page: z.coerce.number().int().positive().default(1)`, `limit: z.coerce.number().int().positive().max(100).default(20)`, `sortBy: z.enum(['createdAt','title','status']).default('createdAt')`, `sortOrder: z.enum(['asc','desc']).default('desc')`, `status` optionnel. Service → `findMany` + `count` → réponse `{ data, meta: { page, limit, total, totalPages } }`. |
| **C4. Modèle `AuditLog`** | `prisma/schema.prisma` : `model AuditLog { id, action, entityType, entityId, actorId, beforeJson, afterJson, createdAt }`. Index sur `(entityType, entityId)`, `(actorId)`. |
| **C5. Service d'audit** | `audit.log({ action, entityType, entityId, actorId, before?, after? })` appelé dans : `disableUser`, `enableUser`, **nouveau** `changeUserRole`. |
| **C6. Endpoint `PATCH /users/:id/role`** | SUPER_ADMIN seulement. Body `{ role: 'ADMIN'|'AGENT'|'USER' }` (pas SUPER_ADMIN). Validation : ne pas rétrograder le dernier SUPER_ADMIN actif. Audit log `action: 'ROLE_CHANGED'`. |
| **C7. Tests Pass C** | Étendre suites : erreur 413, pagination (page/limit/sort), filtres combinés, audit logs présents en base après disable/enable/role-change, endpoint role-change (403 si pas SUPER_ADMIN, 400 si dernier SUPER_ADMIN, 200 OK). |

---

### **Pass D — Swagger, CI, README Final, Rapport Final**

| Tâche | Détail |
|-------|--------|
| **D1. OpenAPI/Swagger** | `npm i swagger-jsdoc swagger-ui-express @types/swagger-ui-express`. JSDoc sur routes/controllers → `GET /docs` UI, `GET /docs.json` spec. |
| **D2. GitHub Actions CI** | `.github/workflows/ci.yml` : `ubuntu-latest`, Node 22, `docker compose up -d db_test`, `npm ci`, `npx prisma migrate deploy`, `npm test`. Artefact coverage. |
| **D3. README final** | Relire, corriger, ajouter section "Tests", "CI", "Audit Logs", "Pagination", "Swagger". Supprimer références aux `tmp-*` si déjà partis. |
| **D4. Nettoyage livraison** | Vérifier suppression `testuser@example.com` en base. `git rm` éventuels fichiers temporaires oubliés. |
| **D5. Rapport final** | `docs/FINAL_REPORT.md` : résumé passes B/C/D, métriques tests, couverture, décisions, limites connues. |

---

## 5. Commandes Utiles (Rappel)

```bash
# Dev
docker compose up -d
cp .env.example .env   # éditer
npx prisma migrate dev
npm run seed
npm run dev

# Test (Pass B)
cp .env.example .env.test   # modifier DATABASE_URL → _test, RATE_LIMIT_ENABLED=false
docker compose -f docker-compose.test.yml up -d   # ou adapter docker-compose.yml
npm test

# Migration prod
npx prisma migrate deploy
```

---

*Document généré automatiquement — ne pas éditer à la main, mettre à jour via le processus de passes B/C/D.*