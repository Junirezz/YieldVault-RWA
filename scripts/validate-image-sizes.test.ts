import { describe, expect, it } from 'vitest';
import * as path from 'path';
import {
  MAX_INDIVIDUAL_PNG_BYTES,
  MAX_TOTAL_PNG_BYTES,
  findPngFiles,
  validateImageSizes,
} from './validate-image-sizes';

describe('validate-image-sizes', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('verifies that no PNG file exceeds the 500KB limit', () => {
    const report = validateImageSizes(rootDir);
    for (const img of report.images) {
      expect(img.sizeBytes).toBeLessThanOrEqual(MAX_INDIVIDUAL_PNG_BYTES);
    }
  });

  it('verifies that total PNG size across the repository is strictly under 1MB', () => {
    const report = validateImageSizes(rootDir);
    expect(report.totalSizeBytes).toBeLessThan(MAX_TOTAL_PNG_BYTES);
  });

  it('returns valid: true and no errors on current workspace assets', () => {
    const report = validateImageSizes(rootDir);
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it('flags an oversized image when custom lower threshold is tested', () => {
    // If threshold was 0 bytes, any existing image would be flagged
    const pngs = findPngFiles(rootDir);
    if (pngs.length > 0) {
      const strictReport = validateImageSizes(rootDir, 1, 1);
      expect(strictReport.valid).toBe(false);
      expect(strictReport.errors.length).toBeGreaterThan(0);
    }
  });
});
