import fs from 'fs';
import path from 'path';
import { specs } from '../src/swagger';

const outputPath = path.resolve(__dirname, '../openapi.json');

try {
  console.log('Generating openapi.json...');
  fs.writeFileSync(outputPath, JSON.stringify(specs, null, 2), 'utf8');
  console.log(`✅ openapi.json generated successfully at ${outputPath}`);
} catch (error) {
  console.error('❌ Failed to generate openapi.json:', error);
  process.exit(1);
}
