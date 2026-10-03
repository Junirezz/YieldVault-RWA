import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  collectGeneratedArtifacts,
  validateGeneratedArtifactLineEndings,
} from './validate-generated-artifacts';

describe('validate-generated-artifacts', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('commits every generated artifact with LF-only line endings', () => {
    const report = validateGeneratedArtifactLineEndings(rootDir);
    expect(report.checkedFiles.length).toBeGreaterThan(0);
    expect(report.violations).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it('discovers the OpenAPI document and the schema snapshots', () => {
    const files = collectGeneratedArtifacts(rootDir).map((file) => path.relative(rootDir, file));
    expect(files).toContain(path.join('backend', 'openapi.json'));
    expect(files.some((file) => file.startsWith(path.join('backend', 'schema-snapshots')))).toBe(
      true,
    );
    expect(files.some((file) => file.startsWith(path.join('docs', 'schemas', 'webhooks')))).toBe(
      true,
    );
  });

  it('flags generated artifacts that contain CRLF line endings', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-eol-'));
    try {
      fs.mkdirSync(path.join(tmpRoot, 'backend', 'schema-snapshots'), { recursive: true });
      fs.writeFileSync(path.join(tmpRoot, 'backend', 'openapi.json'), '{\r\n  "openapi": "3.1.0"\r\n}\r\n');
      fs.writeFileSync(
        path.join(tmpRoot, 'backend', 'schema-snapshots', 'get-_health.json'),
        '{\n  "ok": true\n}\n',
      );

      const report = validateGeneratedArtifactLineEndings(tmpRoot);

      expect(report.valid).toBe(false);
      expect(report.violations).toEqual([
        { filePath: path.join('backend', 'openapi.json'), crlfCount: 3 },
      ]);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('ignores non-generated files', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-eol-'));
    try {
      fs.mkdirSync(path.join(tmpRoot, 'backend'), { recursive: true });
      fs.writeFileSync(path.join(tmpRoot, 'backend', 'README.md'), '# CRLF\r\n');
      expect(collectGeneratedArtifacts(tmpRoot)).toEqual([]);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
