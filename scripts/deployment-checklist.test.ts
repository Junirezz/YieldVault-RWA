import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const checklistPath = resolve(__dirname, '../docs/DEPLOYMENT_CHECKLIST.md');

describe('DEPLOYMENT_CHECKLIST.md documentation verification', () => {
  it('deployment checklist file exists and is non-empty', () => {
    expect(
      existsSync(checklistPath),
      'DEPLOYMENT_CHECKLIST.md should exist in docs/',
    ).toBe(true);
    const content = readFileSync(checklistPath, 'utf8');
    expect(content.length).toBeGreaterThan(5000);
  });

  it('contains title and table of contents', () => {
    const content = readFileSync(checklistPath, 'utf8');
    expect(content).toContain('# Deployment Checklist');
    expect(content).toContain('## Table of Contents');
  });

  it('all table of contents anchors resolve to section headers', () => {
    const content = readFileSync(checklistPath, 'utf8');
    const tocMatch = content.match(
      /## Table of Contents\s+([\s\S]*?)\s+---/,
    );
    expect(tocMatch).not.toBeNull();

    if (tocMatch) {
      const tocItems =
        tocMatch[1].match(/- \[(.*?)\]\(#(.*?)\)/g) || [];
      expect(tocItems.length).toBeGreaterThanOrEqual(5);

      for (const item of tocItems) {
        const linkMatch = item.match(/- \[(.*?)\]\(#(.*?)\)/);
        if (linkMatch) {
          const anchor = linkMatch[2];
          // Verify the anchor corresponds to a heading in the document.
          // Markdown heading anchors are lowercase, spaces replaced with
          // hyphens, and special characters removed.
          const headingPattern = new RegExp(
            `^##+ .*${anchor
              .split('-')
              .map((w) => w.replace(/[^a-z0-9]/gi, ''))
              .filter(Boolean)
              .join('.*')}`,
            'im',
          );
          expect(
            headingPattern.test(content),
            `ToC anchor "#${anchor}" should resolve to a heading`,
          ).toBe(true);
        }
      }
    }
  });

  it('contains testnet deployment section with required steps', () => {
    const content = readFileSync(checklistPath, 'utf8');
    expect(content).toContain('## Testnet Deployment Checklist');

    const requiredTestnetItems = [
      'Fund Deployer Account',
      'Deploy Contracts',
      'Initialize Vault',
      'Smoke Test',
      'Backend Deployment',
      'Frontend Deployment',
    ];

    for (const item of requiredTestnetItems) {
      expect(
        content,
        `Testnet section should include step: ${item}`,
      ).toContain(item);
    }
  });

  it('contains mainnet deployment section with required steps', () => {
    const content = readFileSync(checklistPath, 'utf8');
    expect(content).toContain('## Mainnet Deployment Checklist');

    const requiredMainnetItems = [
      'Release Readiness Gate',
      'Fund Deployer Account',
      'Pre-Deploy Safety Checks',
      'Deploy Contracts (Mainnet)',
      'Initialize Vault (Mainnet)',
      'Backend Deployment (Production)',
      'Frontend Deployment (Production)',
    ];

    for (const item of requiredMainnetItems) {
      expect(
        content,
        `Mainnet section should include step: ${item}`,
      ).toContain(item);
    }
  });

  it('contains pre-deployment common prerequisites', () => {
    const content = readFileSync(checklistPath, 'utf8');
    expect(content).toContain('## Pre-Deployment: Common Prerequisites');

    const requiredPrereqs = [
      'Stellar CLI',
      'Rust toolchain',
      'WASM target',
      'cargo build',
      'wasm32-unknown-unknown',
    ];

    for (const prereq of requiredPrereqs) {
      expect(
        content,
        `Prerequisites should mention: ${prereq}`,
      ).toContain(prereq);
    }
  });

  it('contains post-deployment verification section', () => {
    const content = readFileSync(checklistPath, 'utf8');
    expect(content).toContain('## Post-Deployment Verification');

    const requiredVerifications = [
      'GET /health',
      'GET /ready',
      'GET /metrics',
      'GET /api/v1/vault/summary',
    ];

    for (const check of requiredVerifications) {
      expect(
        content,
        `Post-deployment section should check: ${check}`,
      ).toContain(check);
    }
  });

  it('contains upgrade checklist section', () => {
    const content = readFileSync(checklistPath, 'utf8');
    expect(content).toContain('## Upgrade Checklist');
    expect(content).toContain('validate_upgrade.sh');
    expect(content).toContain('set_pause');
    expect(content).toContain('new_wasm_hash');
  });

  it('contains rollback procedures section', () => {
    const content = readFileSync(checklistPath, 'utf8');
    expect(content).toContain('## Rollback Procedures');

    const rollbackSections = [
      'Smart Contract Rollback',
      'Backend Rollback',
      'Frontend Rollback',
      'Rollback Triggers',
    ];

    for (const section of rollbackSections) {
      expect(
        content,
        `Rollback section should include: ${section}`,
      ).toContain(section);
    }
  });

  it('references correct Stellar network passphrases', () => {
    const content = readFileSync(checklistPath, 'utf8');
    expect(content).toContain('Test SDF Network ; September 2015');
    expect(content).toContain(
      'Public Global Stellar Network ; September 2015',
    );
  });

  it('references related documentation files', () => {
    const content = readFileSync(checklistPath, 'utf8');

    const relatedDocs = [
      'DEPLOYMENT.md',
      'RELEASE_READINESS_CHECKLIST.md',
      'SECURITY_CHECKLIST.md',
      'MONITORING_OBSERVABILITY.md',
      'incident_response_runbook.md',
    ];

    for (const doc of relatedDocs) {
      expect(
        content,
        `Should reference related doc: ${doc}`,
      ).toContain(doc);
    }
  });

  it('contains actionable checklist items (checkbox syntax)', () => {
    const content = readFileSync(checklistPath, 'utf8');
    const checkboxes = content.match(/- \[ \]/g) || [];
    // Should have a substantial number of checklist items
    expect(checkboxes.length).toBeGreaterThan(40);
  });

  it('contains emergency contacts and escalation section', () => {
    const content = readFileSync(checklistPath, 'utf8');
    expect(content).toContain('## Emergency Contacts');
    expect(content).toContain('Escalation Path');
    expect(content).toContain('Release Owner');
    expect(content).toContain('On-Call Engineer');
    expect(content).toContain('Security Lead');
  });
});
