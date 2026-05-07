# Skill: QuoteSystem Integration

## Overview

QuoteSystem is BrightForge's themed logging system. Every function that completes a meaningful operation must log its result through QuoteSystem. This is not optional. All engine subsystems, initialization routines, and runtime operations use QuoteSystem to produce consistent, categorized log output with literary-themed messages.

## Quick Reference

```cpp
#include "QuoteSystem.h"

QuoteSystem quoteSystem;
```

## Message Types

| Type | Theme | Usage |
|------|-------|-------|
| `SUCCESS` | Harry Potter | Operation completed successfully |
| `WARNING` | Alice in Wonderland | Non-fatal issue, retry, or degraded path |
| `ERROR_MSG` | Holes | Operation failed, cannot continue |
| `DEBUG` | Naruto | Verbose diagnostic information |
| `INFO` | Maya Angelou | General informational status |
| `SECURITY` | Black Clover | Security-related events and integrity checks |

## Logging Pattern

Every function that performs a meaningful operation follows the guard-attempt-log pattern:

```cpp
bool DoSomething() {
    // Guard clause
    if (!ready) {
        quoteSystem.Log(ERROR_MSG, "DoSomething", "Not ready to proceed");
        return false;
    }

    // Attempt the operation
    bool result = AttemptOperation();

    // Log success or failure
    if (result) {
        quoteSystem.Log(SUCCESS, "DoSomething", "Operation completed");
    } else {
        quoteSystem.Log(ERROR_MSG, "DoSomething", "Operation failed");
    }

    return result;
}
```

## Security Registration

Use `RegisterIntegrity` to register a security phrase for a subsystem, and `ValidateIntegrity` to verify it later:

```cpp
quoteSystem.RegisterIntegrity("Renderer", "flames-of-the-phoenix");
// ...
bool valid = quoteSystem.ValidateIntegrity("Renderer", "flames-of-the-phoenix");
```

## Verbose Toggle

Control whether debug-level messages are emitted:

```cpp
quoteSystem.SetVerbose(false); // Suppress DEBUG messages
quoteSystem.SetVerbose(true);  // Enable DEBUG messages
```

## Debug History

Print the last N log entries for diagnostics:

```cpp
quoteSystem.PrintHistory(20);
```

## Rules

1. **Never use raw `cout` for operational output.** All meaningful log output goes through `quoteSystem.Log()`.
2. **Every new file includes `QuoteSystem.h`.** No exceptions for engine code.
3. **Every initialization routine logs `SUCCESS` or `ERROR_MSG`.** If an init function completes, it logs one or the other.
4. **Every retry logs `WARNING`.** Retried operations use the `WARNING` type before reattempting.
5. **Security subsystems register integrity phrases.** Any subsystem with security implications must call `RegisterIntegrity` during setup and `ValidateIntegrity` before sensitive operations.
