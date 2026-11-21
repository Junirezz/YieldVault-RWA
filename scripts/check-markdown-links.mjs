#!/usr/bin/env node
/**
 * Validates relative links and anchors in markdown files (#1748).
 *
 *   node scripts/check-markdown-links.mjs                # every tracked *.md
 *   node scripts/check-markdown-links.mjs a.md docs/b.md # specific files
 *
 * - Checks local file/directory links and `#anchor` fragments (GitHub-style slugs).
 * - Ignores external URLs (http, https, mailto, tel, ...); those are covered by
 *   the lychee job in docs.yml.
 * - Ignores fenced and inline code.
 * - Prints `file:line: [text](target) - reason` for every problem; exits 1 if any.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist', 'build', '.next', 'coverage']);

/** GitHub heading slug: lowercase, drop punctuation, spaces -> hyphens. */
export function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Blank out code so links inside it are not checked, preserving line numbers. */
function stripCode(text) {
  const lines = text.split('\n');
  let fence = null;
  return lines
    .map((line) => {
      const m = line.match(/^\s*(```+|~~~+)/);
      if (m) {
        if (!fence) fence = m[1][0];
        else if (m[1][0] === fence) fence = null;
        return '';
      }
      if (fence) return '';
      return line.replace(/`[^`]*`/g, (c) => ' '.repeat(c.length));
    })
    .join('\n');
}

export function collectAnchors(text) {
  const anchors = new Set();
  const counts = new Map();
  for (const line of stripCode(text).split('\n')) {
    const h = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (h) {
      const base = slugify(h[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'));
      const n = counts.get(base) ?? 0;
      counts.set(base, n + 1);
      anchors.add(n === 0 ? base : `${base}-${n}`);
    }
    for (const a of line.matchAll(/<a\s+(?:name|id)=["']([^"']+)["']/gi)) anchors.add(a[1]);
  }
  return anchors;
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export function extractLinks(text) {
  const links = [];
  const lines = stripCode(text).split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/!?\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) {
      links.push({ line: i + 1, text: m[1], target: m[2].replace(/^<|>$/g, '') });
    }
    const ref = line.match(/^\s{0,3}\[([^\]]+)\]:\s*(<[^>]*>|\S+)/);
    if (ref) links.push({ line: i + 1, text: ref[1], target: ref[2].replace(/^<|>$/g, '') });
  });
  return links;
}

export function checkFile(file, readAnchorsFor = defaultAnchors) {
  const problems = [];
  const text = readFileSync(file, 'utf8');
  for (const { line, text: label, target } of extractLinks(text)) {
    if (!target || EXTERNAL.test(target)) continue;
    const [rawPath, rawFragment] = splitTarget(target);
    const fragment = rawFragment ? decodeURIComponent(rawFragment) : '';
    let resolved = file;
    if (rawPath) {
      const clean = decodeURIComponent(rawPath);
      resolved = clean.startsWith('/') ? path.resolve(repoRoot(), clean.slice(1)) : path.resolve(path.dirname(file), clean);
      if (!existsSync(resolved)) {
        problems.push({ file, line, label, target, reason: 'file not found' });
        continue;
      }
    }
    if (fragment) {
      if (statSync(resolved).isDirectory() || !/\.(md|markdown)$/i.test(resolved)) continue;
      if (/^L\d+(-L\d+)?$/.test(fragment)) continue;
      if (!readAnchorsFor(resolved).has(fragment.toLowerCase()) && !readAnchorsFor(resolved).has(fragment)) {
        problems.push({ file, line, label, target, reason: `anchor "#${fragment}" not found` });
      }
    }
  }
  return problems;
}

function splitTarget(target) {
  const hash = target.indexOf('#');
  const beforeHash = hash === -1 ? target : target.slice(0, hash);
  const fragment = hash === -1 ? '' : target.slice(hash + 1);
  return [beforeHash.split('?')[0], fragment];
}

const anchorCache = new Map();
function defaultAnchors(file) {
  if (!anchorCache.has(file)) anchorCache.set(file, collectAnchors(readFileSync(file, 'utf8')));
  return anchorCache.get(file);
}

let cachedRoot;
function repoRoot() {
  cachedRoot ??= path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  return cachedRoot;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.md$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function main(argv) {
  const files = argv.length ? argv.filter((f) => /\.md$/i.test(f) && existsSync(f)).map((f) => path.resolve(f)) : walk(repoRoot());
  const problems = files.flatMap((f) => checkFile(f));
  for (const p of problems) {
    console.error(`${path.relative(process.cwd(), p.file)}:${p.line}: [${p.label}](${p.target}) - ${p.reason}`);
  }
  if (problems.length) {
    console.error(`\n${problems.length} broken markdown link(s) in ${new Set(problems.map((p) => p.file)).size} file(s).`);
    process.exit(1);
  }
  console.log(`Checked ${files.length} markdown file(s); no broken relative links.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
