# Requirements Document

## Introduction

This feature adds a Soroban testnet CI job to the YieldVault RWA project. On every push to `main`, the pipeline will build the vault WASM artifact, deploy it to the Stellar testnet, run a smoke test (deposit + share balance check) against the live deployed contract, and upload the deployment address as a downloadable CI artifact. This gives the team continuous confidence that the contract deploys and executes correctly on a real network, not just in the local Soroban test environment.

## Glossary

- **CI_Pipeline**: The GitHub Actions workflow that runs on push to `main`.
- **WASM_Build_Job**: The existing `wasm-build` job in `.github/workflows/rust-wasm.yml` that produces the `wasm-artifacts` artifact.
- **Testnet_Deploy_Job**: The new GitHub Actions job introduced by this feature that deploys the vault contract to Stellar testnet.
- **Smoke_Test**: A minimal end-to-end test that calls `deposit` and then `balance` on the deployed contract to verify basic liveness.
- **Deployer_Account**: A Stellar testnet account whose secret key is stored as the `TESTNET_SECRET_KEY` GitHub Actions secret.
- **Token_Contract**: A Stellar testnet token contract (e.g., a deployed SAC or test token) whose address is stored as the `TESTNET_TOKEN_ADDRESS` GitHub Actions secret.
- **Contract_ID**: The Soroban contract address returned by `stellar contract deploy`.
- **Deployment_Artifact**: A JSON file containing the `Contract_ID` and the Git SHA of the deployment, uploaded as a GitHub Actions artifact.
- **Stellar_CLI**: The `stellar` command-line tool (formerly `soroban`) used to deploy and invoke contracts on Stellar networks.

---

## Requirements

### Requirement 1: Testnet Deploy Job Triggered on Push to Main

**User Story:** As a developer, I want the testnet deployment to run automatically on every push to `main`, so that every merged change is validated against a live network without manual intervention.

#### Acceptance Criteria

1. WHEN a commit is pushed to the `main` branch, THE CI_Pipeline SHALL trigger the Testnet_Deploy_Job.
2. THE Testnet_Deploy_Job SHALL depend on the WASM_Build_Job completing successfully before it starts.
3. WHEN the WASM_Build_Job has not succeeded, THE CI_Pipeline SHALL not start the Testnet_Deploy_Job.
4. THE Testnet_Deploy_Job SHALL run on `ubuntu-latest`.

---

### Requirement 2: WASM Artifact Download

**User Story:** As a CI job, I want to download the pre-built WASM artifact from the build job, so that the deploy step uses the same binary that was tested and verified.

#### Acceptance Criteria

1. THE Testnet_Deploy_Job SHALL download the `wasm-artifacts` artifact produced by the WASM_Build_Job.
2. WHEN the `wasm-artifacts` artifact is not available, THE Testnet_Deploy_Job SHALL fail with a descriptive error before attempting deployment.
3. THE Testnet_Deploy_Job SHALL locate the vault WASM file at the path `artifacts/wasm/vault.wasm` after downloading.

---

### Requirement 3: Stellar CLI Installation

**User Story:** As a CI job, I want the Stellar CLI installed in the runner environment, so that I can deploy and invoke contracts on the testnet.

#### Acceptance Criteria

1. THE Testnet_Deploy_Job SHALL install the Stellar_CLI before executing any deployment or invocation commands.
2. THE Testnet_Deploy_Job SHALL install a pinned version of the Stellar_CLI to ensure reproducible builds.
3. WHEN the Stellar_CLI installation fails, THE Testnet_Deploy_Job SHALL fail immediately and not proceed to deployment.

---

### Requirement 4: Deployer Account Configuration

**User Story:** As a CI job, I want to configure the deployer account from a GitHub secret, so that the testnet account credentials are never stored in source code.

#### Acceptance Criteria

1. THE Testnet_Deploy_Job SHALL read the deployer secret key exclusively from the `TESTNET_SECRET_KEY` GitHub Actions secret.
2. THE Testnet_Deploy_Job SHALL configure the Stellar_CLI identity using the value of `TESTNET_SECRET_KEY` before invoking any network commands.
3. IF the `TESTNET_SECRET_KEY` secret is absent or empty, THEN THE Testnet_Deploy_Job SHALL fail with a descriptive error before attempting any network operation.
4. THE Testnet_Deploy_Job SHALL never print the secret key value in any log output.

---

### Requirement 5: Contract Deployment to Testnet

**User Story:** As a developer, I want the vault contract deployed to Stellar testnet on every CI run, so that I have a fresh, known-good deployment to test against.

#### Acceptance Criteria

1. WHEN the WASM artifact and Deployer_Account are available, THE Testnet_Deploy_Job SHALL deploy the vault WASM to the Stellar testnet using `stellar contract deploy`.
2. THE Testnet_Deploy_Job SHALL capture the Contract_ID returned by the deploy command.
3. WHEN the deploy command exits with a non-zero status, THE Testnet_Deploy_Job SHALL fail and not proceed to initialization or smoke testing.
4. THE Testnet_Deploy_Job SHALL initialize the deployed contract by calling `initialize` with the Deployer_Account address as admin and the value of the `TESTNET_TOKEN_ADDRESS` secret as the token address.
5. WHEN the `initialize` invocation fails, THE Testnet_Deploy_Job SHALL fail and not proceed to smoke testing.

---

### Requirement 6: Smoke Test Execution

**User Story:** As a developer, I want a smoke test to run against the deployed contract, so that I know the contract is live and its core deposit flow works on a real network.

#### Acceptance Criteria

1. WHEN the contract is successfully deployed and initialized, THE Testnet_Deploy_Job SHALL invoke the `deposit` function with a non-zero amount using the Deployer_Account.
2. AFTER the `deposit` invocation succeeds, THE Testnet_Deploy_Job SHALL invoke the `balance` function for the Deployer_Account address.
3. THE Testnet_Deploy_Job SHALL assert that the value returned by `balance` is greater than zero.
4. WHEN the `balance` assertion fails, THE Testnet_Deploy_Job SHALL fail the CI run and report the actual balance value in the job log.
5. WHEN any smoke test step exits with a non-zero status, THE Testnet_Deploy_Job SHALL fail the CI run immediately.

---

### Requirement 7: Deployment Artifact Upload

**User Story:** As a developer, I want the deployment address saved as a downloadable CI artifact, so that I can inspect or reuse the Contract_ID from any CI run without re-reading the logs.

#### Acceptance Criteria

1. WHEN the contract is successfully deployed, THE Testnet_Deploy_Job SHALL write the Contract_ID and the Git commit SHA to a JSON file named `deployment.json`.
2. THE Testnet_Deploy_Job SHALL upload `deployment.json` as a GitHub Actions artifact named `testnet-deployment`.
3. THE Testnet_Deploy_Job SHALL retain the `testnet-deployment` artifact for at least 7 days.
4. WHEN the deployment step fails before a Contract_ID is obtained, THE Testnet_Deploy_Job SHALL not upload a partial or empty `deployment.json`.

---

### Requirement 8: Secret and Environment Variable Hygiene

**User Story:** As a security-conscious team, I want all sensitive values handled safely in CI, so that secrets are never exposed in logs or artifacts.

#### Acceptance Criteria

1. THE CI_Pipeline SHALL source the deployer secret key only from the `TESTNET_SECRET_KEY` GitHub Actions secret.
2. THE CI_Pipeline SHALL source the token contract address only from the `TESTNET_TOKEN_ADDRESS` GitHub Actions secret.
3. THE Testnet_Deploy_Job SHALL mask the `TESTNET_SECRET_KEY` value so it does not appear in any step log.
4. THE Deployment_Artifact SHALL contain only the Contract_ID and Git SHA — it SHALL NOT contain any secret key material.
