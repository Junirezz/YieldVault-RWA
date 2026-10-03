#!/usr/bin/env node
/**
 * Checks that the active pnpm version satisfies the minimum required by this
 * monorepo (engines.pnpm in the root package.json).
 *
 * Exits 0 on success, 1 with a clear human-readable error on failure so CI
 * catches the mismatch before contributors hit ERR_PNPM_LOCKFILE_BREAKING_CHANGE.
 *
 * Usage:
 *   node scripts/check-pnpm-version.js          # run manually
 *   npm run check:pnpm-version                  # via package.json script
 */

'use strict';

const { execSync } = require('child_process');
const { readFileSync } = require('fs');
const path = require('path');

// ── Read required version from package.json ──────────────────────────────────

const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const required = (pkg.engines && pkg.engines.pnpm) || '>=9.12';

// Strip the ">=" prefix to get the minimum semver string.
const minVersion = required.replace(/^>=/, '').trim();
const parts = minVersion.split('.').map(Number);
const minMajor = parts[0];
const minMinor = parts[1] !== undefined ? parts[1] : 0;
const minPatch = parts[2] !== undefined ? parts[2] : 0;

// ── Detect installed pnpm version ────────────────────────────────────────────

let installedVersion;
try {
  installedVersion = execSync('pnpm --version', { encoding: 'utf8', timeout: 5000 }).trim();
} catch (_err) {
  console.error(
    '\n\u2716  pnpm not found.\n' +
    '   Install it via Corepack (recommended):\n' +
    '\n' +
    '     corepack enable\n' +
    '     corepack prepare pnpm@' + minVersion + ' --activate\n' +
    '\n' +
    '   Or via npm:\n' +
    '     npm install -g pnpm@' + minVersion + '\n',
  );
  process.exit(1);
}

// ── Compare versions ─────────────────────────────────────────────────────────

const vParts = installedVersion.split('.').map(Number);
const major = vParts[0];
const minor = vParts[1] !== undefined ? vParts[1] : 0;
const patch = vParts[2] !== undefined ? vParts[2] : 0;

const satisfies =
  major > minMajor ||
  (major === minMajor && minor > minMinor) ||
  (major === minMajor && minor === minMinor && patch >= minPatch);

if (!satisfies) {
  console.error(
    '\n\u2716  pnpm version mismatch.\n' +
    '\n' +
    '   Required : ' + required + '  (lockfile format v9)\n' +
    '   Installed: ' + installedVersion + '\n' +
    '\n' +
    '   Running pnpm ' + installedVersion + ' against a pnpm 9 lockfile will produce\n' +
    '   ERR_PNPM_LOCKFILE_BREAKING_CHANGE and a corrupted install.\n' +
    '\n' +
    '   Fix (Corepack \u2013 recommended):\n' +
    '     corepack enable\n' +
    '     corepack prepare pnpm@' + minVersion + ' --activate\n' +
    '\n' +
    '   Fix (npm global install):\n' +
    '     npm install -g pnpm@' + minVersion + '\n',
  );
  process.exit(1);
}

console.log('\u2714  pnpm ' + installedVersion + ' satisfies ' + required);
