import * as fs from 'fs';
import * as path from 'path';

export interface LicenseValidationResult {
  valid: boolean;
  errors: string[];
  inspected: {
    packageJsonFiles: Array<{ file: string; license?: string }>;
    cargoTomlFiles: Array<{ file: string; license?: string }>;
    licenseFile: { exists: boolean; isMit: boolean };
  };
}

export function findFiles(dir: string, pattern: RegExp, ignoreDirs = ['node_modules', '.git', 'dist', 'target']): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoreDirs.includes(entry.name)) {
        results.push(...findFiles(fullPath, pattern, ignoreDirs));
      }
    } else if (pattern.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

export function parseCargoLicense(content: string): string | undefined {
  // Check [workspace.package] license or [package] license
  const workspacePackageMatch = content.match(/\[workspace\.package\][\s\S]*?license\s*=\s*["']([^"']+)["']/);
  if (workspacePackageMatch) return workspacePackageMatch[1];

  const packageMatch = content.match(/\[package\][\s\S]*?license\s*=\s*["']([^"']+)["']/);
  if (packageMatch) return packageMatch[1];

  const packageWorkspaceMatch = content.match(/\[package\][\s\S]*?license\.workspace\s*=\s*true/);
  if (packageWorkspaceMatch) return 'MIT (workspace)';

  return undefined;
}

export function validateLicenses(rootDir = process.cwd()): LicenseValidationResult {
  const errors: string[] = [];

  // 1. Verify root LICENSE file
  const licenseFilePath = path.join(rootDir, 'LICENSE');
  const licenseFileExists = fs.existsSync(licenseFilePath);
  let isMitLicense = false;

  if (!licenseFileExists) {
    errors.push('Missing LICENSE file at repository root.');
  } else {
    const licenseContent = fs.readFileSync(licenseFilePath, 'utf-8');
    if (/MIT License/i.test(licenseContent)) {
      isMitLicense = true;
    } else {
      errors.push('Root LICENSE file does not appear to be an MIT License.');
    }
  }

  // 2. Inspect package.json files
  const packageJsonPaths = findFiles(rootDir, /^package\.json$/);
  const inspectedPackageJson: Array<{ file: string; license?: string }> = [];

  for (const pkgPath of packageJsonPaths) {
    try {
      const relPath = path.relative(rootDir, pkgPath);
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const license = pkg.license;
      inspectedPackageJson.push({ file: relPath, license });

      if (license !== 'MIT') {
        errors.push(
          `Invalid license in ${relPath}: expected "MIT", found "${license ?? 'undefined'}".`,
        );
      }
      if (license === 'Apache-2.0') {
        errors.push(
          `Publish ambiguity in ${relPath}: claims Apache-2.0 while repository license is MIT.`,
        );
      }
    } catch (err) {
      errors.push(`Failed to parse ${pkgPath}: ${(err as Error).message}`);
    }
  }

  // 3. Inspect Cargo.toml files
  const cargoTomlPaths = findFiles(rootDir, /^Cargo\.toml$/);
  const inspectedCargoToml: Array<{ file: string; license?: string }> = [];

  for (const cargoPath of cargoTomlPaths) {
    try {
      const relPath = path.relative(rootDir, cargoPath);
      const content = fs.readFileSync(cargoPath, 'utf-8');
      const license = parseCargoLicense(content);
      inspectedCargoToml.push({ file: relPath, license });

      if (license !== 'MIT' && license !== 'MIT (workspace)') {
        errors.push(
          `Invalid license in ${relPath}: expected "MIT", found "${license ?? 'undefined'}".`,
        );
      }
      if (license === 'Apache-2.0') {
        errors.push(
          `Publish ambiguity in ${relPath}: claims Apache-2.0 while repository license is MIT.`,
        );
      }
    } catch (err) {
      errors.push(`Failed to parse ${cargoPath}: ${(err as Error).message}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    inspected: {
      packageJsonFiles: inspectedPackageJson,
      cargoTomlFiles: inspectedCargoToml,
      licenseFile: { exists: licenseFileExists, isMit: isMitLicense },
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Validating workspace licenses...');
  const result = validateLicenses();
  if (!result.valid) {
    console.error('❌ License validation failed:');
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  } else {
    console.log('✅ All workspace packages and Cargo crates are consistently aligned to MIT.');
    for (const pkg of result.inspected.packageJsonFiles) {
      console.log(`  - [package.json] ${pkg.file}: ${pkg.license}`);
    }
    for (const cargo of result.inspected.cargoTomlFiles) {
      console.log(`  - [Cargo.toml]   ${cargo.file}: ${cargo.license}`);
    }
  }
}
