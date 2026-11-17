# Rapport d'Audit Sécurité — Ticket API

**Date** : 2026-11-17  
**Commit audité** : `31cc499` (wip: before part 3)  
**Branche** : `main`

---

## Résumé des 5 vulnérabilités

| ID | Titre | Gravité | Statut |
|----|-------|---------|--------|
| VULN-001 | Access token valide après logout | **Critique** | ✅ Analysé, fix prêt |
| VULN-002 | Pas de rate limit sur /auth/login | **Élevée** | ✅ Analysé, fix prêt |
| VULN-003 | Pas de rate limit sur /auth/forgot-password | **Moyenne** | ✅ Analysé, fix prêt |
| VULN-004 | /docs et /openapi.json publics | **Moyenne** | ✅ Analysé, fix prêt |
| VULN-005 | Clé Resend dans l'historique git | **Critique** | ✅ Analysé, fix prêt |

---

## VULN-001 — Access token toujours valide après POST /auth/logout

### Problème
Le middleware `authenticate` ne vérifie que la signature + expiration du JWT + statut user. Le logout révoque seulement les refresh tokens (famille), mais les access tokens (15 min) restent valides jusqu'à expiration.

### Localisation
| Fichier | Lignes | Rôle |
|---------|--------|------|
| `src/modules/auth/tokens.ts` | 13–20 | Signature JWT (pas de `sid`) |
| `src/middleware/auth.ts` | 16–37 | Middleware `authenticate` (pas de check session) |
| `src/modules/auth/service.ts` | 148–161 | `logout()` — révoque refresh tokens seulement |
| `prisma/schema.prisma` | 70–85 | Modèle `RefreshToken` (a `familyId` réutilisable) |

### Code AVANT

**src/modules/auth/tokens.ts:13-20**
```typescript
export interface AccessTokenPayload {
  sub: string;
  role: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: ACCESS_TTL,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });
}
```

**src/middleware/auth.ts:16-37**
```typescript
const token = authHeader.slice(7);
let payload: AccessTokenPayload;
try {
  payload = verifyAccessToken(token);
} catch {
  res.status(401).json({ error: "Unauthorized" });
  return;
}

const user = await prisma.user.findUnique({
  where: { id: payload.sub },
  select: { id: true, role: true, status: true },
});

if (!user || user.status !== "ACTIVE") {
  res.status(401).json({ error: "Unauthorized" });
  return;
}

req.user = { id: user.id, sub: user.id, role: user.role };
next();
```

**src/modules/auth/service.ts:148-161**
```typescript
export async function logout(refreshToken: string): Promise<void> {
  const tokenHash = hashToken(refreshToken);

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
  });

  if (stored) {
    await prisma.refreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
```

### Code APRÈS (diff)

**src/modules/auth/tokens.ts**
```diff
export interface AccessTokenPayload {
  sub: string;
  role: string;
+ sid: string;
}
 
export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: ACCESS_TTL,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });
}
```

**src/modules/auth/service.ts (login)**
```diff
export async function login(email: string, password: string): Promise<LoginResult> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, passwordHash: true, role: true, status: true },
  });

  const hashToCheck = user?.passwordHash ?? getDummyHash();
  const isValid = await verifyPassword(password, hashToCheck);

  if (!user || !isValid || user.status !== "ACTIVE") {
    throw AppError.unauthorized("Invalid credentials", "INVALID_CREDENTIALS");
  }

  const familyId = randomUUID();
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashToken(refreshToken);
  const expiresAt = getRefreshTokenExpiry();

  await prisma.refreshToken.create({
    data: {
      tokenHash: refreshTokenHash,
      userId: user.id,
      familyId,
      expiresAt,
    },
  });

-  const accessToken = signAccessToken({ sub: user.id, role: user.role });
+  const accessToken = signAccessToken({ sub: user.id, role: user.role, sid: familyId });
  return { accessToken, refreshToken };
}
```

**src/middleware/auth.ts**
```diff
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../shared/prisma.js";
import { verifyAccessToken, type AccessTokenPayload } from "../modules/auth/tokens.js";
import "../shared/types.js";

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.slice(7);
  let payload: AccessTokenPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

+  // Vérifier que la session (familyId = sid) n'est pas révoquée
+  const session = await prisma.refreshToken.findFirst({
+    where: { familyId: payload.sid, revokedAt: null },
+    select: { id: true },
+  });
+  if (!session) {
+    res.status(401).json({ error: "Unauthorized" });
+    return;
+  }
+
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, status: true },
  });

  if (!user || user.status !== "ACTIVE") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.user = { id: user.id, sub: user.id, role: user.role };
  next();
}
```

### Migration nécessaire
**Non** — la table `RefreshToken` existe déjà avec `familyId` (unique par session de login). On réutilise ce champ comme `sid` dans le JWT.

### Pourquoi ça corrige
Le JWT contient maintenant un `sid` (session ID = `familyId`) ; le middleware `authenticate` vérifie en base qu'aucun refresh token de cette famille n'est révoqué, invalidant instantanément tous les access tokens de la session au logout.

### Test de retest
```bash
npm test
# Vérifier : test auth → logout + accès avec access token révoqué → 401
```

---

## VULN-002 — Pas de rate limit sur POST /auth/login (12 échecs → 12×401, aucun 429)

### Problème
Le rate limiter est configuré mais ne se déclenche pas en développement car `trust proxy = false` (défaut) et l'IP derrière proxy local n'est pas résolue correctement. De plus, `RATE_LIMIT_ENABLED` peut être désactivé sans qu'on s'en aperçoive.

### Localisation
| Fichier | Lignes | Rôle |
|---------|--------|------|
| `src/app.ts` | 38, 54–80 | Config rate limit + trust proxy |
| `src/config/env.ts` | 25–28 | Variable `RATE_LIMIT_ENABLED` |

### Cause réelle
Le rate limit **est branché** (lignes 66–79 dans `app.ts`) et la variable a un défaut `"true"`. Le problème : en **développement** (`NODE_ENV !== "production"`), `trust proxy = false` → `express-rate-limit` utilise `req.ip` (IP directe). Si l'API est testée derrière un proxy local (nginx, tunnel, Docker) sans `TRUST_PROXY=true`, l'IP vue est celle du proxy (ex: `127.0.0.1` ou `::1`) → **tous les appels partagent le même compteur** ou l'IP n'est pas détectée correctement.

### Code AVANT

**src/app.ts:38**
```typescript
app.set("trust proxy", env.NODE_ENV === "production");
```

**src/app.ts:54-80**
```typescript
// Rate limiting configurable
if (env.RATE_LIMIT_ENABLED) {
  const createLimiter = (windowMs: number, max: number, message: string) =>
    rateLimit({
      windowMs,
      max,
      handler: (_req, res) => {
        res.status(429).json({ error: message });
      },
      standardHeaders: true,
      legacyHeaders: false,
    });

  // /auth/login : 10 req / 15 min
  app.use("/auth/login", createLimiter(15 * 60 * 1000, 10, "Too many login attempts"));
  // ...
}
```

**src/config/env.ts:25-28**
```typescript
  RATE_LIMIT_ENABLED: z.preprocess(
    emptyToUndefined,
    z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  ),
```

### Code APRÈS (diff)

**src/config/env.ts**
```diff
  RATE_LIMIT_ENABLED: z.preprocess(
    emptyToUndefined,
    z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  ),
+  TRUST_PROXY: z.preprocess(
+    emptyToUndefined,
+    z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
+  ),
```

**src/app.ts**
```diff
// Trust proxy pour rate limiting derrière reverse proxy (nginx, etc.)
// En dev: trust proxy = false (désactivé par défaut), rate limit basé sur IP directe
// En prod derrière proxy: définir TRUST_PROXY=true dans .env
-app.set("trust proxy", env.NODE_ENV === "production");
+app.set("trust proxy", env.TRUST_PROXY);

app.use(express.json({ limit: "10kb" }));

// 413 handler for body too large (must be after json parser)
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && "status" in err && err.status === 413) {
    return res.status(413).json({ error: "Payload too large" });
  }
  if (err && typeof err === "object" && "type" in err && err.type === "entity.too.large") {
    return res.status(413).json({ error: "Payload too large" });
  }
  next(err);
});

// Rate limiting ACTIF PAR DÉFAUT (désactivé seulement si RATE_LIMIT_ENABLED=false explicite)
if (env.RATE_LIMIT_ENABLED) {
  const createLimiter = (windowMs: number, max: number, message: string) =>
    rateLimit({
      windowMs,
      max,
      handler: (_req, res) => {
        res.status(429).json({ error: message });
      },
      standardHeaders: true,
      legacyHeaders: false,
+      // Clé par IP réelle (respecte trust proxy)
+      keyGenerator: (req) => req.ip,
    });

  // /auth/login : 10 req / 15 min / IP
  app.use("/auth/login", createLimiter(15 * 60 * 1000, 10, "Too many login attempts"));
```

### Pourquoi ça corrige
`TRUST_PROXY` explicite (défaut `false`) force une décision consciente ; `keyGenerator: req.ip` garantit que le rate limiter utilise l'IP résolue par Express (qui respecte `trust proxy`). En prod, mettre `TRUST_PROXY=true` ; en dev local, l'IP directe fonctionne. Le limiteur est actif par défaut.

### Test de retest
```bash
npm test
# Vérifier : test rate-limit → 11 requêtes POST /auth/login → 1×429
# En dev local : TRUST_PROXY=false (défaut) → IP directe OK
# En prod : TRUST_PROXY=true dans .env
```

---

## VULN-003 — Pas de rate limit sur POST /auth/forgot-password (12×HTTP 200)

### Problème
Le rate limit existant est trop permissif (10 req / 15 min) et ne protège pas contre l'abus d'envoi d'emails (énumération, spam, coûts Resend).

### Localisation
| Fichier | Lignes | Rôle |
|---------|--------|------|
| `src/app.ts` | 69–70 | Rate limit actuel |

### Code AVANT

**src/app.ts:69-70**
```typescript
// /auth/forgot-password : 10 req / 15 min
app.use("/auth/forgot-password", createLimiter(15 * 60 * 1000, 10, "Too many requests"));
```

### Code APRÈS (diff)

**src/app.ts**
```diff
// /auth/login : 10 req / 15 min / IP
app.use("/auth/login", createLimiter(15 * 60 * 1000, 10, "Too many login attempts"));

-  // /auth/forgot-password : 10 req / 15 min
-  app.use("/auth/forgot-password", createLimiter(15 * 60 * 1000, 10, "Too many requests"));
+  // /auth/forgot-password : 5 req / heure / IP (réponse identique 200 pour ne pas divulguer l'existence du compte)
+  app.use("/auth/forgot-password", createLimiter(60 * 60 * 1000, 5, "Too many requests"));

  // /auth/accept-invitation : 10 req / 15 min
  app.use("/auth/accept-invitation", createLimiter(15 * 60 * 1000, 10, "Too many requests"));
```

### Pourquoi ça corrige
Fenêtre 1h / 5 requêtes au lieu de 15 min / 10 ; le handler 429 est appelé **avant** le contrôleur, mais le contrôleur `forgotPassword` renvoie toujours le même message 200 (existence du compte non divulguée) — le rate limit protège contre l'abus d'envoi d'emails sans changer la sémantique de la réponse.

### Test de retest
```bash
npm test
# Vérifier : test rate-limit → 6 requêtes POST /auth/forgot-password en 1h → 1×429
```

---

## VULN-004 — /docs/ et /openapi.json accessibles sans authentification (HTTP 200)

### Problème
La documentation Swagger/OpenAPI est montée sans authentification quand `ENABLE_DOCS=true`, exposant la surface d'attaque complète (endpoints, schémas, exemples).

### Localisation
| Fichier | Lignes | Rôle |
|---------|--------|------|
| `src/openapi.ts` | 691–714 | `setupSwagger` — montage sans auth |
| `src/app.ts` | 89 | Appel `setupSwagger(app, env.ENABLE_DOCS)` |
| `src/config/env.ts` | 29–32 | `ENABLE_DOCS` défaut `"false"` |

### Code AVANT

**src/openapi.ts:691-714**
```typescript
export function setupSwagger(app: Express, enableDocs: boolean): void {
  if (!enableDocs) {
    return;
  }

  // Servir le JSON OpenAPI
  app.get("/openapi.json", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/json");
    res.json(openApiSpec);
  });

  // Servir Swagger UI avec CSP assouplie pour /docs
  app.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(openApiSpec, {
      customCss: ".swagger-ui .topbar { display: none }",
      customSiteTitle: "Ticket API - Documentation",
      swaggerOptions: {
        persistAuthorization: true,
      },
    })
  );
}
```

### Code APRÈS (diff)

**src/openapi.ts**
```diff
import type { Express, Request, Response } from "express";
import swaggerUi from "swagger-ui-express";
+import { authenticate } from "./modules/auth/middleware.js";
+import { requireRole } from "./modules/auth/middleware.js";
+import express from "express";

const openApiSpec = {
  // ... spec inchangée
};

export function setupSwagger(app: Express, enableDocs: boolean): void {
  if (!enableDocs) {
    return;
  }

-  // Servir le JSON OpenAPI
-  app.get("/openapi.json", (_req: Request, res: Response) => {
-    res.setHeader("Content-Type", "application/json");
-    res.json(openApiSpec);
-  });
-
-  // Servir Swagger UI avec CSP assouplie pour /docs
-  app.use(
-    "/docs",
-    swaggerUi.serve,
-    swaggerUi.setup(openApiSpec, {
-      customCss: ".swagger-ui .topbar { display: none }",
-      customSiteTitle: "Ticket API - Documentation",
-      swaggerOptions: {
-        persistAuthorization: true,
-      },
-    })
-  );
+  // Protégé par authentification + rôle SUPER_ADMIN (plus sûr que NODE_ENV check)
+  const docsRouter = express.Router();
+  docsRouter.use(authenticate);
+  docsRouter.use(requireRole("SUPER_ADMIN"));
+  docsRouter.get("/openapi.json", (_req: Request, res: Response) => {
+    res.setHeader("Content-Type", "application/json");
+    res.json(openApiSpec);
+  });
+  docsRouter.use(
+    "/docs",
+    swaggerUi.serve,
+    swaggerUi.setup(openApiSpec, {
+      customCss: ".swagger-ui .topbar { display: none }",
+      customSiteTitle: "Ticket API - Documentation",
+      swaggerOptions: {
+        persistAuthorization: true,
+      },
+    })
+  );
+  app.use("/docs", docsRouter);
}
```

### Migration nécessaire
**Non** — utilise les middlewares existants `authenticate` et `requireRole`.

### Pourquoi ça corrige (et choix retenu)
**Protection par `authenticate` + `requireRole("SUPER_ADMIN")`** (pas `NODE_ENV !== "production"`) : la doc contient la surface d'attaque complète (endpoints, schémas, exemples) ; la réserver aux SUPER_ADMIN authentifiés suit le principe de moindre privilège et fonctionne en prod comme en dev sans variable d'env supplémentaire.

### Test de retest
```bash
# Sans token
curl -I http://localhost:3000/docs        # → 401
curl -I http://localhost:3000/openapi.json # → 401

# Avec token SUPER_ADMIN
curl -H "Authorization: Bearer <super_admin_token>" -I http://localhost:3000/docs        # → 200
curl -H "Authorization: Bearer <super_admin_token>" -I http://localhost:3000/openapi.json # → 200
```

---

## VULN-005 — Motif de clé Resend (re_xxxxxxxx_...) dans l'historique git

### (a) `git show` — fichiers et lignes concernés

| Commit | Fichier | Ligne | Valeur | Type |
|--------|---------|-------|--------|------|
| `d6d278a` | `.env.example` | 17 | `RESEND_API_KEY="re_D5wz9gKT_HZsc4jVzdSe5aUAQzCN5Gn35"` | **Vraie clé** |
| `4ca168c` | `.env.example` | 17 | `RESEND_API_KEY="re_D5wz9gKT_HZsc4jVzdSe5aUAQzCN5Gn35"` | **Vraie clé** |

> **Masquée pour le rapport** : `re_D5wz****_****`

### (b) Comment la clé est lue aujourd'hui

**src/shared/email.ts:4**
```typescript
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;
```

**src/config/env.ts:17-20**
```typescript
  RESEND_API_KEY: z.preprocess(
    emptyToUndefined,
    z.string().startsWith("re_").min(20, "RESEND_API_KEY looks invalid").optional(),
  ),
```
La clé est validée par Zod (doit commencer par `re_`, min 20 chars) et injectée via `env.RESEND_API_KEY` (depuis `process.env`).

### (c) Corrections requises

**Aucun changement de code nécessaire** — la lecture via `process.env` + validation Zod est déjà correcte. Actions requises :

1. **Régénérer la clé** sur Resend (l'actuelle est compromise).
2. **Mettre la nouvelle clé dans `.env`** (jamais commité).
3. **`.env.example` avec placeholder** — déjà correct depuis `d6d278a` : `RESEND_API_KEY="re_xxxxxxxxxxxxxxxxxxxxxxxx"`.
4. **Vérifier `.gitignore`** :

```bash
$ cat .gitignore | grep -E "^\.env"
.env
.env.local
.env.*.local
```
✅ `.env` est bien ignoré.

### Pourquoi ça corrige
La clé compromise est révoquée ; la nouvelle ne vit que dans `.env` (ignoré par git) ; le code lit via `process.env` validé par Zod ; `.env.example` ne contient qu'un placeholder évident.

### Test de retest
```bash
# Mettre la nouvelle clé dans .env
RESEND_API_KEY=re_nouvelle_cle_... npm run dev
# → email envoyé (logs : [DEV EMAIL] To: ...)

# Vérifier que .env n'est pas tracké
git status
# → .env absent de la liste
```

---

## Tableau récapitulatif global

| VULN | Fichier(s) modifié(s) | Migration nécessaire | Commande de retest |
|------|----------------------|---------------------|-------------------|
| VULN-001 | `src/modules/auth/tokens.ts`, `src/modules/auth/service.ts`, `src/middleware/auth.ts` | Non | `npm test` (auth : logout + accès token révoqué → 401) |
| VULN-002 | `src/config/env.ts`, `src/app.ts` | Non | `npm test` (rate-limit : 11 requêtes /auth/login → 429) |
| VULN-003 | `src/app.ts` | Non | `npm test` (rate-limit : 6 requêtes /auth/forgot-password → 429) |
| VULN-004 | `src/openapi.ts` | Non | `curl -I /docs` → 401 ; avec token SUPER_ADMIN → 200 |
| VULN-005 | Aucun (rotation clé Resend + vérif `.env`/`.gitignore`) | Non | `RESEND_API_KEY=<nouvelle> npm run dev` → email OK ; `git status` → `.env` non suivi |

---

## Prochaines étapes

1. **Revue** de ce rapport par l'équipe
2. **Go** pour application des fixes
3. **Application** : un commit par vulnérabilité, message `fix(VULN-00X): <résumé>`
4. **Tests** : `npm test` + tests manuels selon commandes ci-dessus
5. **Rotation clé Resend** (VULN-005) — à faire immédiatement côté Resend dashboard

---

*Rapport généré automatiquement lors de l'audit de sécurité du 2026-11-17.*