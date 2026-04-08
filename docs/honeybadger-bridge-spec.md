# Honeybadger Vault Bridge — Architecture Specification

// Author: Marcus Daley
// Date: 2026-04-07
// Status: Design Complete — No Code
// Related: docs/idea-intelligence-spec.md

---

## 1. Purpose

The Honeybadger Bridge connects BrightForge's Idea Intelligence System to
the Honeybadger Vault (HBV) — a personal knowledge vault for long-term
archival, cross-referencing, and retrieval of ideas, research, and
project history.

This spec defines a **decoupled**, **transport-only** integration: no
shared code, no shared database, no shared runtime. Both systems live
independently and communicate over HTTP between two localhost servers.

### Design Principles

- **No coupling**: Neither system imports code from the other
- **No shared schema**: Events carry payloads; each side validates independently
- **Asynchronous and idempotent**: Retries are safe, events carry unique ids
- **Local-first**: All traffic stays on localhost, no external network
- **Observer pattern**: Both sides publish events, both sides subscribe
- **Graceful degradation**: If the bridge is down, each system operates standalone

---

## 2. Architecture Diagram

```
+--------------------------------------+        +------------------------------------+
|        BrightForge  (:3847)          |        |    Honeybadger Vault  (:3000)      |
|--------------------------------------|        |------------------------------------|
|                                      |        |                                    |
|   IdeaIntelligence                   |        |   VaultIngestion                   |
|         |                            |        |         ^                          |
|         v                            |        |         |                          |
|   OrchestrationEventBus              |        |   VaultEventBus                    |
|         |                            |        |         |                          |
|         v                            |        |         v                          |
|   BridgeOutbound       <=====HTTP====>    BridgeInbound                             |
|   (POST /bridge/in)                  |        |   (POST /bridge/in)                |
|         ^                            |        |         |                          |
|         |                            |        |         v                          |
|   BridgeInbound        <=====HTTP====>    BridgeOutbound                            |
|   (POST /bridge/in)                  |        |   (POST /bridge/in)                |
|                                      |        |                                    |
+--------------------------------------+        +------------------------------------+
```

Each side runs **two halves**:
- `BridgeOutbound` — subscribes to local event bus, POSTs selected events to the remote
- `BridgeInbound` — HTTP endpoint that receives events and republishes them on the local bus

The two halves are symmetric. Adding a new event type only requires updating
the whitelist on both sides.

---

## 3. Transport

### 3.1 Endpoint

Both systems expose one endpoint:

```
POST http://localhost:{port}/bridge/in
Content-Type: application/json
```

- BrightForge: `http://localhost:3847/bridge/in`
- Honeybadger: `http://localhost:3000/bridge/in`

### 3.2 Request Envelope

```json
{
  "event_id": "string (UUID v4 fragment, 12 chars)",
  "timestamp": "ISO8601 UTC",
  "source_system": "brightforge" | "honeybadger",
  "target_system": "brightforge" | "honeybadger",
  "event_type": "string (from whitelist)",
  "payload": { ... },
  "schema_version": 1
}
```

### 3.3 Response

Success:
```json
{ "status": "accepted", "event_id": "..." }
```
HTTP 202 Accepted.

Duplicate (already seen):
```json
{ "status": "duplicate", "event_id": "..." }
```
HTTP 200 OK.

Rejected (unknown type, validation failure):
```json
{ "status": "rejected", "event_id": "...", "reason": "..." }
```
HTTP 400 Bad Request.

Error (server failure):
```json
{ "status": "error", "event_id": "...", "reason": "..." }
```
HTTP 500 Internal Server Error.

### 3.4 Retry Policy

BridgeOutbound retries with exponential backoff on network/5xx errors:
- Initial delay: 1s
- Multiplier: 2x
- Max delay: 60s
- Max attempts: 5
- After max attempts: dead-letter to `data/bridge-failed.jsonl`

4xx responses are **not retried** (treated as permanent rejection).

### 3.5 Idempotency

Each BridgeInbound maintains a rolling seen-set of the last 10,000
`event_id` values. Duplicates return HTTP 200 without side effects.
This handles retry scenarios safely.

---

## 4. Event Whitelists

### 4.1 BrightForge → Honeybadger

BrightForge publishes these events to HBV:

| Event type | Payload summary | Purpose |
|---|---|---|
| `idea_scored` | idea record with score_total, dimension scores, priority_label | HBV stores scored idea for long-term archive |
| `idea_indexed` | idea id, title, embedding (768-dim float array), category, tags | HBV updates its semantic index |
| `research_completed` | idea id, similar_projects, top_features, missing_features, gap_analysis | HBV attaches research report to vault entry |

### 4.2 Honeybadger → BrightForge

HBV publishes these events back to BrightForge:

| Event type | Payload summary | Purpose |
|---|---|---|
| `vault_indexed` | idea_id, vault_path, vault_url | BrightForge updates ideas.vault_path |
| `vault_linked` | idea_id, related_vault_entries (ids + titles) | BrightForge surfaces vault cross-links in UI |
| `vault_conflict` | idea_id, conflict_type, conflicting_entry_id | BrightForge flags conflicts for review |

### 4.3 Validation

On receive, BridgeInbound validates:
1. `event_type` is in the allowed-inbound whitelist
2. `source_system` matches the expected peer
3. `schema_version` is supported (currently 1)
4. `payload` has required keys for that event_type

Rejections go to `data/bridge-rejected.jsonl` with the reason.

---

## 5. Event Flow Example — "Idea Scored → Vault → Cross-Link"

```
1. BrightForge IdeaScoring.score(idea) completes.
2. OrchestrationEventBus emits 'idea_scored' with full idea payload.
3. BrightForge BridgeOutbound picks up 'idea_scored', wraps it in envelope,
   POSTs to http://localhost:3000/bridge/in.
4. Honeybadger BridgeInbound receives POST, validates schema.
5. HBV returns HTTP 202 { status: "accepted" }.
6. HBV's VaultIngestion processes the payload:
   - Stores idea in vault at /vault/ideas/{id}.md
   - Runs its own embedding if needed
   - Cross-references existing vault entries
7. HBV emits 'vault_indexed' with idea_id and vault_path.
8. HBV BridgeOutbound POSTs 'vault_indexed' to http://localhost:3847/bridge/in.
9. BrightForge BridgeInbound receives, republishes on OrchestrationEventBus.
10. BrightForge IdeaIndexer (or a dedicated listener) calls
    storage.updateIdea(id, { vault_path }).
11. If HBV found cross-links, step 9 also delivers 'vault_linked',
    which BrightForge stores as idea_relationships rows.
```

Latency target: <500ms for the full round-trip on localhost.

---

## 6. Configuration

### BrightForge: `config/orchestration.yaml`

```yaml
honeybadger_bridge:
  enabled: false           # off by default, opt-in
  peer_url: "http://localhost:3000/bridge/in"
  listen_path: "/bridge/in"
  outbound_events:
    - idea_scored
    - idea_indexed
    - research_completed
  inbound_events:
    - vault_indexed
    - vault_linked
    - vault_conflict
  retry:
    initial_delay_ms: 1000
    multiplier: 2
    max_delay_ms: 60000
    max_attempts: 5
  idempotency:
    cache_size: 10000
  dead_letter_path: "data/bridge-failed.jsonl"
  rejected_path: "data/bridge-rejected.jsonl"
```

### Honeybadger: mirror config in HBV's own config file

Symmetric keys with source/target flipped.

---

## 7. Observability

Both bridges emit local events for their own observability:

- `bridge_outbound_sent` — event shipped
- `bridge_outbound_failed` — retry exhausted, dead-lettered
- `bridge_inbound_received` — event received
- `bridge_inbound_rejected` — validation failure
- `bridge_inbound_duplicate` — idempotent hit

These route through the existing TelemetryBus and ErrorHandler on the
BrightForge side. HBV should do the equivalent.

---

## 8. Testing Plan

### 8.1 Unit Tests (each side, independent)

- BridgeOutbound: mock fetch, verify retry backoff
- BridgeInbound: mock Express req/res, verify whitelist rejection
- Idempotency: inject duplicate event_id, verify second call is a no-op
- Dead letter: force max attempts, verify jsonl row written

### 8.2 Integration Tests (both sides running)

Start both servers, then exercise with curl:

```bash
# 1. BrightForge alive
curl http://localhost:3847/api/health

# 2. Honeybadger alive
curl http://localhost:3000/health

# 3. BrightForge → Honeybadger: simulate idea_scored
curl -X POST http://localhost:3000/bridge/in \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "test-001-aaaa",
    "timestamp": "2026-04-07T12:00:00Z",
    "source_system": "brightforge",
    "target_system": "honeybadger",
    "event_type": "idea_scored",
    "schema_version": 1,
    "payload": {
      "id": "idea-abc",
      "title": "AI Blueprint Analyzer",
      "score_total": 0.82,
      "priority_label": "HIGH"
    }
  }'
# Expect: 202 { "status": "accepted", "event_id": "test-001-aaaa" }

# 4. Duplicate check — send same event_id again
curl -X POST http://localhost:3000/bridge/in \
  -H "Content-Type: application/json" \
  -d '{ ... same payload ... }'
# Expect: 200 { "status": "duplicate", "event_id": "test-001-aaaa" }

# 5. Reject unknown type
curl -X POST http://localhost:3000/bridge/in \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "test-002-bbbb",
    "timestamp": "2026-04-07T12:00:00Z",
    "source_system": "brightforge",
    "target_system": "honeybadger",
    "event_type": "not_allowed",
    "schema_version": 1,
    "payload": {}
  }'
# Expect: 400 { "status": "rejected", "reason": "unknown event_type" }

# 6. Honeybadger → BrightForge round trip
curl -X POST http://localhost:3847/bridge/in \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "test-003-cccc",
    "timestamp": "2026-04-07T12:00:01Z",
    "source_system": "honeybadger",
    "target_system": "brightforge",
    "event_type": "vault_indexed",
    "schema_version": 1,
    "payload": {
      "idea_id": "idea-abc",
      "vault_path": "/vault/ideas/idea-abc.md"
    }
  }'
# Expect: 202 { "status": "accepted" }
# Verify: ideas.vault_path updated in data/orchestration.db
```

### 8.3 Chaos Tests

- Kill HBV while BrightForge is publishing → verify dead-letter growth
- Restart HBV → verify BridgeOutbound does not replay dead-lettered events
  automatically (manual replay only)
- Kill BrightForge during inbound POST → verify no partial DB writes

---

## 9. Security

- **Localhost only**: Both servers bind to 127.0.0.1, never 0.0.0.0
- **No authentication** in v1: acceptable because traffic never leaves loopback
- **Schema validation**: strict type checking on inbound payloads to prevent
  prototype pollution via JSON parse
- **Rate limiting**: 100 requests/second per bridge endpoint (via existing
  express-rate-limit middleware)
- **Payload size cap**: 256KB per request (embeddings can be large)
- **No file paths in payloads**: HBV stores its own vault paths, never
  executes paths received from BrightForge

---

## 10. Integration Instructions

### 10.1 BrightForge side

1. Create `src/bridge/honeybadger-outbound.js` — subscribes to
   OrchestrationEventBus, implements retry + dead letter
2. Create `src/bridge/honeybadger-inbound.js` — exposes `/bridge/in` route
3. Mount route in `src/api/server.js`:
   ```javascript
   import honeybadgerInbound from './bridge/honeybadger-inbound.js';
   app.use('/bridge', honeybadgerInbound.router);
   ```
4. Initialize in `bin/brightforge-server.js` after orchestrator is ready
5. Opt-in via `config/orchestration.yaml` → `honeybadger_bridge.enabled: true`

### 10.2 Honeybadger side

Mirror the same structure under HBV's src tree. HBV is responsible for
its own implementation — this spec only defines the wire format and event
whitelists.

### 10.3 Versioning

`schema_version` in the envelope lets either side evolve independently.
When a side changes the payload shape for an event type, it increments
`schema_version` and both sides must support the new and old versions
for a transition period.

---

## 11. Out of Scope for v1

The following are explicitly NOT part of this bridge and may come later:

- Bidirectional sync of full databases
- Conflict resolution (last-writer-wins only)
- Multi-peer bridges (only one HBV peer)
- Authentication / signed envelopes
- Transport other than HTTP (no WebSocket, no gRPC, no message queue)
- Replay of dead-lettered events
- Schema migration tooling

---

## 12. Status

- Design: Complete
- Implementation: Not started
- Blocking dependencies: Honeybadger Vault repo must expose its own
  `/bridge/in` endpoint before BrightForge's side can be end-to-end tested
- Next step: Implement the BrightForge half first, with a local mock
  HBV server for integration testing, then hand off the spec to the
  HBV repo for its half
