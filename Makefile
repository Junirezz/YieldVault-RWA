# Root task runner for YieldVault-RWA.
# Thin wrappers around the existing pnpm/cargo scripts so contributors have one
# entry point. Works with GNU make on Linux, macOS and Git Bash on Windows.

PNPM ?= pnpm

.DEFAULT_GOAL := help
.PHONY: help install test lint build format validate

help: ## List available targets
	@echo "Usage: make <target>"
	@echo ""
	@awk 'BEGIN { FS = ":.*## " } /^[a-zA-Z_-]+:.*## / { printf "  %-10s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

install: ## Install workspace dependencies (backend, frontend, packages)
	$(PNPM) check:pnpm-version
	$(PNPM) install

test: ## Run backend, frontend and root script tests
	$(PNPM) test:all

lint: ## Lint backend and frontend with ESLint
	$(PNPM) --filter backend lint
	$(PNPM) --filter frontend lint

build: ## Build API schemas, backend and frontend
	$(PNPM) build

format: ## Format backend sources (and Rust contracts when cargo is installed)
	$(PNPM) --filter backend format
	@if command -v cargo >/dev/null 2>&1; then cargo fmt --all; else echo "cargo not found, skipping cargo fmt"; fi

validate: ## Run repository convention and governance validators
	$(PNPM) validate:contribution-standards
	$(PNPM) validate:testing-strategy
	$(PNPM) validate:sprint-and-triage
	$(PNPM) validate:release-notes
	$(PNPM) validate:nfr-baselines
	$(PNPM) validate:codeowners
	$(PNPM) validate:pr-template
	$(PNPM) validate:renovate
