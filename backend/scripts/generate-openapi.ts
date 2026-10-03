import fs from 'fs';
import path from 'path';
import { specs } from '../src/swagger';

const outputPath = path.resolve(__dirname, '../openapi.json');

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
