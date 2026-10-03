import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const {
  groupByPackage,
  resolveEslintLauncher,
  runEslint,
  runRustfmt,
  ESLINT_PACKAGES,
  RUST_EDITION,
} = require('./lint-staged-runners.js');

describe('lint-staged runners', () => {
  describe('groupByPackage', () => {
    it('routes frontend files to the frontend group', () => {
      expect(groupByPackage(['frontend/src/App.tsx'])).toEqual({
        frontend: ['frontend/src/App.tsx'],
      });
    });

    it('routes backend files to the backend group', () => {
      expect(groupByPackage(['backend/src/server.ts'])).toEqual({
        backend: ['backend/src/server.ts'],
      });
    });

    it('keeps frontend and backend files in separate groups', () => {
      const groups = groupByPackage([
        'frontend/src/a.ts',
        'backend/src/b.ts',
        'frontend/src/c.tsx',
      ]);
      expect(Object.keys(groups).sort()).toEqual(['backend', 'frontend']);
      expect(groups.frontend).toHaveLength(2);
      expect(groups.backend).toHaveLength(1);
    });

    it('ignores files outside the packages that own an eslint config', () => {
      expect(groupByPackage(['scripts/foo.ts', 'docs/examples/bar.ts'])).toEqual({});
    });

    it('never groups vendored node_modules files, which are tracked in git', () => {
      const groups = groupByPackage([
        'node_modules/typescript/lib/typescript.js',
        'frontend/src/real.ts',
      ]);
      expect(groups).toEqual({ frontend: ['frontend/src/real.ts'] });
    });

    it('covers both configured eslint packages', () => {
      expect(ESLINT_PACKAGES).toEqual(['frontend', 'backend']);
    });
  });

  describe('resolveEslintLauncher', () => {
    it('returns null instead of throwing when eslint is not installed', () => {
      const launcher = resolveEslintLauncher('definitely-not-a-package');
      expect(launcher).toBeNull();
    });

    it('resolves to a JS entry point, never a .cmd shim', () => {
      // The runner executes ESLint with process.execPath, so the resolved value
      // must be a script. A .cmd shim cannot be spawned with a piped stdin and
      // would require the deprecated shell: true (Node DEP0190).
      for (const pkg of ESLINT_PACKAGES) {
        const launcher = resolveEslintLauncher(pkg);
        if (launcher === null) continue;
        expect(launcher.endsWith('.js')).toBe(true);
        expect(launcher).not.toContain('.bin');
      }
    });
  });

  describe('runEslint', () => {
    it('is a no-op when no eslint-owned files are staged', () => {
      expect(runEslint(['README.md', 'node_modules/left-pad/index.js'])).toBe(0);
    });

    it('fails loudly when a staged file has no installed eslint', () => {
      // `frontend` declares eslint as a devDependency but may not be installed
      // in every environment; the runner must not silently skip the check.
      const groups = groupByPackage(['frontend/src/App.tsx']);
      const installed = resolveEslintLauncher('frontend') !== null;
      expect(runEslint(['frontend/src/App.tsx'])).toBe(installed ? 0 : 1);
      expect(Object.keys(groups)).toEqual(['frontend']);
    });
  });

  describe('runRustfmt', () => {
    it('ignores staged non-Rust files', () => {
      expect(runRustfmt(['README.md', 'frontend/src/App.tsx'])).toBe(0);
    });

    it('bounds the rustfmt call so an uninstalled toolchain cannot hang a commit', () => {
      // On Windows `rustfmt` is a rustup shim that tries to download the pinned
      // toolchain and will block indefinitely without network access. The runner
      // must terminate and return a documented status rather than hang.
      const target = resolve('contracts/mock-strategy/src/lib.rs');
      const started = Date.now();
      const status = runRustfmt([target]);
      const elapsed = Date.now() - started;

      expect(typeof status).toBe('number');
      // 60s rustfmt budget + 15s probe budget.
      expect(elapsed).toBeLessThan(90_000);
    }, 120_000);

    it('exposes the edition used for rustfmt', () => {
      expect(RUST_EDITION).toBe('2021');
    });
  });
});
