import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkFile, collectAnchors, slugify } from './check-markdown-links.mjs';

function fixture(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mdlinks-'));
  for (const [name, body] of Object.entries(files)) {
    const full = path.join(dir, name);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

test('slugify matches GitHub heading anchors', () => {
  assert.equal(slugify('Writing Good Issues'), 'writing-good-issues');
  assert.equal(slugify('Setup & Config (v2)'), 'setup--config-v2');
});

test('collectAnchors de-duplicates repeated headings', () => {
  const a = collectAnchors('# A\n## Same\n## Same\n');
  assert.ok(a.has('same') && a.has('same-1'));
});

test('valid file and anchor links pass', () => {
  const dir = fixture({
    'a.md': '# Top\n[b](docs/b.md) [sec](docs/b.md#details) [self](#top)\n',
    'docs/b.md': '## Details\n',
  });
  assert.deepEqual(checkFile(path.join(dir, 'a.md')), []);
});

test('reports exact file, line and link for a missing file', () => {
  const dir = fixture({ 'a.md': 'ok\n\n[gone](missing.md)\n' });
  const [p] = checkFile(path.join(dir, 'a.md'));
  assert.equal(p.line, 3);
  assert.equal(p.target, 'missing.md');
  assert.equal(p.reason, 'file not found');
});

test('detects a broken anchor in another file and in the same file', () => {
  const dir = fixture({
    'a.md': '# Top\n[x](b.md#nope)\n[y](#also-nope)\n',
    'b.md': '# Real\n',
  });
  const reasons = checkFile(path.join(dir, 'a.md')).map((p) => p.reason);
  assert.deepEqual(reasons, ['anchor "#nope" not found', 'anchor "#also-nope" not found']);
});

test('ignores external URLs and links inside code', () => {
  const dir = fixture({
    'a.md': '[ext](https://example.invalid/x) [m](mailto:a@b.c)\n`[c](nope.md)`\n```\n[d](nope2.md)\n```\n',
  });
  assert.deepEqual(checkFile(path.join(dir, 'a.md')), []);
});
