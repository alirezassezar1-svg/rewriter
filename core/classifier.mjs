import { readFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { globby } from 'globby';
import { Category } from '../constants/error-codes.mjs';
import { logger } from './logger.mjs';

async function safeReadJson(p) {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return null;
  }
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Classify a project directory into exactly one Category.
 * Returns the full classifier result object required by the prompt.
 */
export async function classify(projectDir) {
  const reasons = [];
  const blockers = [];
  let confidence = 0.5;
  let framework = 'unknown';
  let category = Category.UNKNOWN;
  let suggestedAction = 'manual-review';

  const pkg = await safeReadJson(path.join(projectDir, 'package.json'));
  const hasPkg = Boolean(pkg);

  // --- NATIVE_APP detection ---
  const nativeMarkers = [
    'react-native',
    'react-native-cli',
    '@react-native-community',
    'expo',
    'flutter',
    'electron',
    'electron-builder',
    '@tauri-apps/api',
    'tauri',
    'capacitor',
    '@capacitor/core',
  ];
  const allDeps = {
    ...(pkg?.dependencies || {}),
    ...(pkg?.devDependencies || {}),
    ...(pkg?.peerDependencies || {}),
  };
  const depNames = Object.keys(allDeps);

  if (depNames.some((d) => nativeMarkers.some((m) => d.includes(m))) ||
      await exists(path.join(projectDir, 'android')) ||
      await exists(path.join(projectDir, 'ios')) ||
      await exists(path.join(projectDir, 'src-tauri')) ||
      await exists(path.join(projectDir, 'electron'))) {
    category = Category.NATIVE_APP;
    confidence = 0.95;
    reasons.push('Native / desktop / mobile markers detected (React Native, Electron, Tauri, Expo, Capacitor, android/ios folders)');
    blockers.push('PWA cannot replace a native application');
    suggestedAction = 'refuse';
    framework = depNames.find((d) => d.includes('react-native')) ? 'react-native' :
                depNames.find((d) => d.includes('electron')) ? 'electron' :
                depNames.find((d) => d.includes('tauri')) ? 'tauri' :
                depNames.find((d) => d.includes('expo')) ? 'expo' : 'native';
    return { category, confidence, reasons, blockers, framework, suggestedAction };
  }

  // --- SERVER_ONLY ---
  if (!hasPkg) {
    // maybe a pure Python / Go / Rust server
    if (await exists(path.join(projectDir, 'requirements.txt')) ||
        await exists(path.join(projectDir, 'go.mod')) ||
        await exists(path.join(projectDir, 'Cargo.toml')) ||
        await exists(path.join(projectDir, 'main.go'))) {
      category = Category.SERVER_ONLY;
      confidence = 0.9;
      reasons.push('No package.json and server-language markers present');
      blockers.push('No frontend detected');
      suggestedAction = 'refuse';
      return { category, confidence, reasons, blockers, framework: 'none', suggestedAction };
    }
  }

  // Check for frontend entrypoints
  const frontendFiles = await globby([
    'src/**/*.{tsx,jsx,vue,svelte,astro}',
    'app/**/*.{tsx,jsx}',
    'pages/**/*.{tsx,jsx}',
    'index.html',
    'public/index.html',
    'src/main.{ts,tsx,js,jsx}',
    'src/App.{ts,tsx,js,jsx}',
    'src/index.{ts,tsx,js,jsx}',
  ], { cwd: projectDir, deep: 5 });

  const hasFrontend = frontendFiles.length > 0 ||
    Boolean(pkg?.dependencies?.react || pkg?.dependencies?.vue || pkg?.dependencies?.svelte ||
            pkg?.dependencies?.['@angular/core'] || pkg?.dependencies?.astro ||
            pkg?.devDependencies?.vite || pkg?.devDependencies?.['@vitejs/plugin-react']);

  // Pure backend frameworks
  const backendOnly = ['express', 'fastify', 'koa', 'hapi', 'nestjs', '@nestjs/core', 'hono', 'elysia'];
  const isBackendHeavy = backendOnly.some((b) => depNames.includes(b)) && !hasFrontend;

  if (isBackendHeavy || (hasPkg && !hasFrontend && (pkg.main || pkg.bin))) {
    category = Category.SERVER_ONLY;
    confidence = 0.9;
    reasons.push('Backend framework detected with no frontend entrypoints');
    blockers.push('This is a server-only or library project');
    suggestedAction = 'refuse';
    framework = backendOnly.find((b) => depNames.includes(b)) || 'node-backend';
    return { category, confidence, reasons, blockers, framework, suggestedAction };
  }

  // --- DOCS_SITE ---
  const docsMarkers = ['docusaurus', 'vitepress', 'vuepress', 'mkdocs', 'docsify', 'gitbook', 'nextra'];
  if (docsMarkers.some((d) => depNames.includes(d)) ||
      await exists(path.join(projectDir, 'docs')) && await exists(path.join(projectDir, 'mkdocs.yml'))) {
    category = Category.DOCS_SITE;
    confidence = 0.92;
    reasons.push('Documentation site framework detected');
    framework = docsMarkers.find((d) => depNames.includes(d)) || 'docs';
    suggestedAction = 'auto';
    return { category, confidence, reasons, blockers, framework, suggestedAction };
  }

  // --- STATIC_ALREADY_HOSTED ---
  const hasGhPagesWorkflow = await exists(path.join(projectDir, '.github/workflows/deploy.yml')) ||
                             await exists(path.join(projectDir, '.github/workflows/pages.yml')) ||
                             await exists(path.join(projectDir, '.github/workflows/gh-pages.yml'));
  const hasNetlify = await exists(path.join(projectDir, 'netlify.toml'));
  const hasVercel = await exists(path.join(projectDir, 'vercel.json'));
  if (hasGhPagesWorkflow || hasNetlify || hasVercel) {
    // still allow conversion if user explicitly wants PWA, but mark
    reasons.push('Existing deploy config found (GitHub Pages / Netlify / Vercel)');
  }

  // Framework detection
  if (depNames.includes('next') || depNames.includes('next')) {
    framework = 'next';
  } else if (depNames.includes('@remix-run/react') || depNames.includes('@remix-run/node')) {
    framework = 'remix';
  } else if (depNames.includes('nuxt') || depNames.includes('nuxt3')) {
    framework = 'nuxt';
  } else if (depNames.includes('@sveltejs/kit')) {
    framework = 'sveltekit';
  } else if (depNames.includes('astro')) {
    framework = 'astro';
  } else if (depNames.includes('@tanstack/start') || depNames.includes('@tanstack/react-start')) {
    framework = 'tanstack-start';
  } else if (depNames.includes('vite') || pkg?.devDependencies?.vite) {
    framework = 'vite';
  } else if (depNames.includes('react-scripts')) {
    framework = 'cra';
  } else if (depNames.includes('parcel')) {
    framework = 'parcel';
  } else if (depNames.includes('@angular/core')) {
    framework = 'angular';
  } else if (hasFrontend) {
    framework = 'spa-unknown';
  }

  // Detect SSR / API / server actions
  const hasApiRoutes = (await globby(['**/api/**/*.{ts,js}', '**/routes/api/**/*', 'app/api/**/*', 'pages/api/**/*'], { cwd: projectDir })).length > 0;
  const hasServerActions = (await globby(['**/*.{ts,tsx,js,jsx}'], { cwd: projectDir, deep: 4 }))
    .length > 0; // cheap heuristic; refined later
  let serverActionCount = 0;
  // quick scan for "use server"
  try {
    const files = await globby(['**/*.{ts,tsx,js,jsx}'], { cwd: projectDir, deep: 5, ignore: ['node_modules/**', 'dist/**'] });
    for (const f of files.slice(0, 80)) { // limit
      const content = await readFile(path.join(projectDir, f), 'utf8').catch(() => '');
      if (content.includes('"use server"') || content.includes("'use server'")) serverActionCount++;
      if (content.includes('getServerSideProps') || content.includes('loader') && content.includes('export async function loader')) {
        // mark later
      }
    }
  } catch { /* ignore */ }

  const hasWebSocket = depNames.some((d) => d.includes('ws') || d.includes('socket.io'));
  const hasDbDriver = depNames.some((d) => ['pg', 'mysql2', 'better-sqlite3', 'mongodb', 'mongoose', 'prisma', '@prisma/client', 'drizzle-orm', 'kysely'].includes(d));
  const hasAuthLib = depNames.some((d) => ['next-auth', '@auth/core', 'better-auth', '@clerk/nextjs', '@clerk/clerk-react', 'passport', 'lucia'].includes(d));
  const hasBackground = depNames.some((d) => ['bull', 'bullmq', 'agenda', 'node-cron', 'cron'].includes(d));

  // STATIC_READY
  const staticReadyFrameworks = ['vite', 'cra', 'parcel', 'astro'];
  if (staticReadyFrameworks.includes(framework) && !hasApiRoutes && !hasDbDriver && serverActionCount === 0) {
    category = Category.STATIC_READY;
    confidence = 0.9;
    reasons.push(`${framework} project with no server-side features detected`);
    suggestedAction = 'auto';
    return { category, confidence, reasons, blockers, framework, suggestedAction };
  }

  // Astro / VitePress already static by default
  if (framework === 'astro' || framework === 'vitepress') {
    category = Category.STATIC_READY;
    confidence = 0.93;
    reasons.push(`${framework} is static by default`);
    suggestedAction = 'auto';
    return { category, confidence, reasons, blockers, framework, suggestedAction };
  }

  // STATIC_CONVERTIBLE
  if (['next', 'remix', 'nuxt', 'sveltekit', 'tanstack-start'].includes(framework)) {
    if (!hasWebSocket && !hasBackground && serverActionCount < 5 && !hasApiRoutes) {
      category = Category.STATIC_CONVERTIBLE;
      confidence = 0.85;
      reasons.push(`${framework} detected with limited or no server features — can convert to static/SPA`);
      suggestedAction = 'auto';
      return { category, confidence, reasons, blockers, framework, suggestedAction };
    }
  }

  // FULLSTACK_CONVERTIBLE vs REQUIRES_SERVER
  if (hasDbDriver || hasAuthLib || hasApiRoutes || serverActionCount > 0) {
    const apiCount = hasApiRoutes ? 10 : 0; // rough
    let score = 70;
    if (apiCount > 15 || serverActionCount > 10) score -= 40;
    if (hasWebSocket) score -= 50;
    if (hasBackground) score -= 40;
    if (hasAuthLib && (depNames.includes('next-auth') || depNames.includes('@clerk/nextjs'))) score -= 20;

    if (score >= 50 && !hasWebSocket && !hasBackground) {
      category = Category.FULLSTACK_CONVERTIBLE;
      confidence = Math.min(0.8, score / 100 + 0.2);
      reasons.push('Full-stack features present but appear transformable to client-side (PGlite + mock auth)');
      blockers.push(...(hasAuthLib ? ['OAuth / third-party auth will be mocked'] : []));
      blockers.push(...(hasDbDriver ? ['Database will be replaced by in-browser PGlite or mock'] : []));
      suggestedAction = confidence >= 0.6 ? 'auto' : 'manual-review';
      return { category, confidence, reasons, blockers, framework, suggestedAction };
    } else {
      category = Category.FULLSTACK_REQUIRES_SERVER;
      confidence = 0.88;
      reasons.push('Persistent server features detected (WebSocket, background jobs, heavy auth/API surface)');
      blockers.push('Requires a real backend process');
      if (hasWebSocket) blockers.push('WebSocket server cannot run in static hosting');
      if (hasBackground) blockers.push('Cron / queue workers require a long-running process');
      suggestedAction = 'refuse';
      return { category, confidence, reasons, blockers, framework, suggestedAction };
    }
  }

  // Fallback STATIC_READY or CONVERTIBLE
  if (hasFrontend && framework !== 'unknown') {
    category = Category.STATIC_CONVERTIBLE;
    confidence = 0.7;
    reasons.push('Frontend detected; assuming convertible');
    suggestedAction = 'auto';
    return { category, confidence, reasons, blockers, framework, suggestedAction };
  }

  // UNKNOWN
  category = Category.UNKNOWN;
  confidence = 0.3;
  reasons.push('Could not confidently classify the project');
  blockers.push('Manual inspection required');
  suggestedAction = 'manual-review';
  return { category, confidence, reasons, blockers, framework, suggestedAction };
}
