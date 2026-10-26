export function printHelp() {
  console.log(`
rewriter — honest GitHub → Static PWA converter

USAGE
  rewriter migrate <input> [options]
  rewriter inspect <input>
  rewriter batch <manifest.txt>
  rewriter --version
  rewriter --help

INPUT FORMS
  ./my-repo.zip
  ./extracted-folder/
  https://github.com/user/repo
  https://github.com/user/repo/tree/dev
  ./repos/*.zip
  --manifest ./repos.txt

OPTIONS
  --offline          Prefer local npm cache only
  --dry-run          Classify + plan only, no transform/build
  --keep-source      Copy transformed source into output/source/
  --output <dir>     Output root (default: ./output)
  --timeout <ms>     Per-input timeout (default: 900000)
  --concurrency <n>  Parallelism for batch (default: 2)
  --json             Machine-readable stdout
  --force            Proceed even if confidence < 0.6 (dangerous)
  --verbose          Debug logging

EXIT BEHAVIOUR
  The tool never pretends success. Categories that require a real
  server, are native apps, or have no frontend are refused with an
  actionable REPORT.md (Persian + English).

SAFETY
  • Original user files are never modified (all work in os.tmpdir())
  • Suspicious postinstall scripts cause an immediate refuse
  • Zero telemetry, zero network after git clone / npm install
`);
}
