# Security Policy

YieldVault-RWA takes the security of our smart contracts, backend services, and frontend applications seriously. This document outlines our vulnerability disclosure policy, automated security practices, and incident reporting guidelines.

## Supported Versions

We issue security patches for the following versions:

| Component | Supported Version | Security Support Status |
| --------- | ----------------- | ----------------------- |
| Smart Contracts (`/contracts`) | `v1.x` | :white_check_mark: Active |
| Backend API (`/backend`) | `v1.x` | :white_check_mark: Active |
| Frontend Web App (`/frontend`) | `v0.x` | :white_check_mark: Active |

---

## Reporting a Vulnerability

> [!IMPORTANT]
> **Do NOT create public GitHub issues for security vulnerabilities.**

If you discover a security vulnerability, please report it privately:

1. **Email**: Send your findings to `security@yieldvault.io` or open a private security advisory via GitHub Security Advisories.
2. **Details to Include**:
   - Description of the issue and potential impact.
   - Proof of concept (PoC) or step-by-step reproduction steps.
   - Affected components (`frontend`, `backend`, or Stellar Soroban contracts).
   - Any suggested remediations or mitigations.

### Response Timelines

- **Acknowledgement**: Within 24 hours.
- **Initial Assessment**: Within 48 hours.
- **Remediation Patch**: High/Critical vulnerabilities addressed within 7 days.

---

## Automated Security Scanning & Compliance

We employ multi-layered automated scanning in our CI/CD pipeline:

1. **Dependency Vulnerability Scanning**:
   - `npm audit` executed across `/frontend` and `/backend` packages.
   - GitHub `dependency-review-action` for pull request diffs.
   - `cargo audit` for Rust / Stellar Soroban contract dependencies.
2. **Static Analysis & SAST**:
   - Slither static analyzer for smart contract security checks.
   - ESLint security rules for TypeScript & Node.js codebases.
3. **Secret Scanning**:
   - Gitleaks scanner preventing API keys and seed phrases from entering version control.
4. **Dependabot Security Updates**:
   - Automated daily monitoring and automated PR generation for vulnerable dependencies.

---

## Dependency Management & Governance

- All pull requests adding or upgrading external packages must pass automated security audits (`npm audit` / `cargo audit`).
- Zero-tolerance policy for **Critical** or **High** severity vulnerabilities in production releases.
- Transitive dependencies are monitored continuously via Dependabot and GitHub Security Alerts.
