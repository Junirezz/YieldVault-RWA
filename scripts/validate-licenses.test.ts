import { describe, expect, it } from 'vitest';
import * as path from 'path';
import {
  parseCargoLicense,
  validateLicenses,
} from './validate-licenses';

describe('validate-licenses', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('parses license from Cargo.toml workspace or package definitions', () => {
    expect(
      parseCargoLicense(`
      [workspace.package]
      license = "MIT"
    `),
    ).toBe('MIT');

    expect(
      parseCargoLicense(`
      [package]
      name = "vault"
      license = "MIT"
    `),
    ).toBe('MIT');

    expect(
      parseCargoLicense(`
      [package]
      name = "vault"
      license.workspace = true
    `),
    ).toBe('MIT (workspace)');

    expect(
      parseCargoLicense(`
      [package]
      name = "vault"
    `),
    ).toBeUndefined();
  });

  it('validates that repository root LICENSE exists and is MIT', () => {
    const result = validateLicenses(rootDir);
    expect(result.inspected.licenseFile.exists).toBe(true);
    expect(result.inspected.licenseFile.isMit).toBe(true);
  });

  it('validates that all workspace package.json files specify MIT license without Apache-2.0 publish ambiguity', () => {
    const result = validateLicenses(rootDir);
    expect(result.inspected.packageJsonFiles.length).toBeGreaterThan(0);

    for (const pkg of result.inspected.packageJsonFiles) {
      expect(pkg.license).toBe('MIT');
    }

    const hasApache = result.inspected.packageJsonFiles.some((p) => p.license === 'Apache-2.0');
    expect(hasApache).toBe(false);
  });

  it('validates that all workspace Cargo.toml files specify MIT license without Apache-2.0 publish ambiguity', () => {
    const result = validateLicenses(rootDir);
    expect(result.inspected.cargoTomlFiles.length).toBeGreaterThan(0);

    for (const cargo of result.inspected.cargoTomlFiles) {
      expect(['MIT', 'MIT (workspace)']).toContain(cargo.license);
    }

    const hasApache = result.inspected.cargoTomlFiles.some((c) => c.license === 'Apache-2.0');
    expect(hasApache).toBe(false);
  });

  it('asserts that the full workspace license validation passes with zero errors', () => {
    const result = validateLicenses(rootDir);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
