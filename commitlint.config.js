/**
 * Commit message rules.
 *
 * `type-case: lower-case` is the substantive fix. `cliff.toml` sets
 * `conventional_commits = true` and its `commit_parsers` patterns are all
 * lower-case and case-sensitive (`^fix`, `^feat`, `^docs`, ...). git-cliff's own
 * conventional parser accepts `[a-zA-Z]+`, so an upper-case `Fix:` parses as a
 * valid commit whose type is `Fix` — which matches none of those `^fix`
 * patterns and therefore never reaches the "Bug Fixes" group. Enforcing
 * lower-case at commit time keeps every commit in exactly one changelog group.
 *
 * The `type-enum` is the union of the issue's list (fix, feat, chore, docs,
 * test, refactor) with every remaining type `cliff.toml` can group (ci, style,
 * perf, sec, security, revert). Narrowing it to the six types in the issue
 * would have rejected `ci:` and `style:`, which both appear in this repository's
 * history and both have dedicated changelog groups. The union guarantees the
 * invariant the issue wants: any type the linter accepts is a type `cliff.toml`
 * can render.
 *
 * Fixtures pinning this behaviour live in scripts/fixtures/commit-messages/ and
 * are exercised by scripts/commit-messages.test.ts.
 */
const TYPES = [
  // Types named explicitly in issue #1461.
  'fix',
  'feat',
  'chore',
  'docs',
  'test',
  'refactor',
  // Additional types that cliff.toml groups; all are used in this repo's history.
  'ci',
  'style',
  'perf',
  'sec',
  'security',
  'revert',
];

module.exports = {
  rules: {
    'type-case': [2, 'always', 'lower-case'],
    'type-enum': [2, 'always', TYPES],
  },
};
