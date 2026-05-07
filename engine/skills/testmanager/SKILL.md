# Skill: TestManager Subsystem Validator

## Overview

TestManager runs validation tests before the main loop starts. It organizes tests into named suites, executes them on demand, and reports pass/fail results. This ensures that subsystems are correctly initialized and that critical resources are available before the engine enters its runtime phase.

## Quick Reference

### Create and Register Tests

```cpp
TestManager tm;

tm.RegisterSuite("Renderer");
tm.AddTest("Renderer", "Shader file exists", []() -> bool {
    return std::filesystem::exists("shaders/vert.spv");
});
tm.AddTest("Renderer", "Framebuffer valid", []() -> bool {
    return framebuffer.IsValid();
});
```

### Run Tests

Run all registered suites:

```cpp
tm.RunAll();
```

Run a single suite:

```cpp
tm.RunSuite("Renderer");
```

### Toggle Suites

Enable or disable a suite so it is skipped during `RunAll()`:

```cpp
tm.ToggleSuite("Physics"); // Toggle enabled/disabled
```

### Quick Start with RegisterDefaultEngineTests

Register the standard engine validation tests for shader paths and asset paths:

```cpp
tm.RegisterDefaultEngineTests();
// Registers built-in tests for:
//   - shader file existence (vert.spv, frag.spv)
//   - asset directory existence
```

### Check Results

```cpp
auto results = tm.GetResults();
// results contains per-suite, per-test pass/fail status
```

## Test Writing Guidelines

1. **Tests must be independent.** Each test runs in isolation with no dependency on other tests or their execution order.
2. **Tests must be read-only.** Tests must not modify engine state, write files, or produce side effects.
3. **Use descriptive names.** Test names should clearly state what is being validated (e.g., "Shader file exists" not "Test 1").
4. **Tests return `bool`.** Return `true` for pass, `false` for fail. No exceptions, no error codes.
5. **Keep tests fast.** Each test should complete in under 100ms. Long-running validation belongs in a separate diagnostic tool, not in TestManager.

## When to Add Tests

- When adding a new subsystem that loads external resources (shaders, configs, models).
- When adding initialization logic that can fail silently.
- When a bug is found that could have been caught by a pre-run check.
- When adding a new file dependency that must exist at startup.

## Rules

1. **Never ship without `RunAll()` passing.** All registered tests must pass before entering the main loop.
2. **Failed tests log `ERROR_MSG`.** Every test failure is logged through QuoteSystem at `ERROR_MSG` level.
3. **Passed tests log `SUCCESS`.** Every test pass is logged through QuoteSystem at `SUCCESS` level.
4. **TestManager uses its own QuoteSystem instance.** It does not share the global QuoteSystem -- it creates and owns a dedicated instance for test output.
