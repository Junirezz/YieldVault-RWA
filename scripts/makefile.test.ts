import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(__dirname, '..');
const TARGETS = ['help', 'install', 'test', 'lint', 'build', 'format', 'validate'];

describe('Root Makefile', () => {
  const makefilePath = resolve(rootDir, 'Makefile');

  it('exists at the repository root', () => {
    expect(existsSync(makefilePath)).toBe(true);
  });

  it('declares every target as phony and defaults to help', () => {
    const makefile = readFileSync(makefilePath, 'utf8');
    const phony = makefile.match(/^\.PHONY:(.*)$/m)?.[1].split(/\s+/) ?? [];
    for (const target of TARGETS) {
      expect(phony).toContain(target);
      expect(makefile).toMatch(new RegExp(`^${target}:.*## `, 'm'));
    }
    expect(makefile).toMatch(/^\.DEFAULT_GOAL := help$/m);
  });

  it('uses tab-indented recipes and LF line endings', () => {
    const makefile = readFileSync(makefilePath, 'utf8');
    expect(makefile).not.toContain('\r');
    expect(makefile).not.toMatch(/^ +(@|\$\(PNPM\))/m);
  });

  it('is documented in README.md', () => {
    const readme = readFileSync(resolve(rootDir, 'README.md'), 'utf8');
    for (const target of TARGETS) {
      expect(readme).toContain(`make ${target}`);
    }
  });
});
