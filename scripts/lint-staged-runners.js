#!/usr/bin/env node
/**
 * lint-staged runners.
 *
 * Invoked by lint-staged with the staged file paths appended:
 *   node scripts/lint-staged-runners.js eslint <files...>
 *   node scripts/lint-staged-runners.js rustfmt <files...>
 *
 * Why this exists instead of a bare `eslint --fix` config entry:
 * - ESLint is not a root dependency. `frontend` (eslint 9, flat config) and
 *   `backend` (eslint 8, eslintrc) each install their own copy, so a root-level
 *   `eslint` invocation cannot resolve. Each group of files is routed to the
 *   ESLint that owns it, run against that package's own config.
 * - The repository tracks a root `node_modules/` (see .gitignore, which only
 *   ignores /frontend/node_modules and /backend/node_modules). A bare
 *   `*.{ts,tsx}` glob would therefore match thousands of vendored files, so
 *   the package.json patterns are scoped to `frontend/` and `backend/`.
 */

const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

/** Rust edition for contracts, matching every Cargo.toml under contracts. */
const RUST_EDITION = '2021';

/**
 * Hard upper bounds on the child processes this script starts.
 *
 * `rustfmt` on Windows is a rustup shim: when the pinned toolchain is not
 * installed it attempts to download it, which hangs indefinitely without
 * network access. Without these timeouts a developer's `git commit` would block
 * forever rather than skipping the check.
 */
const PROBE_TIMEOUT_MS = 15_000;
const RUSTFMT_TIMEOUT_MS = 60_000;
const ESLINT_TIMEOUT_MS = 120_000;

/** Packages that own an ESLint config and therefore a local ESLint install. */
const ESLINT_PACKAGES = ['frontend', 'backend'];

/**
 * Split staged files into the owning package.
 *
 * @param {string[]} files repo-relative POSIX paths
 * @returns {Record<string, string[]>} package name -> files
 */
function groupByPackage(files) {
  /** @type {Record<string, string[]>} */
  const groups = {};
  for (const file of files) {
    const normalized = file.split(path.sep).join('/');
    const owner = ESLINT_PACKAGES.find((pkg) => normalized.startsWith(`${pkg}/`));
    if (!owner) continue;
    (groups[owner] ||= []).push(normalized);
  }
  return groups;
}

/**
 * Locate a package-local ESLint and return the path to its JS entry point.
 *
 * The entry is resolved from the package's own `bin` field and executed with
 * `process.execPath` rather than through the `.bin/eslint` shim. Two reasons:
 * the Windows shim is a `.cmd` that cannot be spawned with a piped stdin, and
 * passing argument arrays through `shell: true` is deprecated and unsafe
 * (Node DEP0190) because the arguments are only concatenated, not escaped.
 *
 * @param {string} pkg package directory name
 * @returns {string | null} absolute path to the ESLint CLI entry
 */
function resolveEslintLauncher(pkg) {
  const pkgJson = path.join(ROOT, pkg, 'node_modules', 'eslint', 'package.json');
  if (!fs.existsSync(pkgJson)) return null;

  try {
    const manifest = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
    const binField = manifest.bin;
    const relative = typeof binField === 'string' ? binField : binField && binField.eslint;
    if (!relative) return null;

    const entry = path.resolve(path.dirname(pkgJson), relative);
    return fs.existsSync(entry) ? entry : null;
  } catch {
    return null;
  }
}

/**
 * Run `eslint --fix` per owning package. Files whose ESLint is not installed
 * are reported and cause a non-zero exit so the gap is visible rather than
 * silently skipping linting.
 *
 * @param {string[]} files
 * @returns {number} process exit code
 */
function runEslint(files) {
  const groups = groupByPackage(files);
  const pkgNames = Object.keys(groups);

  if (pkgNames.length === 0) return 0;

  let failed = false;

  for (const pkg of pkgNames) {
    const launcher = resolveEslintLauncher(pkg);
    if (!launcher) {
      console.error(
        `[lint-staged] ESLint is not installed for "${pkg}". ` +
          `Run "npm install" in ${pkg}/ before committing ${pkg} files.`,
      );
      failed = true;
      continue;
    }

    const result = spawnSync(process.execPath, [launcher, '--fix', ...groups[pkg]], {
      cwd: path.join(ROOT, pkg),
      stdio: 'inherit',
      timeout: ESLINT_TIMEOUT_MS,
    });

    if (result.error) {
      const reason = result.error.code === 'ETIMEDOUT'
        ? `timed out after ${ESLINT_TIMEOUT_MS}ms`
        : result.error.message;
      console.error(`[lint-staged] ESLint failed for "${pkg}": ${reason}`);
      failed = true;
    } else if (result.status !== 0) {
      failed = true;
    }
  }

  return failed ? 1 : 0;
}

/**
 * Run `rustfmt --check` against only the staged Rust files.
 *
 * `cargo fmt --check` operates on a whole crate/workspace and cannot be
 * narrowed to a file list, so rustfmt is invoked directly with the repository's
 * edition. If rustfmt is unavailable the check is skipped with a notice rather
 * than blocking contributors who do not have a Rust toolchain; CI still runs
 * `cargo fmt --all -- --check` in full.
 *
 * @param {string[]} files
 * @returns {number} process exit code
 */
function runRustfmt(files) {
  const rustFiles = files
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => file.endsWith('.rs'))
    .map((file) => path.join(ROOT, file));

  if (rustFiles.length === 0) return 0;

  const probe = spawnSync('rustfmt', ['--version'], {
    stdio: 'ignore',
    timeout: PROBE_TIMEOUT_MS,
  });
  if (probe.error || probe.status !== 0) {
    const timedOut = probe.error && probe.error.code === 'ETIMEDOUT';
    console.warn(
      timedOut
        ? `[lint-staged] rustfmt probe timed out after ${PROBE_TIMEOUT_MS}ms; skipping Rust format check. ` +
          'CI runs `cargo fmt --all -- --check`.'
        : '[lint-staged] rustfmt not found; skipping Rust format check for staged files. ' +
          'CI runs `cargo fmt --all -- --check`.',
    );
    return 0;
  }

  // The probe above already established that rustfmt is invocable, so the real
  // run is spawned WITHOUT a shell: staged file paths then cannot be
  // interpreted as shell syntax (Node DEP0190), which matters because paths
  // come from the repository rather than from this script.
  const result = spawnSync('rustfmt', ['--check', '--edition', RUST_EDITION, ...rustFiles], {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: RUSTFMT_TIMEOUT_MS,
  });

  if (result.error) {
    const reason = result.error.code === 'ETIMEDOUT'
      ? `timed out after ${RUSTFMT_TIMEOUT_MS}ms`
      : result.error.message;
    console.error(`[lint-staged] rustfmt failed: ${reason}`);
    return 1;
  }
  return result.status === 0 ? 0 : 1;
}

function main(argv) {
  const [task, ...files] = argv;

  switch (task) {
    case 'eslint':
      return runEslint(files);
    case 'rustfmt':
      return runRustfmt(files);
    default:
      console.error(`[lint-staged] unknown task "${task}". Expected "eslint" or "rustfmt".`);
      return 1;
  }
}

module.exports = { groupByPackage, resolveEslintLauncher, runEslint, runRustfmt, ESLINT_PACKAGES, RUST_EDITION };

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
