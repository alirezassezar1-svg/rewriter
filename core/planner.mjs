import { Category } from '../constants/error-codes.mjs';
import { logger } from './logger.mjs';

/**
 * Layer 3 — produce an ordered plan of strategies to apply.
 */
export function plan(classification, capability) {
  const strategies = [];
  const warnings = [];
  const preflight = [];

  // Preflight
  if (!capability.hasLockfile) {
    preflight.push({ code: 'E_NO_LOCKFILE', message: 'No lockfile found — install may be non-reproducible' });
  }
  if (capability.nodeVersion.required && !capability.nodeVersion.required.includes('20') && !capability.nodeVersion.required.includes('>=18')) {
    preflight.push({ code: 'E_NODE_VERSION', message: `Project requests Node ${capability.nodeVersion.required}` });
  }

  // Dependency audit (server-only packages)
  const serverOnlyPkgs = ['pg', 'mysql2', 'better-sqlite3', 'sharp', 'fs-extra', 'bcrypt', 'argon2', 'bull', 'bullmq'];
  // (actual scan happens in transformer; here we just note)

  switch (classification.category) {
    case Category.STATIC_READY:
    case Category.DOCS_SITE:
      strategies.push({ id: 'pwa-inject', strategy: 'inject-pwa', priority: 10 });
      break;

    case Category.STATIC_CONVERTIBLE:
      if (classification.framework === 'next') {
        strategies.push({ id: 'next-export', strategy: 'next-to-export', priority: 20 });
      } else if (classification.framework === 'remix') {
        strategies.push({ id: 'remix-spa', strategy: 'remix-to-spa', priority: 20 });
      } else if (classification.framework === 'nuxt') {
        strategies.push({ id: 'nuxt-generate', strategy: 'nuxt-to-generate', priority: 20 });
      } else if (classification.framework === 'sveltekit') {
        strategies.push({ id: 'sveltekit-static', strategy: 'sveltekit-to-static', priority: 20 });
      } else if (classification.framework === 'tanstack-start') {
        strategies.push({ id: 'tanstack-spa', strategy: 'tanstack-to-spa', priority: 20 });
      } else if (classification.framework === 'astro') {
        strategies.push({ id: 'astro-static', strategy: 'astro-to-static', priority: 20 });
      }
      strategies.push({ id: 'pwa-inject', strategy: 'inject-pwa', priority: 10 });
      break;

    case Category.FULLSTACK_CONVERTIBLE:
      if (capability.dependencies.hasDb) {
        strategies.push({ id: 'db-pglite', strategy: 'pg-to-pglite-raw', priority: 30 });
      }
      if (capability.dependencies.hasAuth) {
        strategies.push({ id: 'auth-mock', strategy: 'strip-auth', priority: 25 });
      }
      strategies.push({ id: 'api-stub', strategy: 'stub-api', priority: 22 });
      if (classification.framework === 'next') {
        strategies.push({ id: 'next-export', strategy: 'next-to-export', priority: 20 });
      }
      strategies.push({ id: 'pwa-inject', strategy: 'inject-pwa', priority: 10 });
      warnings.push({
        code: 'W_FULLSTACK_MOCK',
        message: 'Auth and database will be mocked / replaced by client-side equivalents. OAuth and real persistence will not work.',
        severity: 'warn',
      });
      break;

    case Category.FULLSTACK_REQUIRES_SERVER:
    case Category.SERVER_ONLY:
    case Category.NATIVE_APP:
    case Category.STATIC_ALREADY_HOSTED:
    case Category.UNKNOWN:
      // no auto strategies
      break;

    default:
      break;
  }

  // Sort by priority descending
  strategies.sort((a, b) => b.priority - a.priority);

  return {
    strategies,
    warnings,
    preflight,
    estimatedBundleRisk: 'unknown', // refined after build
  };
}
