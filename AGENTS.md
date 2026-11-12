# AGENTS.md — Ticket API

> Pointeur vers l'état du projet pour les prochaines sessions d'agents.

---

## 📍 État Actuel

**Commit** : `31cc499` (wip: before part 3)  
**Branche** : `main`  
**Dernière session** : Audit complet → rédaction `docs/STATUS.md`

### ✅ Implémenté (Étapes 1–10)
- Auth complète : login, JWT (HS256, 15min), refresh rotation (7j, détection vol), logout
- Invitation user (SUPER_ADMIN) → email token 48h → accept-invitation → ACTIVE
- Forgot / Reset password (tokens 1h, consommation atomique, révocation refresh)
- Disable / Enable user (protection dernier SUPER_ADMIN, révocation refresh)
- RBAC : 4 rôles, middleware `authenticate` + `requireRole`
- Tickets : CRUD + visibilité selon rôle (USER = 404 sur tickets d'autrui)
- Helmet, rate limiting (configurable, non testé)
- Seed Super Admin idempotent
- README complet

### ❌ Non Testé (Manuel seulement : étapes 1–6)
- Étapes 7–8 : forgot/reset, disable/enable
- Étape 9 : helmet, rate limiting

---

## 🎯 Prochaines Passes (Définies dans `docs/STATUS.md`)

| Pass | Objectif | Critère de Fin |
|------|----------|----------------|
| **B** | Infrastructure tests + suite intégration existante | `npm test` vert, couverture auth/users/tickets/RBAC, base `_test` isolée, `sendEmail` mocké, rate limit OFF par défaut |
| **C** | Erreurs uniformes + 413, pagination/filtre/tri tickets, audit logs + endpoint role-change, tests | Format `{error,code}` partout, 413 body trop gros, `GET /tickets` → `{data,meta}`, modèle `AuditLog`, `PATCH /users/:id/role`, tests associés |
| **D** | Swagger/OpenAPI, CI GitHub Actions, README final, rapport final | `/docs` UI, CI verte à chaque push, README à jour, `docs/FINAL_REPORT.md` |

---

## 🔒 Règles Inviolables (pour tout agent)

1. **Jamais toucher à `.env` ni à la base de dev** — Base de test uniquement (`DATABASE_URL` finit par `_test`).
2. **Refresh token dans le body** — Pas de cookie, pas de CSRF.
3. **HS256, secret ≥ 32 chars, durées fixes** — Choix de conception, non négociables.
4. **Matrice RBAC = hypothèses** — Non confirmée par Yaaqoub. Ne pas changer sans accord.
5. **`createdById` nullable sur Ticket** — Requis.
6. **GET `/tickets` → pagination `{ data, meta }`** — Prévu en Pass C.
7. **Sortie `vitest` réelle = vérité** — Pour rapport final Pass B.
8. **Écrire uniquement `docs/STATUS.md` et `AGENTS.md`** — Jusqu'au feu vert pour Pass B.

---

## 📂 Fichiers Clés

```
docs/STATUS.md          # État complet, décisions, plan passes B/C/D
src/config/env.ts       # Validation Zod env (inclut NODE_ENV=test)
src/app.ts              # Express, helmet, rate limit, error handler global
src/shared/schema.ts    # Schémas Zod strict (inputs)
src/middleware/auth.ts  # authenticate + requireRole
src/modules/auth/       # login, refresh, logout, forgot, reset, invitation
src/modules/users/      # create (SUPER_ADMIN), list, disable, enable
src/modules/tickets/    # CRUD + RBAC visibilité
prisma/schema.prisma    # Modèles User, Ticket, UserToken, RefreshToken
```

---

## 🚀 Commandes de Démarrage (Pass B)

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

---

## ⚠️ Points de Vigilance

- **Body > 10kb → 500** (corriger en Pass C : middleware 413 avant routes)
- **Aucun audit log** — requis pour disable/enable/role-change (Pass C)
- **Aucun endpoint role-change** — requis pour audit "role changes" (Pass C)
- **Rate limit en mémoire** — non partagé, non persistant (documenté, accepté v1)

---

*Pour toute session : lire `docs/STATUS.md` en premier. Ne pas modifier d'autres fichiers sans feu vert explicite.*