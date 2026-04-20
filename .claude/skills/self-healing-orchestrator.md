---
name: BrightForge Self-Healing Orchestrator
description: How to wrap async operations with Phase 16 self-healing: failure classification, config-driven retry/backoff, pre-execution guards, and correlationId tracing.
---

# BrightForge Self-Healing Orchestrator

## When to Use

Wrap any operation that can fail with recoverable errors: LLM calls, Forge3D generation, pipeline starts, bridge communication, external API calls.

**Before Phase 16:**
```javascript
try {
  const result = await generateMesh(prompt);
} catch (err) {
  console.error(err);  // silent failure, no retry, no classification
}
```

**After Phase 16:**
```javascript
import selfHealingOrchestrator from '../core/self-healing-orchestrator.js';

const result = await selfHealingOrchestrator.execute({
  name: 'generate-mesh',
  guards: {
    bridge_ready: async () => modelBridge.state === 'running'
  },
  operation: async (correlationId) => {
    return await generateMesh(prompt, { correlationId });
  },
  context: { prompt, projectId }
});

if (!result.success) {
  // result.failure.category, result.failure.reason, result.failure.recoverable
  // result.timeline — full event log with timestamps
}
```

---

## HealingResult Shape

```javascript
{
  success: boolean,
  correlationId: string,          // UUID for tracing
  name: string,                   // operation name
  result: any,                    // returned value on success
  failure: {
    category: string,             // see failure categories below
    reason: string,               // human-readable
    recoverable: boolean,
    retryable: boolean,
    action: string,               // 'fail_fast' | 'halt_and_log' | 'retry_or_fallback' | ...
    correlationId: string,
    classifiedAt: string          // ISO timestamp
  } | null,
  timeline: Array<{               // full event log
    event: string,
    correlationId: string,
    timestamp: string,
    // ...additional context per event
  }>,
  startedAt: string,
  completedAt: string,
  attempts: number
}
```

---

## Failure Categories

Defined in `src/core/failure-classifier.js` and mapped to healing rules in `config/healing-rules.json`:

| Category | HTTP Trigger | JS Error Trigger | Action | Retryable |
|----------|-------------|-----------------|--------|-----------|
| `validation_error` | 400 invalid_request | "required"/"missing field" | fail_fast | No |
| `contract_mismatch` | unexpected response shape | "contract"/"shape" | halt_and_log | No |
| `dependency_failure` | 503 | "bridge"/"ECONNREFUSED" | retry_or_fallback | Yes (3x) |
| `timeout` | timedOut=true | "ETIMEDOUT"/"timed out" | retry_with_backoff | Yes (2x) |
| `rate_limited_expected` | 429 | "rate limit" | backoff_and_retry | Yes (4x) |
| `sse_race_condition` | SSE close before event | — | mark_non_blocking | No |
| `server_error` | 500 | — | halt_and_log | No |
| `not_found` | 404 | — | fail_fast | No |
| `conflict` | 409 | — | fail_fast | No |
| `sandbox_violation` | — | "[SANDBOX]" | halt_and_log | No |
| `unknown` | — | — | halt_and_log | No |

---

## Guards

Guards are async precondition checks. If any guard returns `false` or throws, the operation is never started.

```javascript
guards: {
  bridge_ready: async () => modelBridge.state === 'running',
  llm_available: async () => llmClient.isAvailable(),
  budget_ok: async () => !telemetryBus.isBudgetExceeded()
}
```

Guard failures are classified as `dependency_failure` with `reason: "Precondition failed: <guardName>"`.

---

## Tuning Healing Rules

Edit `config/healing-rules.json` — no code changes needed:

```json
{
  "rules": {
    "dependency_failure": {
      "action": "retry_or_fallback",
      "maxRetries": 3,
      "retryDelayMs": 2000,
      "backoffMultiplier": 2.0,
      "maxDelayMs": 30000
    }
  }
}
```

Delay formula: `min(retryDelayMs * backoffMultiplier^(attempt-1), maxDelayMs)`

---

## Failure Classification Standalone

Use `failureClassifier` directly when you have an HTTP response (e.g., in the QA harness):

```javascript
import failureClassifier from '../core/failure-classifier.js';

// From HTTP result
const record = failureClassifier.classifyHttpResult({
  status: 503,
  body: { error: 'dependency_unavailable', reason: 'bridge down' },
  timedOut: false
});
// record.category === 'dependency_failure'
// record.recoverable === true
// record.correlationId  (generated if not provided)

// From JS Error
const record2 = failureClassifier.classifyError(err, { correlationId: myId });

// False-positive 202 detection
const fp = failureClassifier.detectFalsePositive202(submitResult, statusResult);
// fp.isFalsePositive, fp.category, fp.reason
```

---

## Observability

Every healing action is:
1. Logged to console with `[HEALING] [correlationId-prefix] event`
2. Emitted to `telemetryBus` as `healing_event`
3. Persisted to `logs/failures.json` (newline-delimited JSON) on failure

To replay a failure timeline:
```bash
grep '"correlationId":"abc12345"' logs/failures.json | jq '.timeline'
```

---

## Self-Tests

```bash
npm run test-failure-classifier   # 20 assertions
npm run test-healing              # 17 assertions including retry simulation
```

Test cases cover: success passthrough · validation fail_fast · dependency retry + recovery · guard blocking · correlationId propagation · exhausted retries.
