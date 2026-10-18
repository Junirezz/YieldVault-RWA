import fs from 'fs';
import path from 'path';
import { specs } from '../src/swagger';
import { collectRoutes, mergeDiscoveredRoutes } from './openapiRouterWalk';

const defaultOutputPath = path.resolve(__dirname, '../openapi.json');

type Routable = Parameters<typeof collectRoutes>[0];

/**
 * Builds the spec and folds in every route reachable from `app` (recursing
 * through nested routers) that the hand-written definition does not document.
 * Always LF, matching the repository's `.gitattributes` (issue #1374).
 */
export function buildOpenApi(app?: Routable) {
  const spec = JSON.parse(JSON.stringify(specs));
  const added = app ? mergeDiscoveredRoutes(spec, collectRoutes(app)) : [];
  return { spec, added, content: JSON.stringify(spec, null, 2) };
}

/** Builds the spec and writes it to `outputPath`. */
export function generateOpenApi(app?: Routable, outputPath = defaultOutputPath) {
  const result = buildOpenApi(app);
  fs.writeFileSync(outputPath, result.content, 'utf8');
  return result;
}

/**
 * Lists `METHOD path` operations that differ between the committed spec and a
 * freshly generated one: missing from the file (`+`), stale in the file (`-`),
 * or changed (`~`).
 */
export function diffOpenApi(committed: string, generated: string): string[] {
  const operations = (raw: string): Map<string, string> => {
    const out = new Map<string, string>();
    let paths: Record<string, Record<string, unknown>> = {};
    try {
      paths = JSON.parse(raw).paths ?? {};
    } catch {
      return out;
    }
    for (const [route, item] of Object.entries(paths)) {
      for (const [method, op] of Object.entries(item)) {
        out.set(`${method.toUpperCase()} ${route}`, JSON.stringify(op));
      }
    }
    return out;
  };

  const before = operations(committed);
  const after = operations(generated);
  const drift: string[] = [];
  for (const [key, op] of after) {
    if (!before.has(key)) drift.push(`+ ${key}`);
    else if (before.get(key) !== op) drift.push(`~ ${key}`);
  }
  for (const key of before.keys()) {
    if (!after.has(key)) drift.push(`- ${key}`);
  }
  if (!drift.length && committed !== generated) drift.push('~ (non-path sections)');
  return drift;
}

async function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  const failOnDrift = argv.includes('--fail-on-drift');

  process.env.NODE_ENV ??= 'test';
  let app: Routable | undefined;
  try {
    app = (await import('../src/index')).default as unknown as Routable;
  } catch (error) {
    if (failOnDrift) {
      console.error('❌ Could not load the Express app to discover routes:', error);
      process.exit(1);
    }
    console.warn('⚠️  Could not load the Express app; routes will NOT be auto-discovered:', error);
  }

  if (check) {
    const { content } = buildOpenApi(app);
    const committed = fs.existsSync(defaultOutputPath)
      ? fs.readFileSync(defaultOutputPath, 'utf8').replace(/\r\n/g, '\n')
      : '';
    const drift = diffOpenApi(committed, content);
    if (!drift.length) {
      console.log('✅ openapi.json is up to date with the routes wired in src/index.ts');
      process.exit(0);
    }
    console.error(`❌ openapi.json has drifted from the router (${drift.length} operation(s)):`);
    for (const line of drift) console.error(`  ${line}`);
    console.error("Run 'npm run generate:openapi' and commit openapi.json.");
    process.exit(failOnDrift ? 1 : 0);
  }

  console.log('Generating openapi.json...');
  const { added } = generateOpenApi(app);
  if (added.length) {
    console.log(`Added ${added.length} undocumented route(s) discovered from the router stack.`);
  }
  console.log(`✅ openapi.json generated successfully at ${defaultOutputPath}`);
  process.exit(0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Failed to generate openapi.json:', error);
    process.exit(1);
  });
}
