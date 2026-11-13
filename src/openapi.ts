import type { Express, Request, Response } from "express";
import swaggerUi from "swagger-ui-express";

const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Ticket API",
    version: "1.0.0",
    description: "API pour la gestion de tickets avec authentification JWT, RBAC, et audit logs.",
  },
  servers: [
    {
      url: "http://localhost:3000",
      description: "Serveur de développement local",
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Access token JWT (HS256, 15 min). Format: Bearer <token>",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
        },
        required: ["error"],
        example: { error: "Validation failed" },
      },
      ErrorWithDetails: {
        allOf: [
          { $ref: "#/components/schemas/Error" },
          {
            type: "object",
            properties: {
              details: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    code: { type: "string" },
                    message: { type: "string" },
                    path: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
        ],
      },
      User: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          email: { type: "string", format: "email" },
          role: { type: "string", enum: ["SUPER_ADMIN", "ADMIN", "AGENT", "USER"] },
          status: { type: "string", enum: ["INVITED", "ACTIVE", "DISABLED"] },
          createdAt: { type: "string", format: "date-time" },
        },
        required: ["id", "email", "role", "status", "createdAt"],
      },
      UserListResponse: {
        type: "array",
        items: { $ref: "#/components/schemas/User" },
      },
      CreateUserRequest: {
        type: "object",
        required: ["email"],
        properties: {
          email: { type: "string", format: "email", example: "user@example.com" },
          role: { type: "string", enum: ["ADMIN", "AGENT", "USER"], default: "USER" },
        },
        additionalProperties: false,
      },
      ChangeRoleRequest: {
        type: "object",
        required: ["role"],
        properties: {
          role: { type: "string", enum: ["ADMIN", "AGENT", "USER"] },
        },
        additionalProperties: false,
      },
      Ticket: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          title: { type: "string" },
          description: { type: "string" },
          status: { type: "string", enum: ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          createdById: { type: ["string", "null"], format: "uuid" },
          assignedToId: { type: ["string", "null"], format: "uuid" },
        },
        required: ["id", "title", "description", "status", "createdAt", "updatedAt"],
      },
      CreateTicketRequest: {
        type: "object",
        required: ["title", "description"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200, example: "Problème de connexion" },
          description: { type: "string", minLength: 1, example: "Impossible de me connecter depuis ce matin" },
        },
        additionalProperties: false,
      },
      UpdateTicketStatusRequest: {
        type: "object",
        required: ["status"],
        properties: {
          status: { type: "string", enum: ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] },
        },
        additionalProperties: false,
      },
      PaginatedTickets: {
        type: "object",
        required: ["data", "meta"],
        properties: {
          data: { type: "array", items: { $ref: "#/components/schemas/Ticket" } },
          meta: { $ref: "#/components/schemas/PaginationMeta" },
        },
      },
      PaginatedAuditLogs: {
        type: "object",
        required: ["data", "meta"],
        properties: {
          data: { type: "array", items: { $ref: "#/components/schemas/AuditLog" } },
          meta: { $ref: "#/components/schemas/PaginationMeta" },
        },
      },
      PaginationMeta: {
        type: "object",
        required: ["page", "limit", "total", "totalPages"],
        properties: {
          page: { type: "integer", minimum: 1, example: 1 },
          limit: { type: "integer", minimum: 1, maximum: 100, example: 20 },
          total: { type: "integer", minimum: 0, example: 42 },
          totalPages: { type: "integer", minimum: 0, example: 3 },
        },
      },
      AuditLog: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          actorId: { type: ["string", "null"], format: "uuid" },
          action: { type: "string", enum: ["USER_INVITED", "INVITATION_ACCEPTED", "USER_DISABLED", "USER_ENABLED", "ROLE_CHANGED", "PASSWORD_RESET_COMPLETED"] },
          targetType: { type: "string", example: "User" },
          targetId: { type: "string", format: "uuid" },
          metadata: { type: "object", nullable: true, additionalProperties: true },
          createdAt: { type: "string", format: "date-time" },
        },
        required: ["id", "action", "targetType", "targetId", "createdAt"],
      },
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email", example: "user@example.com" },
          password: { type: "string", minLength: 1, maxLength: 128 },
        },
        additionalProperties: false,
      },
      LoginResponse: {
        type: "object",
        required: ["accessToken", "refreshToken"],
        properties: {
          accessToken: { type: "string", example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." },
          refreshToken: { type: "string", example: "a1b2c3d4e5f6..." },
        },
      },
      RefreshRequest: {
        type: "object",
        required: ["refreshToken"],
        properties: {
          refreshToken: { type: "string" },
        },
        additionalProperties: false,
      },
      RefreshResponse: {
        type: "object",
        required: ["accessToken", "refreshToken"],
        properties: {
          accessToken: { type: "string" },
          refreshToken: { type: "string" },
        },
      },
      LogoutRequest: {
        type: "object",
        properties: {
          refreshToken: { type: "string" },
        },
        additionalProperties: false,
      },
      LogoutResponse: {
        type: "object",
        required: ["success"],
        properties: {
          success: { type: "boolean", example: true },
        },
      },
      ForgotPasswordRequest: {
        type: "object",
        required: ["email"],
        properties: {
          email: { type: "string", format: "email" },
        },
        additionalProperties: false,
      },
      ForgotPasswordResponse: {
        type: "object",
        required: ["message"],
        properties: {
          message: { type: "string", example: "If the account exists and is active, a reset link has been sent" },
        },
      },
      ResetPasswordRequest: {
        type: "object",
        required: ["token", "password"],
        properties: {
          token: { type: "string" },
          password: { type: "string", minLength: 12, maxLength: 72 },
        },
        additionalProperties: false,
      },
      AcceptInvitationRequest: {
        type: "object",
        required: ["token", "password"],
        properties: {
          token: { type: "string" },
          password: { type: "string", minLength: 12, maxLength: 72 },
        },
        additionalProperties: false,
      },
      MeResponse: {
        type: "object",
        required: ["id", "email", "role", "status", "createdAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          email: { type: "string", format: "email" },
          role: { type: "string", enum: ["SUPER_ADMIN", "ADMIN", "AGENT", "USER"] },
          status: { type: "string", enum: ["ACTIVE"] },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      TicketFilters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] },
          page: { type: "integer", minimum: 1, default: 1 },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          sort: { type: "string", enum: ["createdAt", "updatedAt", "status"], default: "createdAt" },
          order: { type: "string", enum: ["asc", "desc"], default: "desc" },
        },
      },
      AuditLogFilters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["USER_INVITED", "INVITATION_ACCEPTED", "USER_DISABLED", "USER_ENABLED", "ROLE_CHANGED", "PASSWORD_RESET_COMPLETED"] },
          actorId: { type: "string", format: "uuid" },
          targetType: { type: "string" },
          targetId: { type: "string", format: "uuid" },
          page: { type: "integer", minimum: 1, default: 1 },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          sortBy: { type: "string", enum: ["createdAt"], default: "createdAt" },
          sortOrder: { type: "string", enum: ["asc", "desc"], default: "desc" },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    // ==================== AUTH ====================
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Connexion utilisateur",
        description: "Retourne un access token (15 min) et un refresh token (7 jours, rotation). Le refresh token doit être envoyé dans le body pour /auth/refresh et /auth/logout.",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/LoginRequest" } },
          },
        },
        responses: {
          200: { description: "Connexion réussie", content: { "application/json": { schema: { $ref: "#/components/schemas/LoginResponse" } } } },
          400: { description: "Validation failed", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorWithDetails" } } } },
          401: { description: "Identifiants invalides / utilisateur non ACTIVE", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Invalid credentials" } } } },
          413: { description: "Payload too large", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Payload too large" } } } },
          429: { description: "Too many login attempts", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Too many login attempts" } } } },
        },
      },
    },
    "/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Rafraîchir l'access token",
        description: "Rotation du refresh token (détection de réutilisation = révocation de la famille). Le refresh token est envoyé dans le body.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/RefreshRequest" } },
          },
        },
        responses: {
          200: { description: "Nouveaux tokens", content: { "application/json": { schema: { $ref: "#/components/schemas/RefreshResponse" } } } },
          400: { description: "Validation failed", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorWithDetails" } } } },
          401: { description: "Refresh token invalide, expiré, réutilisé ou utilisateur désactivé", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Unauthorized" } } } },
          413: { description: "Payload too large", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          429: { description: "Too many requests", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Déconnexion (révocation du refresh token)",
        description: "Révoque toute la famille du refresh token fourni. Idempotent : 200 même sans refreshToken.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: false,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/LogoutRequest" } },
          },
        },
        responses: {
          200: { description: "Déconnexion réussie", content: { "application/json": { schema: { $ref: "#/components/schemas/LogoutResponse" } } } },
          400: { description: "Validation failed", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorWithDetails" } } } },
          413: { description: "Payload too large", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/auth/forgot-password": {
      post: {
        tags: ["Auth"],
        summary: "Demander un lien de réinitialisation de mot de passe",
        description: "Envoie un email si le compte existe et est ACTIVE. Toujours 200 pour ne pas divulguer l'existence du compte.",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ForgotPasswordRequest" } },
          },
        },
        responses: {
          200: { description: "Email envoyé si compte valide", content: { "application/json": { schema: { $ref: "#/components/schemas/ForgotPasswordResponse" } } } },
          400: { description: "Validation failed", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorWithDetails" } } } },
          413: { description: "Payload too large", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          429: { description: "Too many requests", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/auth/reset-password": {
      post: {
        tags: ["Auth"],
        summary: "Réinitialiser le mot de passe",
        description: "Consomme le token (1h), met à jour le hash, révoque tous les refresh tokens de l'utilisateur. Crée un audit log PASSWORD_RESET_COMPLETED.",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ResetPasswordRequest" } },
          },
        },
        responses: {
          204: { description: "Mot de passe réinitialisé" },
          400: { description: "Token invalide/expiré ou validation failed", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Invalid or expired token" } } } },
          413: { description: "Payload too large", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          429: { description: "Too many requests", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/auth/accept-invitation": {
      post: {
        tags: ["Auth"],
        summary: "Accepter une invitation",
        description: "Consomme le token d'invitation (48h), définit le mot de passe, passe le statut à ACTIVE. Crée un audit log INVITATION_ACCEPTED.",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/AcceptInvitationRequest" } },
          },
        },
        responses: {
          204: { description: "Invitation acceptée, utilisateur ACTIVE" },
          400: { description: "Token invalide/expiré, mot de passe trop court, ou validation failed", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Invalid or expired token" } } } },
          413: { description: "Payload too large", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          429: { description: "Too many requests", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Profil de l'utilisateur connecté",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "Profil utilisateur", content: { "application/json": { schema: { $ref: "#/components/schemas/MeResponse" } } } },
          401: { description: "Non authentifié ou token invalide / utilisateur DISABLED", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Unauthorized" } } } },
        },
      },
    },

    // ==================== USERS ====================
    "/users": {
      post: {
        tags: ["Users"],
        summary: "Créer un utilisateur (invitation)",
        description: "Réservé aux SUPER_ADMIN. Crée un utilisateur INVITED, envoie un email avec token 48h. Crée un audit log USER_INVITED.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/CreateUserRequest" } },
          },
        },
        responses: {
          201: { description: "Utilisateur créé (INVITED)", content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } },
          400: { description: "Validation failed (rôle SUPER_ADMIN interdit, champs en trop)", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorWithDetails" } } } },
          401: { description: "Non authentifié", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Unauthorized" } } } },
          403: { description: "Réservé SUPER_ADMIN", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Forbidden" } } } },
          409: { description: "Email déjà utilisé", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Conflict" } } } },
          413: { description: "Payload too large", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
      get: {
        tags: ["Users"],
        summary: "Lister les utilisateurs",
        description: "Accessible aux SUPER_ADMIN et ADMIN. Retourne tous les utilisateurs sans passwordHash.",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "Liste des utilisateurs", content: { "application/json": { schema: { $ref: "#/components/schemas/UserListResponse" } } } },
          401: { description: "Non authentifié", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Unauthorized" } } } },
          403: { description: "Réservé SUPER_ADMIN et ADMIN", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Forbidden" } } } },
        },
      },
    },
    "/users/{id}/disable": {
      patch: {
        tags: ["Users"],
        summary: "Désactiver un utilisateur",
        description: "Réservé SUPER_ADMIN. Ne peut pas se désactiver soi-même. Ne peut pas désactiver le dernier SUPER_ADMIN actif. Révoque les refresh tokens. Crée audit log USER_DISABLED.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" }, description: "ID de l'utilisateur à désactiver" },
        ],
        responses: {
          200: { description: "Utilisateur désactivé", content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } },
          400: { description: "Ne peut pas se désactiver soi-même / dernier SUPER_ADMIN", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Cannot disable yourself" } } } },
          401: { description: "Non authentifié", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Unauthorized" } } } },
          403: { description: "Réservé SUPER_ADMIN", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Forbidden" } } } },
          404: { description: "Utilisateur non trouvé", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Not found" } } } },
          413: { description: "Payload too large", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/users/{id}/enable": {
      patch: {
        tags: ["Users"],
        summary: "Réactiver un utilisateur",
        description: "Réservé SUPER_ADMIN. L'utilisateur doit être DISABLED. Passe à ACTIVE s'il a un mot de passe, sinon INVITED. Crée audit log USER_ENABLED.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" }, description: "ID de l'utilisateur à réactiver" },
        ],
        responses: {
          200: { description: "Utilisateur réactivé", content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } },
          400: { description: "Utilisateur pas DISABLED", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "User is not disabled" } } } },
          401: { description: "Non authentifié", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Unauthorized" } } } },
          403: { description: "Réservé SUPER_ADMIN", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Forbidden" } } } },
          404: { description: "Utilisateur non trouvé", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Not found" } } } },
          413: { description: "Payload too large", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/users/{id}/role": {
      patch: {
        tags: ["Users"],
        summary: "Changer le rôle d'un utilisateur",
        description: "Réservé SUPER_ADMIN. Ne peut pas changer son propre rôle. Ne peut pas rétrograder le dernier SUPER_ADMIN actif. Rôles autorisés: ADMIN, AGENT, USER. Crée audit log ROLE_CHANGED avec metadata { previousRole, newRole }.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" }, description: "ID de l'utilisateur" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ChangeRoleRequest" } },
          },
        },
        responses: {
          200: { description: "Rôle changé", content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } },
          400: { description: "Ne peut pas changer son propre rôle / dernier SUPER_ADMIN / rôle invalide / champs en trop", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Cannot change your own role" } } } },
          401: { description: "Non authentifié", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Unauthorized" } } } },
          403: { description: "Réservé SUPER_ADMIN", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Forbidden" } } } },
          404: { description: "Utilisateur non trouvé", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Not found" } } } },
          413: { description: "Payload too large", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },

    // ==================== TICKETS ====================
    "/tickets": {
      post: {
        tags: ["Tickets"],
        summary: "Créer un ticket",
        description: "Accessible à tous les rôles authentifiés. Le createdById est automatiquement l'utilisateur connecté (ignoré s'il est dans le body).",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/CreateTicketRequest" } },
          },
        },
        responses: {
          201: { description: "Ticket créé", content: { "application/json": { schema: { $ref: "#/components/schemas/Ticket" } } } },
          400: { description: "Validation failed (champs en trop, title/description invalides)", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorWithDetails" } } } },
          401: { description: "Non authentifié", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Unauthorized" } } } },
          413: { description: "Payload too large", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
      get: {
        tags: ["Tickets"],
        summary: "Lister les tickets (pagination, filtre, tri)",
        description: "Retourne { data, meta }. SUPER_ADMIN/ADMIN/AGENT voient tous les tickets (y compris orphelins). USER voit seulement ses propres tickets. Filtres: status. Tri: createdAt, updatedAt, status (asc/desc). Pagination: page (défaut 1), limit (défaut 20, max 100).",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "status", in: "query", schema: { type: "string", enum: ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] }, description: "Filtrer par statut" },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 }, description: "Numéro de page" },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 }, description: "Éléments par page (max 100)" },
          { name: "sort", in: "query", schema: { type: "string", enum: ["createdAt", "updatedAt", "status"], default: "createdAt" }, description: "Champ de tri" },
          { name: "order", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" }, description: "Ordre de tri" },
        ],
        responses: {
          200: { description: "Liste paginée de tickets", content: { "application/json": { schema: { $ref: "#/components/schemas/PaginatedTickets" } } } },
          400: { description: "Paramètres invalides (page=0, sort=passwordHash, order=x, paramètre inconnu)", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorWithDetails" } } } },
          401: { description: "Non authentifié", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Unauthorized" } } } },
        },
      },
    },
    "/tickets/{id}": {
      get: {
        tags: ["Tickets"],
        summary: "Voir un ticket par ID",
        description: "SUPER_ADMIN/ADMIN/AGENT voient tous les tickets. USER voit seulement ses propres tickets (404 sinon, pas 403). Orphelins visibles seulement par SUPER_ADMIN/ADMIN/AGENT.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" }, description: "ID du ticket" },
        ],
        responses: {
          200: { description: "Ticket trouvé", content: { "application/json": { schema: { $ref: "#/components/schemas/Ticket" } } } },
          401: { description: "Non authentifié", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Unauthorized" } } } },
          404: { description: "Ticket non trouvé ou accès refusé (USER sur ticket d'autrui)", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Not found" } } } },
        },
      },
    },
    "/tickets/{id}/status": {
      patch: {
        tags: ["Tickets"],
        summary: "Mettre à jour le statut d'un ticket",
        description: "Réservé SUPER_ADMIN, ADMIN, AGENT. USER reçoit 403.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" }, description: "ID du ticket" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/UpdateTicketStatusRequest" } },
          },
        },
        responses: {
          200: { description: "Statut mis à jour", content: { "application/json": { schema: { $ref: "#/components/schemas/Ticket" } } } },
          400: { description: "Statut invalide ou validation failed", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorWithDetails" } } } },
          401: { description: "Non authentifié", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Unauthorized" } } } },
          403: { description: "Réservé SUPER_ADMIN, ADMIN, AGENT", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Forbidden" } } } },
          404: { description: "Ticket non trouvé", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Not found" } } } },
          413: { description: "Payload too large", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },

    // ==================== AUDIT LOGS ====================
    "/audit-logs": {
      get: {
        tags: ["Audit Logs"],
        summary: "Lister les logs d'audit",
        description: "Réservé SUPER_ADMIN. Pagination, filtres (action, actorId, targetType, targetId), tri (createdAt asc/desc). Aucun champ sensible (token, password, hash, email) dans la réponse.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "action", in: "query", schema: { type: "string", enum: ["USER_INVITED", "INVITATION_ACCEPTED", "USER_DISABLED", "USER_ENABLED", "ROLE_CHANGED", "PASSWORD_RESET_COMPLETED"] }, description: "Filtrer par action" },
          { name: "actorId", in: "query", schema: { type: "string", format: "uuid" }, description: "Filtrer par acteur" },
          { name: "targetType", in: "query", schema: { type: "string" }, description: "Filtrer par type de cible" },
          { name: "targetId", in: "query", schema: { type: "string", format: "uuid" }, description: "Filtrer par ID de cible" },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 }, description: "Numéro de page" },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 }, description: "Éléments par page (max 100)" },
          { name: "sortBy", in: "query", schema: { type: "string", enum: ["createdAt"], default: "createdAt" }, description: "Champ de tri" },
          { name: "sortOrder", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" }, description: "Ordre de tri" },
        ],
        responses: {
          200: { description: "Liste paginée de logs d'audit", content: { "application/json": { schema: { $ref: "#/components/schemas/PaginatedAuditLogs" } } } },
          400: { description: "Paramètres invalides", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorWithDetails" } } } },
          401: { description: "Non authentifié", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Unauthorized" } } } },
          403: { description: "Réservé SUPER_ADMIN", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Forbidden" } } } },
        },
      },
    },
  },
};

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

export { openApiSpec };