import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * Pins the commit message contract enforced by commitlint.config.js.
 *
 * Fixtures are linted by piping each message to the commitlint CLI, exactly the
 * way .husky/commit-msg does, so the test exercises the shipped config rather
 * than a re-implementation of it.
 */

const repoRoot = resolve(__dirname, '..');
const fixtureDir = join(__dirname, 'fixtures', 'commit-messages');

/**
 * Resolve @commitlint/cli's JS entry and run it with `node` directly. Invoking
 * the `.bin/commitlint.cmd` shim does not work here: on Windows the shim cannot
 * be spawned with a piped stdin, so every message would appear to fail.
 */
const commitlintCliPath = (() => {
  try {
    return require.resolve('@commitlint/cli/cli.js', { paths: [repoRoot] });
  } catch {
    return null;
  }
})();

function lintMessage(message: string): { ok: boolean; output: string } {
  if (!commitlintCliPath) {
    throw new Error('commitlint CLI not resolved');
  }
  try {
    const stdout = execFileSync(process.execPath, [commitlintCliPath], {
      cwd: repoRoot,
      input: message,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, output: stdout };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

function readFixture(name: string): string[] {
  const text = readFileSync(join(fixtureDir, name), 'utf8');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const commitlintInstalled = commitlintCliPath !== null;

describe('commit message toolchain', () => {
  // Always runs, so a missing binary fails loudly instead of silently skipping
  // the whole suite below.
  it('resolves the commitlint CLI that .husky/commit-msg depends on', () => {
    expect(
      commitlintInstalled,
      '@commitlint/cli is not installed; run "npm install".',
    ).toBe(true);
  });

  it('has an executable commit-msg hook shim', () => {
    expect(existsSync(join(repoRoot, '.husky', 'commit-msg'))).toBe(true);
  });

  it('declares @commitlint/cli as a devDependency', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.devDependencies['@commitlint/cli']).toBeDefined();
  });

  it('wires the commit-msg hook to commitlint', () => {
    const hook = readFileSync(join(repoRoot, '.husky', 'commit-msg'), 'utf8');
    expect(hook).toMatch(/commitlint/);
    expect(hook).toMatch(/--edit/);
  });
});

describe.skipIf(!commitlintInstalled)('commit message type case and vocabulary', () => {
  it('has the config and fixtures this suite depends on', () => {
    expect(existsSync(join(repoRoot, 'commitlint.config.js'))).toBe(true);
    expect(existsSync(join(fixtureDir, 'valid-lowercase.txt'))).toBe(true);
    expect(existsSync(join(fixtureDir, 'invalid-case-and-type.txt'))).toBe(true);
  });

  describe('lower-case fixture messages are accepted', () => {
    const messages = readFixture('valid-lowercase.txt');

    it('loads at least one fixture message', () => {
      expect(messages.length).toBeGreaterThan(0);
    });

    for (const message of messages) {
      it(`accepts: ${message.split(':')[0]}: ...`, () => {
        const result = lintMessage(message);
        expect(result.output).not.toMatch(/type-case/);
        expect(result.ok).toBe(true);
      }, 30_000);
    }
  });

  describe('upper-case and unknown-type fixture messages are rejected', () => {
    const messages = readFixture('invalid-case-and-type.txt');

    it('rejects every message that violates the type rules', () => {
      for (const message of messages) {
        const result = lintMessage(message);
        expect(result.ok, `expected rejection for: ${message}`).toBe(false);
        expect(result.output).toMatch(/type-case|type-enum/);
      }
    }, 120_000);

    it('rejects `Fix:` specifically, which the issue calls out', () => {
      const result = lintMessage('Fix: correct rounding on share price accrual');
      expect(result.ok).toBe(false);
      expect(result.output).toMatch(/type-case/);
    });

    it('accepts the lower-case counterpart of `Fix:`', () => {
      const result = lintMessage('fix: correct rounding on share price accrual');
      expect(result.ok).toBe(true);
    });

    it('rejects a type outside the allowed enum', () => {
      const result = lintMessage('wip: not in the allowed type enum');
      expect(result.ok).toBe(false);
      expect(result.output).toMatch(/type-enum/);
    });

    it('accepts ci: and style:, which cliff.toml groups and history uses', () => {
      // Issue #1461 proposed a six-type enum, which would have rejected both of
      // these. cliff.toml has dedicated groups for them and this repository's
      // history contains them, so the enum is the union of both sets.
      expect(lintMessage('ci: run cargo audit on pull requests').ok).toBe(true);
      expect(lintMessage('style: apply repo formatting').ok).toBe(true);
    }, 60_000);

    it('every accepted type has a matching group in cliff.toml', () => {
      const cliff = readFileSync(join(repoRoot, 'cliff.toml'), 'utf8');
      const types = (require(join(repoRoot, 'commitlint.config.js')) as {
        rules: Record<string, unknown>;
      }).rules['type-enum'] as [number, string, string[]];
      const allowed = types[2];

      for (const type of allowed) {
        // cliff.toml parsers are written as: { message = "^fix", group = ... }
        // A plain substring check avoids fragile regex escaping.
        expect(
          cliff.includes(`message = "^${type}`),
          `cliff.toml has no commit_parser for "${type}:"`,
        ).toBe(true);
      }
    });
  });
});
