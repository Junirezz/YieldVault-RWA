import * as fs from 'fs';
import * as path from 'path';

export interface ImageSizeReport {
  valid: boolean;
  maxIndividualSizeLimitBytes: number;
  maxTotalSizeLimitBytes: number;
  totalSizeBytes: number;
  images: Array<{
    filePath: string;
    sizeBytes: number;
    sizeKb: number;
    exceedsLimit: boolean;
  }>;
  errors: string[];
}

export const MAX_INDIVIDUAL_PNG_BYTES = 500 * 1024; // 500 KB
export const MAX_TOTAL_PNG_BYTES = 1024 * 1024;     // 1 MB

export function findPngFiles(dir: string, ignoreDirs = ['node_modules', '.git', 'dist', 'target', 'coverage', '.cargo']): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoreDirs.includes(entry.name)) {
        results.push(...findPngFiles(fullPath, ignoreDirs));
      }
    } else if (entry.isFile() && /\.png$/i.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

export function validateImageSizes(
  rootDir = process.cwd(),
  maxIndividualBytes = MAX_INDIVIDUAL_PNG_BYTES,
  maxTotalBytes = MAX_TOTAL_PNG_BYTES,
): ImageSizeReport {
  const pngPaths = findPngFiles(rootDir);
  const errors: string[] = [];
  let totalSizeBytes = 0;

  const images = pngPaths.map((fullPath) => {
    const stat = fs.statSync(fullPath);
    const sizeBytes = stat.size;
    const sizeKb = Math.round((sizeBytes / 1024) * 10) / 10;
    const relPath = path.relative(rootDir, fullPath);
    totalSizeBytes += sizeBytes;

    const exceedsLimit = sizeBytes > maxIndividualBytes;
    if (exceedsLimit) {
      errors.push(
        `Image ${relPath} (${sizeKb} KB) exceeds the maximum allowed file size of ${Math.round(maxIndividualBytes / 1024)} KB.`,
      );
    }

    return {
      filePath: relPath,
      sizeBytes,
      sizeKb,
      exceedsLimit,
    };
  });

  if (totalSizeBytes > maxTotalBytes) {
    const totalKb = Math.round((totalSizeBytes / 1024) * 10) / 10;
    errors.push(
      `Total repository PNG size (${totalKb} KB) exceeds the maximum allowed total size of ${Math.round(maxTotalBytes / 1024)} KB.`,
    );
  }

  return {
    valid: errors.length === 0,
    maxIndividualSizeLimitBytes: maxIndividualBytes,
    maxTotalSizeLimitBytes: maxTotalBytes,
    totalSizeBytes,
    images,
    errors,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Validating repository image asset sizes...');
  const report = validateImageSizes();

  console.log(`Found ${report.images.length} PNG images (Total: ${(report.totalSizeBytes / 1024).toFixed(1)} KB):`);
  for (const img of report.images) {
    console.log(`  - ${img.filePath}: ${img.sizeKb} KB`);
  }

  if (!report.valid) {
    console.error('❌ Image size validation failed:');
    for (const err of report.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  } else {
    console.log('✅ All image sizes are well within limits (<500KB per image, <1MB total).');
  }
}
