import { describe, it, expect, beforeAll } from 'vitest';
import { openApiSpec } from '../../src/openapi.js';
import { authRouter } from '../../src/modules/auth/routes.js';
import { usersRouter } from '../../src/modules/users/routes.js';
import { ticketsRouter } from '../../src/modules/tickets/routes.js';
import { auditRouter } from '../../src/modules/audit/routes.js';
import { aiRouter } from '../../src/modules/ai/routes.js';

function extractRoutesFromRouter(router: any, basePath: string): Array<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = [];

  if (!router || !router.stack) {
    return routes;
  }

  router.stack.forEach((layer: any) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).map((m) => m.toUpperCase());
      methods.forEach((method) => {
        let fullPath = basePath + layer.route.path;
        fullPath = fullPath.replace(/\/+/g, '/');
        routes.push({ method, path: fullPath });
      });
    }
  });

  return routes;
}

function extractRoutesFromApp(): Array<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = [];

  // Routes des modules (via leurs routers exportés)
  routes.push(...extractRoutesFromRouter(authRouter, '/auth'));
  routes.push(...extractRoutesFromRouter(usersRouter, '/users'));
  routes.push(...extractRoutesFromRouter(ticketsRouter, '/tickets'));
  routes.push(...extractRoutesFromRouter(auditRouter, '/audit-logs'));
  routes.push(...extractRoutesFromRouter(aiRouter, '/ai'));

  // Dédupliquer
  const unique = routes.filter(
    (r, i, arr) => arr.findIndex((x) => x.method === r.method && x.path === r.path) === i
  );

  return unique.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function extractPathsFromSpec(): Array<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = [];

  for (const [path, pathItem] of Object.entries(openApiSpec.paths)) {
    for (const [method, _operation] of Object.entries(pathItem)) {
      if (['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) {
        routes.push({ method: method.toUpperCase(), path });
      }
    }
  }

  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

describe('OpenAPI Coverage', () => {
  let appRoutes: Array<{ method: string; path: string }>;
  let specRoutes: Array<{ method: string; path: string }>;

  beforeAll(() => {
    appRoutes = extractRoutesFromApp();
    specRoutes = extractPathsFromSpec();
  });

  it('toutes les routes de l\'app sont documentées dans la spec', () => {
    const missing: Array<{ method: string; path: string }> = [];

    for (const appRoute of appRoutes) {
      // Ignorer les routes de documentation
      if (appRoute.path.startsWith('/docs') || appRoute.path === '/openapi.json') {
        continue;
      }
      // Ignorer la route 404 catch-all
      if (appRoute.path === '*' || appRoute.path === '/*') {
        continue;
      }

      const found = specRoutes.some(
        (s) =>
          s.method === appRoute.method &&
          normalizePath(s.path) === normalizePath(appRoute.path)
      );

      if (!found) {
        missing.push(appRoute);
      }
    }

    if (missing.length > 0) {
      console.log('Routes manquantes dans la spec:', JSON.stringify(missing, null, 2));
    }

    expect(missing).toEqual([]);
  });

  it('toutes les routes de la spec sont montées dans l\'app', () => {
    const extra: Array<{ method: string; path: string }> = [];

    for (const specRoute of specRoutes) {
      const found = appRoutes.some(
        (a) =>
          a.method === specRoute.method &&
          normalizePath(a.path) === normalizePath(specRoute.path)
      );

      if (!found) {
        extra.push(specRoute);
      }
    }

    if (extra.length > 0) {
      console.log('Routes dans la spec mais pas dans l\'app:', JSON.stringify(extra, null, 2));
    }

    expect(extra).toEqual([]);
  });

  it('la spec contient toutes les routes attendues (checklist)', () => {
    const expectedRoutes = [
      // Auth
      { method: 'POST', path: '/auth/login' },
      { method: 'POST', path: '/auth/refresh' },
      { method: 'POST', path: '/auth/logout' },
      { method: 'POST', path: '/auth/forgot-password' },
      { method: 'POST', path: '/auth/reset-password' },
      { method: 'POST', path: '/auth/accept-invitation' },
      { method: 'GET', path: '/auth/me' },
      // Users
      { method: 'POST', path: '/users' },
      { method: 'GET', path: '/users' },
      { method: 'PATCH', path: '/users/{id}/disable' },
      { method: 'PATCH', path: '/users/{id}/enable' },
      { method: 'PATCH', path: '/users/{id}/role' },
      // Tickets
      { method: 'POST', path: '/tickets' },
      { method: 'GET', path: '/tickets' },
      { method: 'GET', path: '/tickets/{id}' },
      { method: 'PATCH', path: '/tickets/{id}/status' },
      // Audit
      { method: 'GET', path: '/audit-logs' },
      // AI
      { method: 'POST', path: '/ai/ask' },
      { method: 'GET', path: '/ai/history' },
    ];

    for (const expected of expectedRoutes) {
      const found = specRoutes.some(
        (s) =>
          s.method === expected.method &&
          normalizePath(s.path) === normalizePath(expected.path)
      );
      if (!found) {
        console.log('Route attendue manquante dans la spec:', expected);
      }
      expect(found).toBe(true);
    }
  });
});

function normalizePath(path: string): string {
  // Convertir les paramètres OpenAPI {id} vers :id Express pour comparaison
  // et normaliser les slashes trailing
  return path.replace(/\{([^}]+)\}/g, ':$1').replace(/\/+$/, '') || '/';
}