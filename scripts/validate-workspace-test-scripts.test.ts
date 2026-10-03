import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Workspace Test Scripts Alignment & Documentation', () => {
  const rootDir = resolve(__dirname, '..');

  it('validates root package.json defines aligned test scripts for backend and frontend', () => {
    const rootPkgPath = resolve(rootDir, 'package.json');
    expect(existsSync(rootPkgPath)).toBe(true);

    const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'));
    expect(rootPkg.scripts).toBeDefined();
    expect(rootPkg.scripts.test).toBeDefined();

    // Verify root test command includes backend with --runInBand --coverage and frontend with --run
    expect(rootPkg.scripts.test).toContain('--filter backend test');
    expect(rootPkg.scripts.test).toContain('--runInBand');
    expect(rootPkg.scripts.test).toContain('--coverage');
    expect(rootPkg.scripts.test).toContain('--filter frontend test');
  });

  it('validates backend/package.json test script runs jest with --runInBand and --coverage', () => {
    const backendPkgPath = resolve(rootDir, 'backend/package.json');
    expect(existsSync(backendPkgPath)).toBe(true);

    const backendPkg = JSON.parse(readFileSync(backendPkgPath, 'utf8'));
    expect(backendPkg.scripts).toBeDefined();
    expect(backendPkg.scripts.test).toBeDefined();

    expect(backendPkg.scripts.test).toContain('jest');
    expect(backendPkg.scripts.test).toContain('--runInBand');
    expect(backendPkg.scripts.test).toContain('--coverage');
  });

  it('validates frontend/package.json test script runs vitest in non-interactive mode', () => {
    const frontendPkgPath = resolve(rootDir, 'frontend/package.json');
    expect(existsSync(frontendPkgPath)).toBe(true);

    const frontendPkg = JSON.parse(readFileSync(frontendPkgPath, 'utf8'));
    expect(frontendPkg.scripts).toBeDefined();
    expect(frontendPkg.scripts.test).toBeDefined();

    expect(frontendPkg.scripts.test).toMatch(/^vitest\s+run/);
    expect(frontendPkg.scripts['test:run']).toBeDefined();
    expect(frontendPkg.scripts['test:watch']).toBeDefined();
  });

  it('validates CONTRIBUTING.md documents pnpm test vs pnpm -r test', () => {
    const contributingPath = resolve(rootDir, 'CONTRIBUTING.md');
    expect(existsSync(contributingPath)).toBe(true);

    const contributingContent = readFileSync(contributingPath, 'utf8');
    expect(contributingContent).toContain('pnpm test');
    expect(contributingContent).toContain('pnpm -r test');
    expect(contributingContent).toMatch(/Monorepo Root Commands:\s*`pnpm test`\s*vs\s*`pnpm -r test`/i);
    expect(contributingContent).toContain('--runInBand');
    expect(contributingContent).toContain('--coverage');
  });

  it('validates backend Jest configuration defines coverage settings', () => {
    const jestConfigPath = resolve(rootDir, 'backend/jest.config.js');
    expect(existsSync(jestConfigPath)).toBe(true);

    const jestConfigContent = readFileSync(jestConfigPath, 'utf8');
    expect(jestConfigContent).toContain('collectCoverageFrom');
    expect(jestConfigContent).toContain('coverageThreshold');
    expect(jestConfigContent).toContain('maxWorkers: 1');
  });

  it('validates frontend Vite configuration defines Vitest test setup and coverage settings', () => {
    const viteConfigPath = resolve(rootDir, 'frontend/vite.config.ts');
    expect(existsSync(viteConfigPath)).toBe(true);

    const viteConfigContent = readFileSync(viteConfigPath, 'utf8');
    expect(viteConfigContent).toContain('test:');
    expect(viteConfigContent).toContain('coverage:');
    expect(viteConfigContent).toContain('provider: "v8"');
  });
});
