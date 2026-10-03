import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface SectionCheckResult {
  hasHeading: boolean;
  checkboxCount: number;
  headings: string[];
}

export const REQUIRED_TEMPLATE_SECTIONS = [
  {
    name: 'Risk Assessment',
    aliases: ['Risk Assessment', 'Risk', '🛡️ Risk Assessment'],
    minCheckboxes: 4,
  },
  {
    name: 'Rollback Plan',
    aliases: ['Rollback Plan', 'Rollback', '🔄 Rollback Plan'],
    minCheckboxes: 3,
  },
  {
    name: 'Performance Impact',
    aliases: ['Performance Impact', 'Performance', '⚡ Performance Impact'],
    minCheckboxes: 3,
  },
];

/**
 * Extracts sections and checkbox counts from markdown content.
 */
export function extractSection(content: string, sectionKeywords: string[]): SectionCheckResult {
  const lines = content.split('\n');
  let inSection = false;
  let checkboxCount = 0;
  const headings: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const headingMatch = line.match(/^#{1,4}\s+(.*)$/);

    if (headingMatch) {
      const headingText = headingMatch[1].trim();
      const isMatch = sectionKeywords.some((kw) =>
        headingText.toLowerCase().includes(kw.toLowerCase())
      );

      if (isMatch) {
        inSection = true;
        headings.push(headingText);
        continue;
      } else if (line.startsWith('# ') || line.startsWith('## ')) {
        // Exiting section on new major heading
        inSection = false;
      }
    }

    if (inSection) {
      if (line.startsWith('- [ ]') || line.startsWith('- [x]') || line.startsWith('- [X]')) {
        checkboxCount++;
      }
    }
  }

  return {
    hasHeading: headings.length > 0,
    checkboxCount,
    headings,
  };
}

/**
 * Validates PR Template structure, sections, and checkboxes.
 */
export function validatePrTemplate(content: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!content || content.trim() === '') {
    errors.push('PR Template content cannot be empty.');
    return { valid: false, errors, warnings };
  }

  for (const req of REQUIRED_TEMPLATE_SECTIONS) {
    const res = extractSection(content, req.aliases);
    if (!res.hasHeading) {
      errors.push(`PR Template is missing required section: "${req.name}"`);
    } else if (res.checkboxCount < req.minCheckboxes) {
      errors.push(
        `Section "${req.name}" must contain at least ${req.minCheckboxes} checkboxes, but found ${res.checkboxCount}.`
      );
    }
  }

  // Verify Description, Testing, and Security
  if (!content.includes('Description') && !content.includes('Goal')) {
    errors.push('PR Template is missing Description / Goal section.');
  }

  if (!content.includes('Testing')) {
    errors.push('PR Template is missing Testing section.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Simulates opening a PR using the template and verifies all sections and checklists appear.
 */
export function simulatePROpening(templateContent: string): {
  hasRiskSection: boolean;
  hasRollbackSection: boolean;
  hasPerformanceSection: boolean;
  riskCheckboxesPresent: boolean;
  rollbackCheckboxesPresent: boolean;
  performanceCheckboxesPresent: boolean;
  allChecklistsPresent: boolean;
} {
  const risk = extractSection(templateContent, ['Risk Assessment', 'Risk']);
  const rollback = extractSection(templateContent, ['Rollback Plan', 'Rollback']);
  const perf = extractSection(templateContent, ['Performance Impact', 'Performance']);

  const riskCheckboxesPresent = risk.checkboxCount > 0;
  const rollbackCheckboxesPresent = rollback.checkboxCount > 0;
  const performanceCheckboxesPresent = perf.checkboxCount > 0;

  return {
    hasRiskSection: risk.hasHeading,
    hasRollbackSection: rollback.hasHeading,
    hasPerformanceSection: perf.hasHeading,
    riskCheckboxesPresent,
    rollbackCheckboxesPresent,
    performanceCheckboxesPresent,
    allChecklistsPresent:
      risk.hasHeading &&
      rollback.hasHeading &&
      perf.hasHeading &&
      riskCheckboxesPresent &&
      rollbackCheckboxesPresent &&
      performanceCheckboxesPresent,
  };
}

/**
 * CLI runner for PR template verification.
 */
export function runPrTemplateCheck(rootDir: string = process.cwd()): ValidationResult {
  const templateCandidates = [
    resolve(rootDir, '.github/PULL_REQUEST_TEMPLATE.md'),
    resolve(rootDir, '.github/pull_request_template.md'),
  ];

  let templatePath: string | null = null;
  for (const candidate of templateCandidates) {
    if (existsSync(candidate)) {
      templatePath = candidate;
      break;
    }
  }

  if (!templatePath) {
    return {
      valid: false,
      errors: ['No PR template found in .github/ (checked PULL_REQUEST_TEMPLATE.md and pull_request_template.md)'],
      warnings: [],
    };
  }

  const content = readFileSync(templatePath, 'utf8');
  return validatePrTemplate(content);
}

if (require.main === module) {
  const result = runPrTemplateCheck();
  if (!result.valid) {
    console.error('❌ PR Template validation failed:');
    result.errors.forEach((err) => console.error(`  - ${err}`));
    process.exit(1);
  } else {
    console.log('✅ PR Template validation passed successfully!');
    if (result.warnings.length > 0) {
      result.warnings.forEach((warn) => console.warn(`⚠️ Warning: ${warn}`));
    }
  }
}
