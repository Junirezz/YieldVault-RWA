import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface SeverityLevel {
  id: string;
  name: string;
  responseSlaMinutes: number;
  targetMitigationMinutes: number | null;
  requiresPostmortem: boolean;
}

export const SEVERITY_LEVELS: SeverityLevel[] = [
  { id: 'Sev0', name: 'Critical', responseSlaMinutes: 5, targetMitigationMinutes: null, requiresPostmortem: true },
  { id: 'Sev1', name: 'High', responseSlaMinutes: 15, targetMitigationMinutes: 60, requiresPostmortem: true },
  { id: 'Sev2', name: 'Medium', responseSlaMinutes: 60, targetMitigationMinutes: null, requiresPostmortem: false },
  { id: 'Sev3', name: 'Low', responseSlaMinutes: 480, targetMitigationMinutes: null, requiresPostmortem: false },
];

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateSeverityLevels(levels: SeverityLevel[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Array.isArray(levels) || levels.length === 0) {
    errors.push('Severity levels array must not be empty.');
    return { valid: false, errors, warnings };
  }

  const ids = new Set<string>();
  for (const level of levels) {
    if (!level.id) {
      errors.push('Every severity level must have an "id".');
    }
    if (!level.name) {
      errors.push(`Severity "${level.id}" is missing a name.`);
    }
    if (typeof level.responseSlaMinutes !== 'number' || level.responseSlaMinutes < 0) {
      errors.push(`Severity "${level.id}" has invalid responseSlaMinutes: ${level.responseSlaMinutes}.`);
    }
    if (ids.has(level.id)) {
      errors.push(`Duplicate severity level id: "${level.id}".`);
    }
    ids.add(level.id);
  }

  const sorted = [...levels].sort((a, b) => a.responseSlaMinutes - b.responseSlaMinutes);
  if (JSON.stringify(sorted.map(l => l.id)) !== JSON.stringify(levels.map(l => l.id))) {
    warnings.push('Severity levels are not sorted by response SLA (ascending). Consider reordering.');
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateRunbookHeadingConsistency(runbookContent: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!runbookContent || runbookContent.trim() === '') {
    errors.push('Runbook content cannot be empty.');
    return { valid: false, errors, warnings };
  }

  const requiredSections = [
    'Severity Classification',
    'Detection',
    'Triage',
    'Escalation Path',
    'Communication',
    'Post-Incident',
  ];

  for (const section of requiredSections) {
    if (!runbookContent.includes(section)) {
      errors.push(`Runbook is missing required section: "${section}"`);
    }
  }

  for (const level of SEVERITY_LEVELS) {
    if (!runbookContent.includes(level.id)) {
      warnings.push(`Runbook does not mention "${level.id}" severity level.`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function runFullIncidentSeverityValidation(rootDir: string = process.cwd()): ValidationResult {
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  const resLevels = validateSeverityLevels(SEVERITY_LEVELS);
  allErrors.push(...resLevels.errors);
  allWarnings.push(...resLevels.warnings);

  const runbookPath = resolve(rootDir, 'docs/incident-runbook.md');
  if (!existsSync(runbookPath)) {
    allErrors.push('docs/incident-runbook.md file does not exist.');
  } else {
    const runbookContent = readFileSync(runbookPath, 'utf8');
    const resRunbook = validateRunbookHeadingConsistency(runbookContent);
    allErrors.push(...resRunbook.errors);
    allWarnings.push(...resRunbook.warnings);
  }

  return { valid: allErrors.length === 0, errors: allErrors, warnings: allWarnings };
}

if (require.main === module) {
  const result = runFullIncidentSeverityValidation();
  if (!result.valid) {
    console.error('❌ Incident severity validation failed:');
    result.errors.forEach((err) => console.error(`  - ${err}`));
    process.exit(1);
  } else {
    console.log('✅ All incident severity checks passed successfully!');
  }
  if (result.warnings.length > 0) {
    console.warn('⚠️  Warnings:');
    result.warnings.forEach((w) => console.warn(`  - ${w}`));
  }
}
