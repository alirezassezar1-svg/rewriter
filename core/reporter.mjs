import { writeFile, mkdir, cp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.mjs';
import { Category } from '../constants/error-codes.mjs';

function statusEmoji(status) {
  if (status === 'success') return '✅ موفق';
  if (status === 'partial') return '⚠️ جزئی';
  return '❌ ناموفق';
}

function statusEmojiEn(status) {
  if (status === 'success') return '✅ Success';
  if (status === 'partial') return '⚠️ Partial';
  return '❌ Failed / Unsupported';
}

/**
 * Generate REPORT.md (Persian primary + English section) and report.json
 */
export async function writeReports(outDir, ctx) {
  await mkdir(outDir, { recursive: true });
  await mkdir(path.join(outDir, 'analysis'), { recursive: true });
  await mkdir(path.join(outDir, 'deploy'), { recursive: true });

  const {
    inputMeta,
    classification,
    capability,
    planResult,
    transformResult,
    verifyResult,
    status,
    durationMs,
  } = ctx;

  // --- report.json ---
  const reportJson = {
    input: {
      type: inputMeta.inputType,
      path: inputMeta.originalPath,
      sha: inputMeta.sha,
    },
    category: classification.category,
    status,
    confidence: classification.confidence,
    appliedTransforms: transformResult?.applied || [],
    warnings: planResult?.warnings || [],
    blockers: (classification.blockers || []).map((b) => ({
      code: 'BLOCKER',
      message: b,
      manualFix: 'See REPORT.md',
    })),
    build: {
      ok: verifyResult?.buildOk || false,
      durationMs: verifyResult?.durationMs || 0,
      errors: verifyResult?.errors || [],
    },
    smoke: {
      ok: verifyResult?.smokeOk || false,
      consoleErrors: verifyResult?.consoleErrors || [],
      bundleSize: verifyResult?.bundleSize || 0,
    },
    deployGuide: 'deploy/DEPLOY.md',
    durationMs,
  };

  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(reportJson, null, 2), 'utf8');
  await writeFile(path.join(outDir, 'analysis', 'capability.json'), JSON.stringify(capability || {}, null, 2), 'utf8');
  await writeFile(path.join(outDir, 'analysis', 'plan.json'), JSON.stringify(planResult || {}, null, 2), 'utf8');

  // --- REPORT.md (Persian first) ---
  const lines = [];
  lines.push(`# گزارش تبدیل: ${path.basename(inputMeta.originalPath || 'project')}`);
  lines.push('');
  lines.push(`## نتیجه: ${statusEmoji(status)}`);
  lines.push('');
  lines.push('## خلاصه اجرایی');
  if (status === 'success') {
    lines.push('پروژه با موفقیت به یک PWA استاتیک تبدیل شد و آمادهٔ استقرار روی GitHub Pages است.');
  } else if (status === 'partial') {
    lines.push('تبدیل جزئی انجام شد. برخی قابلیت‌ها حذف یا شبیه‌سازی شده‌اند. جزئیات در بخش «آنچه کار نمی‌کند» آمده است.');
  } else {
    lines.push(`این پروژه قابل تبدیل خودکار به PWA استاتیک نیست. دلیل: ${classification.reasons?.[0] || 'نامشخص'}.`);
  }
  lines.push('');
  lines.push('## دسته‌بندی');
  lines.push(`- نوع: \`${classification.category}\``);
  lines.push(`- فریم‌ورک: ${classification.framework}`);
  lines.push(`- اعتماد: ${Math.round((classification.confidence || 0) * 100)}٪`);
  lines.push(`- اقدام پیشنهادی: ${classification.suggestedAction}`);
  lines.push('');
  lines.push('## دلایل دسته‌بندی');
  for (const r of classification.reasons || []) {
    lines.push(`- ${r}`);
  }
  lines.push('');

  if (transformResult?.applied?.length) {
    lines.push('## تبدیل‌های انجام‌شده');
    transformResult.applied.forEach((t, i) => {
      const mark = t.skipped || t.error ? '⚠️' : '✅';
      lines.push(`${i + 1}. ${mark} \`${t.strategy}\` (فایل‌های تغییر یافته: ${t.filesChanged}${t.fallbackUsed ? ' — با فال‌بک' : ''})`);
    });
    lines.push('');
  }

  if (classification.blockers?.length) {
    lines.push('## آنچه کار نمی‌کند (صادقانه)');
    for (const b of classification.blockers) {
      lines.push(`- ${b}`);
    }
    lines.push('');
  }

  if (verifyResult?.errors?.length) {
    lines.push('## خطاهای بیلد / بررسی');
    for (const e of verifyResult.errors) {
      lines.push(`- ${e}`);
    }
    lines.push('');
  }

  lines.push('## دستورات بعدی');
  if (status === 'success' || status === 'partial') {
    lines.push('1. محتویات پوشه `dist/` را بررسی کنید');
    lines.push('2. یک مخزن گیت‌هاب جدید بسازید و فایل‌های `dist/` را push کنید');
    lines.push('3. در Settings → Pages منبع را روی GitHub Actions یا branch مربوطه تنظیم کنید');
    lines.push('4. فایل `deploy/gh-pages.yml` را در `.github/workflows/` کپی کنید');
  } else {
    lines.push('1. گزارش را بخوانید و تصمیم بگیرید آیا می‌خواهید بک‌اند جداگانه نگه دارید');
    lines.push('2. در صورت تمایل فقط فرانت‌اند را دستی استاتیک کنید');
  }
  lines.push('');

  // English section
  lines.push('---');
  lines.push('');
  lines.push(`# Conversion Report (English)`);
  lines.push('');
  lines.push(`## Result: ${statusEmojiEn(status)}`);
  lines.push('');
  lines.push(`**Category:** ${classification.category}  `);
  lines.push(`**Framework:** ${classification.framework}  `);
  lines.push(`**Confidence:** ${Math.round((classification.confidence || 0) * 100)}%  `);
  lines.push(`**Suggested action:** ${classification.suggestedAction}`);
  lines.push('');
  lines.push('### Reasons');
  for (const r of classification.reasons || []) lines.push(`- ${r}`);
  lines.push('');
  if (classification.blockers?.length) {
    lines.push('### Blockers (honest)');
    for (const b of classification.blockers) lines.push(`- ${b}`);
    lines.push('');
  }
  lines.push(`Total duration: ${durationMs} ms`);
  lines.push('');

  await writeFile(path.join(outDir, 'REPORT.md'), lines.join('\n'), 'utf8');

  // --- deploy files ---
  const deployMd = `# Deploy to GitHub Pages

## Quick path (recommended)

1. Create a new GitHub repository (public).
2. Copy everything inside \`dist/\` into the root of that repository (or into a \`docs/\` folder).
3. Push to the \`main\` branch.
4. Go to **Settings → Pages**.
5. Under "Build and deployment" choose **Deploy from a branch**.
6. Select branch \`main\` and folder \`/\` (or \`/docs\`).
7. Save. After a minute your site will be live at \`https://<user>.github.io/<repo>/\`.

## Using the included workflow

1. Copy \`deploy/gh-pages.yml\` to \`.github/workflows/gh-pages.yml\` in a repository that contains the **source** (not only dist).
2. Adjust the build steps if your package manager is pnpm/yarn.
3. Push. The workflow will build and publish automatically.

## Notes

- Service worker + manifest are already injected when conversion succeeded.
- If your app uses client-side routing, make sure the host serves \`index.html\` for all paths (GitHub Pages does this with a 404.html trick or the Actions workflow).
- Environment variables that were not \`VITE_*\` / \`NEXT_PUBLIC_*\` are **not** available in the browser.
`;

  await writeFile(path.join(outDir, 'deploy', 'DEPLOY.md'), deployMd, 'utf8');

  const ghPagesYml = `name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
`;
  await writeFile(path.join(outDir, 'deploy', 'gh-pages.yml'), ghPagesYml, 'utf8');

  logger.success(`Reports written to ${outDir}`);
  return reportJson;
}
