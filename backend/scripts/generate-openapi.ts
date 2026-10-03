import fs from 'fs';
import path from 'path';
import { specs } from '../src/swagger';
import { collectRoutes, mergeDiscoveredRoutes } from './openapiRouterWalk';

const defaultOutputPath = path.resolve(__dirname, '../openapi.json');

type Routable = Parameters<typeof collectRoutes>[0];

/**
 * Builds the spec, folds in every route reachable from `app` (recursing through
 * nested routers) that the hand-written definition does not document, and
 * writes it to `outputPath`.
 */
export function generateOpenApi(app?: Routable, outputPath = defaultOutputPath) {
  const spec = JSON.parse(JSON.stringify(specs));
  const added = app ? mergeDiscoveredRoutes(spec, collectRoutes(app)) : [];

  const content = JSON.stringify(spec, null, 2);
  const eol = fs.existsSync(outputPath) && fs.readFileSync(outputPath, 'utf8').includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(outputPath, content.replace(/\n/g, eol), 'utf8');
  return { spec, added };
}

async function main() {
  console.log('Generating openapi.json...');
  process.env.NODE_ENV ??= 'test';
  let app: Routable | undefined;
  try {
    app = (await import('../src/index')).default as unknown as Routable;
  } catch (error) {
    console.warn('⚠️  Could not load the Express app; routes will NOT be auto-discovered:', error);
  }
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
try {
  console.log('Generating openapi.json...');
  // Always emit LF, matching the repository's `.gitattributes` (`* text=auto eol=lf`).
  // Previously the generator preserved whatever EOL the existing file happened to use,
  // which made output platform-dependent: on Windows a CRLF working-tree copy was kept
  // as CRLF, so regenerating a byte-identical spec showed up as a phantom `M` change
  // (see issue #1374).
  const content = JSON.stringify(specs, null, 2);
  fs.writeFileSync(outputPath, content, 'utf8');
  console.log(`✅ openapi.json generated successfully at ${outputPath}`);
} catch (error) {
  console.error('❌ Failed to generate openapi.json:', error);
  process.exit(1);
}
