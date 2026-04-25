# Implementation Plan: Soroban Testnet CI

## Overview

Extend the existing `rust-wasm.yml` GitHub Actions workflow with a `testnet-deploy` job, extract the deployment and smoke-test logic into a reusable shell script, and add a property-based test script that validates the `deployment.json` generation logic across 100 random inputs.

## Tasks

- [x] 1. Create the smoke-test shell script
  - [x] 1.1 Create `contracts/vault/scripts/smoke-test.sh` with the full deployment and smoke-test sequence
    - Add shebang `#!/usr/bin/env bash` and `set -euo pipefail`
    - Implement secret validation guard: fail with descriptive error if `TESTNET_SECRET_KEY` or `TESTNET_TOKEN_ADDRESS` is absent or empty
    - Add `stellar keys add ci-deployer --secret-key "$TESTNET_SECRET_KEY"` identity setup; pass secret via env var, never interpolate into command string
    - Deploy vault WASM: `CONTRACT_ID=$(stellar contract deploy --wasm artifacts/wasm/vault.wasm --source ci-deployer --network testnet)`
    - Invoke `initialize` with `--admin "$(stellar keys address ci-deployer)"` and `--token "$TESTNET_TOKEN_ADDRESS"`
    - Invoke `deposit` with `--user "$(stellar keys address ci-deployer)"` and `--amount 1000000`
    - Invoke `balance`, capture result into `BALANCE`; assert `BALANCE -gt 0`, exit 1 with actual value on failure
    - Write `deployment.json` with `contract_id` and `git_sha` fields only (no secret material)
    - Accept `GIT_SHA` as an environment variable (set by the caller / CI step)
    - Make the script executable (`chmod +x`)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 8.1, 8.2, 8.3, 8.4_

  - [ ]* 1.2 Write unit tests for smoke-test.sh secret guard logic
    - Test: `TESTNET_SECRET_KEY=""` → exits non-zero, output contains "TESTNET_SECRET_KEY"
    - Test: `TESTNET_TOKEN_ADDRESS=""` → exits non-zero, output contains "TESTNET_TOKEN_ADDRESS"
    - Test: both secrets set → guard passes (use a mock `stellar` binary that no-ops)
    - _Requirements: 4.3, 8.1, 8.2_

  - [ ]* 1.3 Write unit tests for balance assertion logic
    - Test: `BALANCE=0` → exits non-zero, output contains the actual value "0"
    - Test: `BALANCE=-1` → exits non-zero
    - Test: `BALANCE=1000000` → exits zero
    - _Requirements: 6.3, 6.4_

- [x] 2. Create the property-based test script for deployment.json generation
  - [x] 2.1 Create `contracts/vault/scripts/test-deployment-json.sh`
    - Add shebang `#!/usr/bin/env bash` and `set -euo pipefail`
    - Extract the `deployment.json` generation logic into a `generate_deployment_json` function that accepts `CONTRACT_ID` and `GIT_SHA` as arguments and prints the JSON to stdout
    - Run 100 iterations using `for i in $(seq 1 100)`; in each iteration:
      - Generate a random `CONTRACT_ID` (C-prefixed, 56 chars, base32 alphabet A-Z2-7)
      - Generate a random `GIT_SHA` (40 hex chars via `/dev/urandom | xxd -p`)
      - Call `generate_deployment_json` and capture output
      - Assert output is valid JSON (`jq . > /dev/null`)
      - Assert `jq -r '.contract_id'` equals the input `CONTRACT_ID`
      - Assert `jq -r '.git_sha'` equals the input `GIT_SHA`
      - Assert `jq 'keys | length'` equals `2` (no extra fields, no secret material)
      - Print iteration number and PASS/FAIL on each iteration
    - Exit non-zero if any iteration fails, printing the failing inputs and actual output
    - Make the script executable (`chmod +x`)
    - _Requirements: 7.1, 8.4_

  - [ ]* 2.2 Write property test for deployment JSON round-trip correctness
    - **Property 1: Deployment JSON round-trip correctness**
    - For any valid `contract_id` string and `git_sha` string, the generated `deployment.json` SHALL be valid JSON containing exactly the fields `contract_id` and `git_sha` with values equal to the inputs, and no additional fields
    - Run `contracts/vault/scripts/test-deployment-json.sh` and verify it exits zero across all 100 iterations
    - **Validates: Requirements 7.1, 8.4**

- [x] 3. Checkpoint — verify scripts are correct before wiring into CI
  - Run `contracts/vault/scripts/test-deployment-json.sh` locally (requires `jq`)
  - Ensure all unit test cases from tasks 1.2 and 1.3 pass
  - Ensure all scripts are executable and have correct shebangs
  - Ask the user if any questions arise before proceeding.

- [x] 4. Add the `testnet-deploy` job to the GitHub Actions workflow
  - [x] 4.1 Append the `testnet-deploy` job to `.github/workflows/rust-wasm.yml`
    - Add `testnet-deploy:` job with `name: Testnet deploy & smoke test`
    - Set `runs-on: ubuntu-latest`
    - Set `needs: wasm-build` to enforce ordering after the build job succeeds
    - Add a trigger guard so the job only runs on `push` to `main` (not on PRs): use `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 4.2 Add the artifact download step
    - Add step: `uses: actions/checkout@v4` (needed for the script file)
    - Add step: `uses: actions/download-artifact@v4` with `name: wasm-artifacts` and `path: artifacts/wasm`
    - Add a verification step: `ls -la artifacts/wasm/` to confirm `vault.wasm` is present at the expected path before deployment
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 4.3 Add the Stellar CLI installation step
    - Add step: `uses: stellar/stellar-cli@v23.0.1` (pinned version, no additional parameters needed)
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 4.4 Add the deployment and smoke-test step
    - Add a step that runs `contracts/vault/scripts/smoke-test.sh`
    - Scope `TESTNET_SECRET_KEY: ${{ secrets.TESTNET_SECRET_KEY }}` and `TESTNET_TOKEN_ADDRESS: ${{ secrets.TESTNET_TOKEN_ADDRESS }}` as `env:` on this step only (not job-level)
    - Set `GIT_SHA: ${{ github.sha }}` as an env var on the same step
    - Do NOT interpolate secret values directly into the `run:` string
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 8.1, 8.2, 8.3_

  - [x] 4.5 Add the artifact upload step
    - Add step: `uses: actions/upload-artifact@v4` with `name: testnet-deployment`, `path: deployment.json`, and `retention-days: 7`
    - Do NOT add an `if:` condition — the step should only run when all preceding steps succeed (GitHub Actions default)
    - _Requirements: 7.2, 7.3, 7.4_

- [x] 5. Final checkpoint — Ensure all tests pass
  - Verify the workflow YAML is valid (no syntax errors)
  - Verify `test-deployment-json.sh` exits zero
  - Verify the smoke-test unit tests pass
  - Ensure all scripts are committed and executable in git (`git update-index --chmod=+x`)
  - Ask the user if any questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- `smoke-test.sh` is extracted from inline YAML so it can be tested independently and reused
- The `testnet-deploy` job only runs on push to `main` — PRs do not trigger testnet deployments
- Secrets are scoped to the single step that needs them, never at job level, to minimize exposure surface
- `deployment.json` is written only after a successful smoke test; the upload step has no `if:` guard, relying on GitHub Actions default step-skip-on-failure semantics to prevent partial artifact uploads
- Property 1 is validated by `test-deployment-json.sh` running 100 random iterations
