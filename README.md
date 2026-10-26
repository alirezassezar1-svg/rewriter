# rewriter

**Honest GitHub → Static PWA converter**

A production-minded CLI that classifies any repository, attempts a safe conversion to a static Progressive Web App when feasible, and **never pretends success** when the project fundamentally needs a server, is a native app, or has no frontend.

## Architecture (6 layers)

```
┌─────────────────────────────────────────────────────────┐
│  Layer 0  Fetcher / Unpacker                            │
│  zip | dir | git URL | glob | monorepo detection        │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 1  Classifier  (most important)                  │
│  8 categories → auto | manual-review | refuse            │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 2  Detector                                      │
│  framework, build tool, env vars, DB/auth surface       │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 3  Planner                                       │
│  ordered strategy list + preflight warnings             │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 4  Transformer                                   │
│  next-to-export, stub-api, strip-auth, inject-pwa…      │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 5  Verifier                                      │
│  npm install → build → index.html smoke + size check   │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 6  Reporter                                      │
│  REPORT.md (FA+EN) + report.json + deploy/              │
└─────────────────────────────────────────────────────────┘
```

## Categories

| Category | Meaning | Action |
|----------|---------|--------|
| `STATIC_READY` | Already static (Vite, CRA, Astro…) | Build + PWA |
| `STATIC_CONVERTIBLE` | SSR framework that can go static | Convert + PWA |
| `FULLSTACK_CONVERTIBLE` | Auth/DB present but mockable | Convert with warnings |
| `FULLSTACK_REQUIRES_SERVER` | WebSockets, jobs, real OAuth callbacks | Refuse + explain |
| `SERVER_ONLY` | Express API, CLI, library | Refuse |
| `NATIVE_APP` | RN / Electron / Tauri / Flutter | Refuse |
| `DOCS_SITE` | Docusaurus, VitePress… | Build + PWA |
| `STATIC_ALREADY_HOSTED` | Existing Pages/Netlify/Vercel config | Report & skip |
| `UNKNOWN` | Cannot classify | Refuse / ask |

## CLI

```bash
npm install
node index.mjs migrate ./my-app.zip
node index.mjs migrate https://github.com/user/repo
node index.mjs inspect ./my-app
node index.mjs batch repos.txt
```

| Flag | Purpose |
|------|---------|
| `--dry-run` | Classify + plan only |
| `--offline` | Prefer npm cache |
| `--force` | Override low-confidence refuse |
| `--keep-source` | Keep transformed source tree |
| `--json` | Machine output |
| `--output <dir>` | Custom output root |

## What this tool will NEVER do

- Modify your original files (everything runs under `os.tmpdir()`)
- Claim success when a persistent server is required
- Silently delete API routes or auth code (it annotates them)
- Run arbitrary `postinstall` scripts without an audit
- Emit telemetry or make network calls beyond `git clone` / `npm install`
- Turn a React Native / Electron app into a “PWA equivalent”

## Honest limits

- Complex server actions, webhooks, and file-upload endpoints cannot be made static.
- OAuth login flows require a real callback server; they are mocked or removed.
- Database drivers (`pg`, Prisma, etc.) are annotated for manual port to PGlite or a remote API.
- Bundle sizes > 5 MB are warned — some mobile browsers refuse large PWAs.

## Troubleshooting (common failures)

1. **E_NO_PACKAGE_JSON** — Not a Node project or wrong folder selected.
2. **E_SERVER_ESSENTIAL** — WebSockets / cron / payment webhooks detected.
3. **E_NATIVE_APP** — Mobile or desktop shell present.
4. **E_INSTALL_FAILED** — Private registry or native addon compilation failed.
5. **E_BUILD_FAILED** — Framework config incompatible with static export.
6. **E_LOW_CONFIDENCE** — Classifier unsure; use `--force` only if you understand the risk.
7. **E_SUSPICIOUS_SCRIPT** — `curl | sh` or `rm -rf` found in scripts.
8. **E_MISSING_ASSETS** — Build succeeded but no `index.html` in dist.
9. **E_SMOKE_FAILED** — Generated HTML looks empty or broken.
10. **E_CLONE_FAILED** — Network or auth issue while cloning.

## Design decisions (conservative defaults)

- Confidence < 0.6 → refuse unless `--force`.
- API routes are annotated, never deleted.
- Auth libraries are annotated; a real mock is left as a future improvement.
- Playwright is optional; smoke test is pure filesystem + HTML heuristics.
- Monorepo workspaces are detected; full fan-out is best-effort.

## License

MIT
