---
name: BrightForge Testing Guide
description: How to run and write self-tests for BrightForge modules. Every module uses --test blocks, not a test framework.
---

# BrightForge Testing Guide

## Test Philosophy

BrightForge uses self-contained `--test` blocks at the bottom of each module instead of a test framework. Each test runs independently via `node <file> --test`.

## Running Tests

```bash
# Individual core modules
npm run test-llm           # LLM client provider chain
npm run test-plan          # Plan engine parsing
npm run test-context       # File context scanning
npm run test-diff          # Diff applier + rollback
npm run test-session       # Session logging
npm run test-terminal      # Terminal UI
npm run test-history       # Message history
npm run test-conversation  # Conversation session
npm run test-multi-step    # Multi-step planner
npm run test-api           # Web session API
npm run test-image         # Image client provider chain
npm run test-design        # Design engine

# Forge3D modules
npm run test-bridge          # Python bridge (mock server)
npm run test-forge-session   # Generation lifecycle
npm run test-forge-db        # SQLite database CRUD
npm run test-project-manager # Project + asset management
npm run test-queue           # Generation queue

# Run all core tests
npm run test-all-core

# Lint check
npm run lint
npm run lint:fix
```

## Writing a Self-Test Block

```javascript
if (process.argv.includes('--test')) {
  console.log('[MODULE] Running self-test...');

  // Test 1: Basic functionality
  const result = instance.someMethod('input');
  console.assert(result !== null, 'someMethod should return a value');
  console.log('  [PASS] someMethod works');

  // Test 2: Edge case
  try {
    instance.someMethod(null);
    console.log('  [PASS] Handles null input');
  } catch (e) {
    console.error('  [FAIL] Null input threw:', e.message);
    process.exit(1);
  }

  console.log('[MODULE] All tests passed!');
}
```

## Conventions

- Tests print `[PASS]` or `[FAIL]` for each assertion
- Exit with code 1 on failure (`process.exit(1)`)
- Tests should be self-contained — no external fixtures or setup required
- Mock external services (LLM APIs, Python server) rather than calling them
- Prefix unused mock parameters with underscore: `function mockFetch(_url, _opts) {}`

## Before Committing

```bash
npm run lint:fix    # Auto-fix formatting
npm run lint        # Check for remaining issues
npm run test-all-core  # Run core test suite
```
