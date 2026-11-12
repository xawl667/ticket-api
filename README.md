# Support Ticket API

API REST pour la gestion de tickets de support avec authentification complète, RBAC, et gestion des invitations/réinitialisations de mot de passe.

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

# 3. Configurer l environnement
cp .env.example .env
# Éditer .env avec vos valeurs (notamment JWT_SECRET, RESEND_API_KEY, etc.)

# 4. Appliquer la migration
npx prisma migrate dev --name init

# 5. Créer le Super Admin initial
npm run seed
# IMPORTANT : Retirez SEED_SUPER_ADMIN_PASSWORD de votre .env après exécution !

# 6. Lancer l API en développement
npm run dev
# API disponible sur http://localhost:3000
```

## Variables d environnement

| Variable | Description | Défaut | Requis |
|----------|-------------|--------|--------|
| `DATABASE_URL` | URL PostgreSQL | `postgresql://user:pass@localhost:5433/tickets` | Oui |
| `NODE_ENV` | Environnement | `development` | Non |
| `PORT` | Port HTTP | `3000` | Non |
| `JWT_SECRET` | Secret pour signer les JWT (min 32 caractères) | - | Oui |
| `JWT_ISSUER` | Issuer des JWT | `ticket-api` | Non |
| `JWT_AUDIENCE` | Audience des JWT | `ticket-api` | Non |
| `APP_URL` | URL publique de l application (pour liens email) | `http://localhost:3000` | Non |
| `RESEND_API_KEY` | Clé API Resend (format `re_...`) | - | Prod seulement |
| `EMAIL_FROM` | Expéditeur des emails | `onboarding@resend.dev` | Non |
| `RATE_LIMIT_ENABLED` | Activer le rate limiting | `true` | Non |
| `SEED_SUPER_ADMIN_EMAIL` | Email du Super Admin initial | - | Pour seed seulement |
| `SEED_SUPER_ADMIN_PASSWORD` | Mot de passe du Super Admin initial (min 12 caractères) | - | Pour seed seulement |

> En production : `RESEND_API_KEY` et `APP_URL` (HTTPS) sont obligatoires. `EMAIL_FROM` doit être un email vérifié sur votre domaine Resend.

## Rôles et permissions

### Matrice des permissions (hypothèses par défaut)

| Action | SUPER_ADMIN | ADMIN | AGENT | USER |
|--------|-------------|-------|-------|------|
| Créer / inviter un utilisateur | ? | ? | ? | ? |
| Désactiver / réactiver un utilisateur | ? | ? | ? | ? |
| Lister les utilisateurs | ? | ? | ? | ? |
| Créer un ticket | ? | ? | ? | ? |
| Voir tous les tickets | ? | ? | ? | ? (siens seulement) |
| Voir un ticket par ID | ? | ? | ? | Siens seulement (404 sinon) |
| Changer le statut d un ticket | ? | ? | ? | ? |

> **Note** : Cette matrice reflète les hypothèses par défaut implémentées dans le code. Elle peut être ajustée selon les besoins métier.

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

> Le body de `POST /users` accepte `role` optionnel (défaut `USER`). Valeurs : `ADMIN`, `AGENT`, `USER`. `SUPER_ADMIN` ne peut pas être créé via cette route.

### Tickets (protégés par `authenticate`)

| Méthode | Route | Rôle requis | Body | Réponses |
|---------|-------|-------------|------|----------|
| POST | `/tickets` | Tous (authentifié) | `{ title, description }` | 201 `{ ticket }`, 400, 401 |
| GET | `/tickets` | Tous (authentifié) | `?status=` optionnel | 200 `[tickets]`, 401 |
| GET | `/tickets/:id` | Tous (authentifié) | - | 200 `{ ticket }`, 404, 401 |
| PATCH | `/tickets/:id/status` | SUPER_ADMIN, ADMIN, AGENT | `{ status }` | 200 `{ ticket }`, 400, 403, 404, 401 |

> **Visibilité** : SUPER_ADMIN, ADMIN, AGENT voient tous les tickets (y compris ceux sans créateur). USER ne voit que ses propres tickets (`createdById = user.id`) — 404 si ticket d un autre.
> **Création** : `createdById` est automatiquement défini sur l utilisateur authentifié, jamais lu depuis le body.

## Flux d invitation (développement)

1. SUPER_ADMIN appelle `POST /users` avec `{ email, role }`
2. L API crée l utilisateur en `status: INVITED`, génère un token d invitation (48h), invalide les anciens
3. L email est envoyé via Resend. **Sans `RESEND_API_KEY` en développement**, le lien complet est affiché dans la console du serveur :
   ```
   [DEV EMAIL] To: user@example.com
   [DEV EMAIL] Subject: Invitation to join Ticket API
   [DEV EMAIL] Body:
   You have been invited...
   http://localhost:3000/accept-invitation?token=abc123...
   ```
4. L utilisateur copie le token et appelle `POST /auth/accept-invitation` avec `{ token, password }` (min 12 caractères)
5. L API consomme le token (atomique), valide l utilisateur (`ACTIVE`), hashe le mot de passe
6. L utilisateur se connecte via `POST /auth/login`

## Flux de réinitialisation de mot de passe (développement)

1. Utilisateur appelle `POST /auth/forgot-password` avec `{ email }`
2. **Réponse toujours 200** avec message générique (anti-énumération)
3. Si compte `ACTIVE` : token généré (1h), anciens invalidés, email envoyé
4. **Sans `RESEND_API_KEY` en développement**, le lien est affiché dans la console
5. Utilisateur appelle `POST /auth/reset-password` avec `{ token, password }` (8-72 caractères)
6. Token consommé atomiquement, mot de passe mis à jour, **tous les refresh tokens révoqués**
7. Utilisateur se reconnecte via `POST /auth/login`

## Choix de sécurité et justifications

| Choix | Justification |
|-------|---------------|
| **JWT HS256 + secret 32+ chars** | Choix de conception (pas exigence du sujet). Symétrique, simple, pas de gestion de paires de clés. Secret long = résistance brute-force. |
| **Algorithme fixé à `["HS256"]`** | Prévention attaque "alg: none" et confusion RS256/HS256. |
| **Issuer + Audience vérifiés** | Token non réutilisable sur autre service. |
| **Access token 15 min, claims `sub` + `role`** | Court TTL = fenêtre d exploitation réduite. Pas de données sensibles dans le token. |
| **Refresh token : `randomBytes(32)` hex, SHA-256 stocké, 7 jours** | Entropie forte, pas de secret en base. Rotation à chaque refresh. |
| **Famille de refresh tokens + révocation complète sur réutilisation** | Détection de vol de token : si un ancien token est réutilisé, toute la famille est révoquée. |
| **Rotation atomique en transaction** | `updateMany(revokedAt=null)` + count check = pas de race condition. |
| **bcryptjs coût 12** | Coût élevé = lent, résistant GPU. Pas de dépendance native. |
| **Hash factice bcrypt coût 12 pour anti-énumération login** | Même temps de réponse user inconnu / mauvais pwd / compte inactif. |
| **Réponse 200 identique sur forgot-password** | Anti-énumération : impossible de savoir si un email existe. |
| **Consommation atomique tokens (updateMany conditionnel)** | `count !== 1` ? 400 générique. Pas de race condition, usage unique garanti. |
| **Rôle revérifié en base à chaque requête (`authenticate`)** | Token valide mais user désactivé ? 401 immédiat. Pas d élévation via token modifié. |
| **USER voit ses tickets en 404 (pas 403)** | Pas de fuite d existence de tickets d autres utilisateurs. |
| **Rate limiting par IP sur endpoints sensibles** | 10 req/15min login/forgot/reset/invite, 30 req/15min refresh. Configurable via `RATE_LIMIT_ENABLED`. |
| **Helmet + `x-powered-by` désactivé + body limit 10kb** | Headers sécurisés, pas de fuite version, DoS basique limité. |
| **Trust proxy conditionnel (`NODE_ENV === production`)** | En dev : IP directe. En prod derrière reverse proxy : header `X-Forwarded-For` fiable. |
| **Zod `.strict()` sur tous les inputs** | Rejet champs inattendus (ex: `role` dans login). |
| **Select explicite sans `passwordHash`** | Fuite impossible dans réponses. |
| **Pas de token/mot de passe/email dans les logs** | Seuls messages d erreur génériques loggés. |
| **Gestion erreurs Prisma : P2025?404, P2002?409 génériques** | Pas de fuite "email déjà utilisé" ou "ticket non trouvé" précis. |
| **SEED_SUPER_ADMIN_PASSWORD retiré après seed** | Secret temporaire seulement. |

## Limites connues

- Pas de vérification d email avant activation (invitation = activation)
- Pas de MFA / 2FA
- Pas de gestion de sessions multiples par utilisateur (famille unique par login)
- Rate limiting en mémoire (pas de store Redis) : ne persiste pas Across redémarrages, pas partagé entre instances
- Pas de logs structurés / audit trail
- Resend sans domaine vérifié : envoi possible uniquement vers l email du compte Resend (limitation Resend, pas du code)
- Pas de tests automatisés (unitaires/intégration)
- Pas de documentation OpenAPI/Swagger

## Fichiers à supprimer avant déploiement

| Fichier | Description |
|---------|-------------|
| `tmp-create-user.ts` | Script temporaire pour créer un USER de test |
| `tmp-expire-invitation.ts` | Script temporaire pour créer un token expiré |
| Compte `testuser@example.com` | Compte de test créé via `tmp-create-user.ts` |

## Seed Super Admin

Le seed (`npm run seed`) est **idempotent** :
- Ne crée rien si un SUPER_ADMIN existe déjà
- Utilise `SEED_SUPER_ADMIN_EMAIL` et `SEED_SUPER_ADMIN_PASSWORD` depuis l environnement
- Valide le mot de passe (min 12 caractères)
- Ne logge **jamais** le mot de passe
- Affiche un rappel pour retirer `SEED_SUPER_ADMIN_PASSWORD` du `.env`

## Architecture

```
src/
+-- app.ts              # Express app, middleware globaux, rate limiting
+-- index.ts            # Bootstrap, validation env au démarrage
+-- env.ts              # Validation Zod des variables d environnement
+-- prisma.ts           # Client Prisma singleton
+-- schema.ts           # Schémas Zod (strict) pour tous les inputs
+-- email.ts            # Envoi emails via Resend (dev: console)
+-- auth/
¦   +-- tokens.ts       # JWT access + refresh token utils
¦   +-- passwords.ts    # bcrypt hash/verify + dummy hash
¦   +-- middleware.ts   # authenticate + requireRole
+-- routes/
    +-- auth.ts         # /auth/* endpoints
    +-- users.ts        # /users/* endpoints (SUPER_ADMIN/ADMIN)
    +-- tickets.ts      # /tickets/* endpoints (RBAC)
```

## Commandes utiles

```bash
# Typecheck
npx tsc --noEmit

# Migration DB
npx prisma migrate dev --name <nom>

# Studio Prisma
npx prisma studio

# Seed
npm run seed

# Dev avec hot reload
npm run dev
```
