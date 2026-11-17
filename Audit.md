# Audit de sécurité et tests d'intrusion — Ticket API

| | |
|---|---|
| **Auteur** | Caleb `[NOM / GROUPE]` |
| **Date** | 17/11/2026 |
| **Cible** | API locale `http://localhost:3000` (dépôt `ticket-api`, commit audité `31cc499`) |
| **Méthode** | Tests automatisés (`audit-tests.ps1`, phases 1 et 2) puis reproduction manuelle PowerShell de chaque vulnérabilité, correction dans le code, retest |
| **Preuves brutes** | `docs\audit\run-phase1-20261117-115257\`, `docs\audit\run-phase2-20261117-121040\` |

## Synthèse

| ID | Vulnérabilité | Criticité | Corrigée |
|----|---------------|-----------|----------|
| VULN-001 | Access token toujours valide après logout | Moyenne | `[oui / non]` |
| VULN-002 | Pas de limitation de débit sur le login (brute force) | Élevée | `[oui / non]` |
| VULN-003 | Pas de limitation de débit sur forgot-password | Moyenne | `[oui / non]` |
| VULN-004 | Documentation API exposée sans authentification | Faible | `[oui / non]` |
| VULN-005 | Clé API Resend réelle dans l'historique git | Élevée | `[oui / non]` |

**Testé et non exploitable** (attaques réellement tentées, toutes bloquées) : JWT `alg=none`, payload modifié, mauvais secret (401) ; réutilisation d'un refresh token (famille révoquée) ; énumération de comptes par timing (écart 0,3 ms) ; injections SQL (`' OR 1=1 --`, `DROP TABLE`) ; mass assignment (400) ; fuite de hash ou de tokens dans les réponses ; stack traces ; CORS hostile ; en-têtes de sécurité (tous présents) ; prompt injection sur l'assistant IA (5 variantes refusées en 422).

---

## VULN-001 — Access token toujours valide après logout

**Identifiant** : VULN-001

**Nom** : Révocation de session incomplète — l'access token reste accepté après `POST /auth/logout`.

**Description** : le logout révoque les refresh tokens de la session (famille), mais le middleware `authenticate` vérifie seulement la signature du JWT, son expiration et le statut de l'utilisateur. Il ne vérifie jamais que la session existe encore. L'access token (15 min) reste donc utilisable jusqu'à son expiration.

**Localisation** : `src/middleware/auth.ts` (middleware `authenticate`), `src/modules/auth/tokens.ts` (signature du JWT sans identifiant de session), `src/modules/auth/service.ts` (`logout()`).

**Criticité** : **Moyenne** — l'attaquant doit d'abord disposer du token, mais le logout ne protège plus l'utilisateur pendant 15 minutes. Sur un `SUPER_ADMIN`, l'accès couvre l'administration.

**Scénario d'exploitation** : un attaquant récupère l'access token d'un utilisateur (poste partagé, logs). La victime se déconnecte pour couper l'accès, mais l'attaquant continue d'appeler l'API avec ce token.

**Preuve d'exploitation (PoC)** :
```powershell
$b = "http://localhost:3000"
$l = Invoke-RestMethod "$b/auth/login" -Method POST -Body (@{email="admin@example.com";password=$p}|ConvertTo-Json) -ContentType "application/json"
Invoke-RestMethod "$b/auth/logout" -Method POST -Body (@{refreshToken=$l.refreshToken}|ConvertTo-Json) -ContentType "application/json" | Out-Null
Invoke-WebRequest "$b/auth/me" -Headers @{Authorization="Bearer $($l.accessToken)"} -UseBasicParsing
```
```text
GET /auth/me apres logout -> HTTP 200 : VULNERABLE      (attendu : 401)
```
![alt text](<Screenshot 2026-11-17 130854-2.png>)

**Impact** : détournement de session après déconnexion, accès aux tickets et aux données utilisateurs, et à l'administration si le token appartient à un `SUPER_ADMIN`.

**Correction** : le JWT embarque désormais un identifiant de session (`sid` = `familyId` du refresh token). `authenticate` vérifie en base que cette session n'est pas révoquée. Aucune migration : `familyId` existe déjà.

Avant — `src/modules/auth/tokens.ts`
```ts
export interface AccessTokenPayload {
  sub: string;
  role: string;
}
```
Avant — `src/modules/auth/service.ts` (login)
```ts
const accessToken = signAccessToken({ sub: user.id, role: user.role });
```
Avant — `src/middleware/auth.ts`
```ts
const user = await prisma.user.findUnique({
  where: { id: payload.sub },
  select: { id: true, role: true, status: true },
});
```
Après
```diff
 // src/modules/auth/tokens.ts
 export interface AccessTokenPayload {
   sub: string;
   role: string;
+  sid: string;
 }

 // src/modules/auth/service.ts (login)
-const accessToken = signAccessToken({ sub: user.id, role: user.role });
+const accessToken = signAccessToken({ sub: user.id, role: user.role, sid: familyId });

 // src/middleware/auth.ts (après verifyAccessToken, avant la lecture du user)
+const session = await prisma.refreshToken.findFirst({
+  where: { familyId: payload.sid, revokedAt: null },
+  select: { id: true },
+});
+if (!session) {
+  res.status(401).json({ error: "Unauthorized" });
+  return;
+}
```
> Les autres appels à `signAccessToken` (ex. `refresh()` dans `service.ts`) doivent aussi passer le `sid` de la famille, sinon TypeScript refuse de compiler.

**Retest** : même PoC après correction et redémarrage du serveur. Résultat attendu : `HTTP 401 : NOT EXPLOITABLE`.
```text
[COLLER LA SORTIE APRÈS CORRECTION]
```
📸 `[CAPTURE : PoC après correction]`

---

## VULN-002 — Pas de limitation de débit sur le login

**Identifiant** : VULN-002

**Nom** : Brute force du login non limité — aucun `429` après 12 tentatives échouées.

**Description** : `POST /auth/login` a accepté 12 échecs consécutifs sans jamais répondre `429`. Le limiteur est bien codé dans `src/app.ts` (10 requêtes / 15 min), mais il n'est créé que si `RATE_LIMIT_ENABLED` est vrai. `[CAUSE À CONFIRMER : Select-String "RATE_LIMIT" .env → RATE_LIMIT_ENABLED=false pendant le test]`. Deux faiblesses de conception s'y ajoutent : rien n'empêche de désactiver le limiteur en production, et `trust proxy` vaut `true` en production, ce qui fait confiance à n'importe quel en-tête `X-Forwarded-For` envoyé par un client et permet de contourner un limiteur par IP.

**Localisation** : `src/app.ts` (lignes 38 et 54–80), `src/config/env.ts` (lignes 25–28).

**Criticité** : **Élevée** — un compte `SUPER_ADMIN` existe ; aucun frein aux attaques par dictionnaire ou credential stuffing.

**Scénario d'exploitation** : l'attaquant cible `admin@…` et envoie des milliers de mots de passe courants jusqu'au succès. Si un limiteur existe derrière un proxy, il change `X-Forwarded-For` à chaque requête pour repartir à zéro.

**Preuve d'exploitation (PoC)** :
```powershell
$c = 1..12 | % { try { (Invoke-WebRequest "http://localhost:3000/auth/login" -Method POST -Body (@{email="ratelimit-audit@example.com";password="wrongpassword"}|ConvertTo-Json) -ContentType "application/json" -UseBasicParsing -ErrorAction Stop).StatusCode } catch { $_.Exception.Response.StatusCode.value__ } }
"Statuts : $($c -join ' ')"
```
```text
Statuts : 401 401 401 401 401 401 401 401 401 401 401 401
Aucun 429 -> VULNERABLE
```


**Impact** : prise de contrôle de comptes (dont l'administrateur), fuite de tickets, modification des rôles, altération des journaux d'audit.

**Correction** : (1) remettre `RATE_LIMIT_ENABLED=true` ; (2) interdire de désactiver le limiteur en production ; (3) rendre `trust proxy` explicite (désactivé par défaut) au lieu de `true` automatique en production.

Avant — `src/app.ts:38`
```ts
app.set("trust proxy", env.NODE_ENV === "production");
```
Avant — `src/config/env.ts` (pas de variable `TRUST_PROXY`)

Après
```diff
 // src/config/env.ts
 RATE_LIMIT_ENABLED: z.preprocess(emptyToUndefined, z.enum(["true","false"]).default("true").transform((v) => v === "true")),
+TRUST_PROXY: z.preprocess(emptyToUndefined, z.enum(["true","false"]).default("false").transform((v) => v === "true")),

 // src/app.ts
-app.set("trust proxy", env.NODE_ENV === "production");
+app.set("trust proxy", env.TRUST_PROXY);
+
+if (env.NODE_ENV === "production" && !env.RATE_LIMIT_ENABLED) {
+  throw new Error("RATE_LIMIT_ENABLED=false est interdit en production");
+}
```
En production derrière un reverse proxy, mettre `TRUST_PROXY=true` et idéalement un nombre de sauts précis plutôt que `true`.

**Retest** : serveur redémarré avec `RATE_LIMIT_ENABLED=true`, même PoC. Résultat attendu : `401` ×10 puis `429` ×2.
```text
[COLLER LA SORTIE APRÈS CORRECTION]
```
📸 `[CAPTURE : PoC après correction]`

---

## VULN-003 — Pas de limitation de débit sur forgot-password

**Identifiant** : VULN-003

**Nom** : `POST /auth/forgot-password` sans limite effective — 12 requêtes, 12 réponses HTTP 200.

**Description** : chaque requête peut déclencher l'envoi d'un email. Le limiteur prévu (10 requêtes / 15 min) ne s'est pas déclenché pour la même raison que VULN-002 (limiteur désactivé), et son seuil reste trop permissif pour une route qui envoie des emails payants.

**Localisation** : `src/app.ts` (lignes 69–70).

**Criticité** : **Moyenne** — pas de compromission directe, mais abus du service d'envoi (coût Resend, réputation du domaine) et harcèlement d'un utilisateur.

**Scénario d'exploitation** : l'attaquant envoie des requêtes en boucle avec l'adresse d'une victime : sa boîte est inondée d'emails légitimes de l'application et le quota d'envoi est consommé.

**Preuve d'exploitation (PoC)** :
```powershell
$c = 1..12 | % { try { (Invoke-WebRequest "http://localhost:3000/auth/forgot-password" -Method POST -Body (@{email="ratelimit-audit@example.com"}|ConvertTo-Json) -ContentType "application/json" -UseBasicParsing -ErrorAction Stop).StatusCode } catch { $_.Exception.Response.StatusCode.value__ } }
"Statuts : $($c -join ' ')"
```
```text
[T22] observe : statuts : 200x12      (attendu : 429 après 10 requêtes)
```
📸 `[CAPTURE : PoC avant correction]`

**Impact** : mail bombing, coûts, risque de blocage du compte d'envoi par le fournisseur.

**Correction** : seuil abaissé à 5 requêtes par heure et par IP. La réponse reste identique que le compte existe ou non (pas d'énumération).

Avant — `src/app.ts:69-70`
```ts
// /auth/forgot-password : 10 req / 15 min
app.use("/auth/forgot-password", createLimiter(15 * 60 * 1000, 10, "Too many requests"));
```
Après
```diff
-app.use("/auth/forgot-password", createLimiter(15 * 60 * 1000, 10, "Too many requests"));
+app.use("/auth/forgot-password", createLimiter(60 * 60 * 1000, 5, "Too many requests"));
```

**Retest** : serveur redémarré avec `RATE_LIMIT_ENABLED=true`, même PoC. Résultat attendu : `200` ×5 puis `429` ×7.
```text
[COLLER LA SORTIE APRÈS CORRECTION]
```
📸 `[CAPTURE : PoC après correction]`

---

## VULN-004 — Documentation API exposée sans authentification

**Identifiant** : VULN-004

**Nom** : `/docs/` et `/openapi.json` accessibles sans token (HTTP 200).

**Description** : la documentation Swagger et la spécification OpenAPI sont montées dès que `ENABLE_DOCS=true`, sans authentification et sans garde sur l'environnement. Rien n'empêche de les laisser actives en production.

**Localisation** : `src/openapi.ts` (fonction `setupSwagger`, lignes 691–714), `src/app.ts` (ligne 89), `src/config/env.ts` (`ENABLE_DOCS`).

**Criticité** : **Faible** — aucun accès aux données, mais une cartographie complète des routes, schémas et routes d'administration.

**Scénario d'exploitation** : un attaquant non authentifié télécharge `/openapi.json`, repère les routes sensibles et les noms de champs, puis cible ses attaques (brute force, élévation de rôle).

**Preuve d'exploitation (PoC)** :
```powershell
"/docs/","/openapi.json" | % { try { $s=(Invoke-WebRequest "http://localhost:3000$_" -UseBasicParsing -ErrorAction Stop).StatusCode } catch { $s=$_.Exception.Response.StatusCode.value__ }; "$_ -> HTTP $s" }
```
```text
/docs/ -> HTTP 200
/openapi.json -> HTTP 200
```
📸 `[CAPTURE : PoC avant correction]`

**Impact** : reconnaissance facilitée, divulgation de l'architecture de l'API.

**Correction** : la documentation n'est montée qu'en dehors de la production, même si `ENABLE_DOCS=true`. (Une protection par `authenticate` n'a pas été retenue : un navigateur ne peut pas envoyer d'en-tête `Authorization` en ouvrant `/docs`, l'interface deviendrait inutilisable.)

Avant — `src/openapi.ts`
```ts
export function setupSwagger(app: Express, enableDocs: boolean): void {
  if (!enableDocs) {
    return;
  }
  app.get("/openapi.json", ...);
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec, { ... }));
}
```
Après
```diff
 // src/app.ts (ligne 89)
-setupSwagger(app, env.ENABLE_DOCS);
+setupSwagger(app, env.ENABLE_DOCS && env.NODE_ENV !== "production");
```

**Retest** : serveur lancé avec `ENABLE_DOCS=true` et `NODE_ENV=production`, même PoC. Résultat attendu : `HTTP 404` sur `/docs/` et `/openapi.json`.
```text
[COLLER LA SORTIE APRÈS CORRECTION]
```
📸 `[CAPTURE : PoC après correction]`

---

## VULN-005 — Clé API Resend réelle dans l'historique git

**Identifiant** : VULN-005

**Nom** : secret d'API committé dans `.env.example` et conservé dans l'historique git.

**Description** : une clé Resend réelle (format `re_xxxxxxxx_…`) figure en clair à la ligne 17 de `.env.example` dans les commits `d6d278a` et `4ca168c`. Elle a ensuite été remplacée par un placeholder, mais reste lisible par quiconque clone le dépôt.

**Localisation** : `.env.example`, ligne 17, commits `d6d278a` et `4ca168c`. Valeur masquée : `re_D5wz****_****`.

**Criticité** : **Élevée** — **Critique** tant que la clé n'est pas révoquée : elle permet d'envoyer des emails au nom du domaine de l'entreprise.

**Scénario d'exploitation** : un attaquant (ou un ancien collaborateur) clone le dépôt, parcourt `git log -p`, récupère la clé et envoie des emails de phishing depuis le domaine de l'entreprise.

**Preuve d'exploitation (PoC)** :
```powershell
git log --all --oneline -G 're_[A-Za-z0-9]{8}_[A-Za-z0-9]{20,}'
```
```text
d6d278a feat(auth): steps 5-6 user invitation, email, accept invitation
4ca168c feat(auth): step 2 login, JWT access token, authenticate middleware, GET /auth/me
-> VULNERABLE (cle dans l'historique)
```
 ![alt text](<Screenshot 2026-11-17 130755-1.png>)

**Impact** : emails frauduleux depuis le domaine, consommation du quota, atteinte à la réputation du domaine (SPF/DKIM).

**Correction** : (1) **révoquer la clé** dans le dashboard Resend et en générer une nouvelle (réécrire l'historique ne suffirait pas) ; (2) la nouvelle clé n'existe que dans `.env`, ignoré par git ; (3) `.env.example` ne contient qu'un placeholder. Le code n'a pas besoin de changer : la clé est déjà lue via `process.env` et validée par Zod.

Avant — `.env.example` (commits `d6d278a`, `4ca168c`)
```text
RESEND_API_KEY="re_D5wz****_****"
```
Après — `.env.example` (état actuel) et `.env` (jamais commité)
```text
RESEND_API_KEY="re_xxxxxxxxxxxxxxxxxxxxxxxx"
```
```text
$ cat .gitignore | grep -E "^\.env"
.env
.env.local
.env.*.local
```

**Retest** : l'ancienne clé doit être refusée par Resend (code attendu : `401` ou `403`).
```powershell
Invoke-WebRequest https://api.resend.com/domains -Headers @{Authorization="Bearer <ANCIENNE_CLE>"} -UseBasicParsing
git show HEAD:.env.example | Select-String "RESEND"      # placeholder attendu
git status                                                  # .env absent de la liste
```
```text
[COLLER LA SORTIE APRÈS CORRECTION]
```
📸 `[CAPTURE : ancienne clé refusée]`