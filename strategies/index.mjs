import { injectPwa } from './pwa/inject-pwa.mjs';
import { nextToExport } from './ssr/next-to-export.mjs';
import { stubApi } from './api/stub-api.mjs';
import { stripAuth } from './auth/strip-auth.mjs';
import { pgToMock } from './db/pg-to-mock.mjs';

const registry = {
  'inject-pwa': injectPwa,
  'next-to-export': nextToExport,
  'stub-api': stubApi,
  'strip-auth': stripAuth,
  'pg-to-pglite-raw': pgToMock,
  'pg-to-mock': pgToMock,
  // other strategies intentionally conservative / not fully automated
};

export function getStrategy(name) {
  return registry[name] || null;
}

export { registry };
