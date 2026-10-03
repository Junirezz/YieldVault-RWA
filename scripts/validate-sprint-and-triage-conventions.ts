import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export const VALID_TYPES = [
  'type: feature',
  'type: bug',
  'type: chore',
  'type: docs',
  'type: security',
  'type: refactor',
  'type: perf',
];

export const VALID_SCOPES = [
  'scope: contracts',
  'scope: backend',
  'scope: frontend',
  'scope: infra',
  'scope: docs',
  'scope: governance',
];

export const VALID_PRIORITIES = [
  'priority: p0-critical',
  'priority: p1-high',
  'priority: p2-medium',
  'priority: p3-low',
];

export const VALID_STATUSES = [
  'status: needs-triage',
  'status: triage-in-progress',
  'status: ready-for-dev',
  'status: in-progress',
  'status: in-review',
  'status: blocked',
  'status: completed',
  'status: wontfix',
];

export const SPRINT_LABEL_REGEX = /^sprint: (\d{4}-W\d{2}|current|next|backlog)$/;

/**
 * Validates a sprint label format.
 */
export function validateSprintLabel(label: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!label || label.trim() === '') {
    errors.push('Sprint label cannot be empty.');
    return { valid: false, errors, warnings };
  }

  const trimmed = label.trim();
  if (!SPRINT_LABEL_REGEX.test(trimmed)) {
    errors.push(
      `Sprint label "${trimmed}" must follow format "sprint: YYYY-WXX" (e.g. sprint: 2026-W30) or use aliases: sprint: current, sprint: next, sprint: backlog.`
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validates an issue taxonomy label against repository standards.
 */
export function validateIssueTaxonomyLabel(label: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!label || label.trim() === '') {
    errors.push('Taxonomy label cannot be empty.');
    return { valid: false, errors, warnings };
  }

  const trimmed = label.trim();

  const isType = trimmed.startsWith('type: ');
  const isScope = trimmed.startsWith('scope: ');
  const isPriority = trimmed.startsWith('priority: ');
  const isStatus = trimmed.startsWith('status: ');
  const isSprint = trimmed.startsWith('sprint: ');
  const isEpic = trimmed.startsWith('epic: ');
  const isProgram = trimmed.startsWith('program: ');
  const isSpecial = ['good-first-issue', 'help-wanted', 'needs-info', 'wontfix', 'Stellar Wave'].includes(trimmed);

  if (isType && !VALID_TYPES.includes(trimmed)) {
    errors.push(`Invalid type label "${trimmed}". Must be one of: ${VALID_TYPES.join(', ')}`);
  } else if (isScope && !VALID_SCOPES.includes(trimmed)) {
    errors.push(`Invalid scope label "${trimmed}". Must be one of: ${VALID_SCOPES.join(', ')}`);
  } else if (isPriority && !VALID_PRIORITIES.includes(trimmed)) {
    errors.push(`Invalid priority label "${trimmed}". Must be one of: ${VALID_PRIORITIES.join(', ')}`);
  } else if (isStatus && !VALID_STATUSES.includes(trimmed)) {
    errors.push(`Invalid status label "${trimmed}". Must be one of: ${VALID_STATUSES.join(', ')}`);
  } else if (isSprint) {
    const res = validateSprintLabel(trimmed);
    errors.push(...res.errors);
  } else if (!isType && !isScope && !isPriority && !isStatus && !isSprint && !isEpic && !isProgram && !isSpecial) {
    warnings.push(`Uncategorized label "${trimmed}". Recommended to use taxonomy prefixes (type:, scope:, priority:, status:, sprint:).`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validates a GitHub issue template Markdown content.
 */
export function validateIssueTemplate(markdownContent: string, fileName: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!markdownContent || markdownContent.trim() === '') {
    errors.push(`Issue template "${fileName}" cannot be empty.`);
    return { valid: false, errors, warnings };
  }

  if (!markdownContent.startsWith('---')) {
    errors.push(`Issue template "${fileName}" is missing YAML frontmatter (must start with '---').`);
  } else {
    if (!markdownContent.includes('name:')) {
      errors.push(`Issue template "${fileName}" frontmatter is missing 'name:'.`);
    }
    if (!markdownContent.includes('about:')) {
      errors.push(`Issue template "${fileName}" frontmatter is missing 'about:'.`);
    }
    if (!markdownContent.includes('title:')) {
      errors.push(`Issue template "${fileName}" frontmatter is missing 'title:'.`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validates documentation completeness for sprint & triage standards.
 */
export function validateSprintAndTriageDocs(markdownContent: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!markdownContent || markdownContent.trim() === '') {
    errors.push('Sprint & Triage documentation cannot be empty.');
    return { valid: false, errors, warnings };
  }

  const requiredHeadings = [
    'Sprint Labeling Standards',
    'Sprint Labeling Naming Scheme',
    'Sprint Cadence & Lifecycle Procedures',
    'Unified Issue Label Taxonomy',
    'Triage SLAs',
  ];

  for (const heading of requiredHeadings) {
    if (!markdownContent.includes(heading)) {
      errors.push(`Sprint & Triage documentation is missing required heading: "${heading}"`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * CLI Runner for sprint and triage conventions validation.
 */
export function runFullSprintAndTriageValidation(rootDir: string = process.cwd()): ValidationResult {
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  const docPath = resolve(rootDir, 'docs/SPRINT_AND_TRIAGE_CONVENTIONS.md');
  if (!existsSync(docPath)) {
    allErrors.push('docs/SPRINT_AND_TRIAGE_CONVENTIONS.md file does not exist.');
  } else {
    const res = validateSprintAndTriageDocs(readFileSync(docPath, 'utf8'));
    allErrors.push(...res.errors);
    allWarnings.push(...res.warnings);
  }

  const templatesDir = resolve(rootDir, '.github/ISSUE_TEMPLATE');
  const requiredTemplates = [
    'bug_report.md',
    'feature_request.md',
    'perf_regression.md',
    'security_report.md',
    'task_or_chore.md',
  ];

  for (const template of requiredTemplates) {
    const tPath = resolve(templatesDir, template);
    if (!existsSync(tPath)) {
      allErrors.push(`.github/ISSUE_TEMPLATE/${template} file does not exist.`);
    } else {
      const res = validateIssueTemplate(readFileSync(tPath, 'utf8'), template);
      allErrors.push(...res.errors);
      allWarnings.push(...res.warnings);
    }
  }

  return { valid: allErrors.length === 0, errors: allErrors, warnings: allWarnings };
}

if (require.main === module) {
  const result = runFullSprintAndTriageValidation();
  if (!result.valid) {
    console.error('❌ Sprint and triage validation failed:');
    result.errors.forEach((err) => console.error(`  - ${err}`));
    process.exit(1);
  } else {
    console.log('✅ All sprint and triage convention checks passed successfully!');
  }
}
