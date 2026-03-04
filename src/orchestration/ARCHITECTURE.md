# BrightForge Orchestration Runtime -- Architecture Specification

**Version:** 1.0.0
**Status:** Draft
**Author:** Marcus Daley (GrizzwaldHouse)
**Date:** March 2026
**Module Root:** `src/orchestration/`
**Config:** `config/orchestration.yaml`

---

## Table of Contents

1. [Problem Analysis](#1-problem-analysis)
2. [Architecture Overview](#2-architecture-overview)
3. [Module Diagram](#3-module-diagram)
4. [Module 1: TaskState](#4-module-1-taskstate)
5. [Module 2: OrchestrationEventBus](#5-module-2-orchestrationeventbus)
6. [Module 3: OrchestrationStorage](#6-module-3-orchestrationstorage)
7. [Module 4: SupervisorAgent](#7-module-4-supervisoragent)
8. [Module 5: HandoffProtocol](#8-module-5-handoffprotocol)
9. [Module 6: Orchestration Facade](#9-module-6-orchestration-facade)
10. [Module 7: Configuration](#10-module-7-configuration)
11. [Database Schema](#11-database-schema)
12. [Event Flow Diagrams](#12-event-flow-diagrams)
13. [Error Handling Strategy](#13-error-handling-strategy)
14. [Self-Test Specifications](#14-self-test-specifications)
15. [Implementation Plan](#15-implementation-plan)

---

## 1. Problem Analysis

### What Needs to Be Solved

BrightForge currently supports multi-provider LLM routing but has no mechanism for deterministic cross-agent task handoff. When Claude pauses a complex task and Ollama resumes, there is no shared state, no audit trail, and no validation that the resuming agent follows the original architecture. This creates:

- **State loss:** Architectural decisions, research notes, and subtask progress vanish between agent handoffs.
- **Drift risk:** A resuming agent may contradict or duplicate prior work without detection.
- **No auditability:** There is no event log to replay what happened, when, and by which agent.

### Constraints

- **ESM only** -- All modules use import/export, .js extensions, "type": "module".
- **Singleton + named export** -- Every module exports default singleton + named class.
- **Observer pattern** -- Cross-system communication via EventEmitter, NEVER polling.
- **Configuration-driven** -- All tunable values in config/orchestration.yaml.
- **Existing dependencies only** -- better-sqlite3, yaml, crypto, events (Node built-ins + existing deps).
- **BrightForge code style** -- 2-space indent, single quotes, semicolons, Windows CRLF, no trailing commas.
- **File headers** -- @author Marcus Daley (GrizzwaldHouse), @date, STATUS, TODO.
- **Self-test blocks** -- Every module has --test block guarded by filename check.
- **Logging prefixes** -- [ORCHESTRATOR], [EVENT-BUS], [SUPERVISOR], [HANDOFF], [TASK-STATE], [ORCH-STORAGE].
- **Integration** -- Must emit to existing TelemetryBus and report to existing ErrorHandler.

### Existing Patterns That Apply

| Pattern | Source File | Reuse |
|---|---|---|
| EventEmitter + ring buffers | src/core/telemetry-bus.js | OrchestrationEventBus mirrors this |
| Error categories + JSONL log | src/core/error-handler.js | New categories: orchestration_error, handoff_error, supervisor_error |
| SQLite + WAL + migrations | src/forge3d/database.js | OrchestrationStorage mirrors this exactly |
| State machine lifecycle | src/forge3d/forge-session.js | TaskState uses same FSM pattern |
| FIFO queue + pause/resume | src/forge3d/generation-queue.js | HandoffProtocol queue inspiration |
| YAML config + defaults | src/forge3d/config-loader.js | OrchestrationConfig mirrors this |
| Singleton + named export | Every module | All orchestration modules follow this |

---

## 2. Architecture Overview

The orchestration runtime introduces 6 modules + 1 config file, organized as a layered subsystem that integrates with BrightForge's existing observability layer.

```
Layer 3 -- Facade
  index.js                    Unified init/shutdown, re-exports

Layer 2 -- Agents & Protocols
  supervisor.js               Structural + coding standard audit
  handoff.js                  Claude <-> Ollama pause/resume protocol

Layer 1 -- Core State & Events
  task-state.js               Task lifecycle FSM, JSON schema, CRUD
  event-bus.js                Typed event envelopes, SHA256 integrity, ring buffers
  storage.js                  SQLite persistence, migrations, queries

Layer 0 -- Configuration
  config/orchestration.yaml   All tunable values
```

### Data Flow

```
Agent (Claude/Ollama) --> TaskState.create() --> OrchestrationEventBus.emit(task_started)
                      --> TaskState.update()  --> OrchestrationEventBus.emit(analysis_completed)
                      --> HandoffProtocol.pause() --> SupervisorAgent.audit() --> state serialized
                      --> HandoffProtocol.resume() --> schema validated --> TaskState restored
                      --> TaskState.complete() --> OrchestrationEventBus.emit(task_completed)

OrchestrationEventBus --> OrchestrationStorage (persist events)
                      --> TelemetryBus (forward metrics)

SupervisorAgent --> OrchestrationStorage (persist audit results)
               --> ErrorHandler (report violations)
```

---

## 3. Module Diagram

```
+------------------------------------------------------------------+
|                        index.js (Facade)                          |
|  init() / shutdown() / re-exports                                |
+------+---+---+---+---+------------------------------------------+
       |   |   |   |   |
       v   v   v   v   v
  +--------+ +--------+ +----------+ +----------+ +---------+
  | task-  | | event- | | storage  | | super-   | | handoff |
  | state  | | bus    | |          | | visor    | |         |
  | .js    | | .js    | | .js      | | .js      | | .js     |
  +---+----+ +---+----+ +-----+----+ +----+-----+ +----+----+
      |          |             |           |            |
      +----------+------+------+-----------+------------+
                        |
              +---------+---------+
              |                   |
         +----+------+    +------+-------+
         | telemetry |    | error-       |
         | -bus.js   |    | handler.js   |
         | (existing)|    | (existing)   |
         +-----------+    +--------------+
```

---

## 4. Module 1: TaskState

**File:** `src/orchestration/task-state.js`
**Log prefix:** `[TASK-STATE]`
**Responsibility:** Task lifecycle management with persistent JSON state snapshots.

### State Machine

```
             create()
               |
               v
           +-------+
           | active |<----- resume()
           +---+---+
               |
      +--------+--------+
      |                  |
   pause()           complete()
      |                  |
      v                  v
  +--------+       +-----------+
  | paused |       | completed |
  +--------+       +-----------+

  Any state --> fail() --> +--------+
                           | failed |
                           +--------+
```

Valid transitions:
- `active` -> `paused`, `completed`, `failed`
- `paused` -> `active`, `failed`
- `completed` -> (terminal)
- `failed` -> (terminal)

### JSON Schema (Task State Snapshot v1.0.0)

```json
{
  "task_state_version": "1.0.0",
  "task_id": "UUID (12-char truncated)",
  "task_name": "string",
  "status": "active | paused | completed | failed",
  "ownership": {
    "current_agent": "Claude | Ollama",
    "previous_agents": ["string"],
    "handoff_timestamp": "ISO8601 | null"
  },
  "execution_phase": {
    "current_phase": "analysis | design | implementation | validation",
    "completed_phases": ["string"],
    "phase_history": [
      {
        "phase": "string",
        "agent": "string",
        "started_at": "ISO8601",
        "completed_at": "ISO8601 | null",
        "summary": "string"
      }
    ]
  },
  "architectural_decisions": [
    {
      "decision_id": "UUID (12-char)",
      "title": "string",
      "rationale": "string",
      "alternatives_considered": ["string"],
      "tradeoffs": "string",
      "decided_by": "Claude | Ollama",
      "decided_at": "ISO8601"
    }
  ],
  "completed_subtasks": ["string"],
  "pending_subtasks": ["string"],
  "blocked_subtasks": ["string"],
  "research_notes": [
    {
      "source": "string",
      "summary": "string",
      "impact": "low | medium | high",
      "noted_by": "Claude | Ollama",
      "noted_at": "ISO8601"
    }
  ],
  "files_affected": ["string (relative paths)"],
  "code_standards_enforced": ["string"],
  "risks_identified": [
    {
      "risk": "string",
      "likelihood": "low | medium | high",
      "mitigation": "string"
    }
  ],
  "constraints": ["string"],
  "next_action": "string",
  "audit_log_pointer": "string (event_id reference)",
  "created_at": "ISO8601",
  "updated_at": "ISO8601"
}
```

### Class Interface

```javascript
import { EventEmitter } from 'events';

class TaskState extends EventEmitter {
  /**
   * @param {OrchestrationStorage} storage - Storage instance for persistence
   * @param {OrchestrationEventBus} eventBus - Event bus for lifecycle events
   */
  constructor(storage, eventBus) {}

  /**
   * Create a new task with initial state.
   * Emits 'task_started' event.
   *
   * @param {Object} params
   * @param {string} params.taskName - Human-readable task name
   * @param {string} params.agent - Initial owning agent ('Claude' | 'Ollama')
   * @param {string} [params.phase='analysis'] - Initial execution phase
   * @param {string} [params.nextAction] - First action to take
   * @returns {Object} Created task state snapshot
   * @throws {Error} If params.taskName is empty or params.agent is invalid
   */
  create(params) {}

  /**
   * Load a task state from storage by ID.
   *
   * @param {string} taskId - 12-char task ID
   * @returns {Object|null} Task state snapshot or null if not found
   */
  load(taskId) {}

  /**
   * Update fields on an existing task.
   * Emits appropriate lifecycle events based on what changed.
   *
   * @param {string} taskId - Task to update
   * @param {Object} updates - Partial task state fields to merge
   * @param {string} updates.agent - Agent making the update
   * @returns {Object} Updated task state snapshot
   * @throws {Error} If task not found or update violates schema
   */
  update(taskId, updates) {}

  /**
   * Take a point-in-time snapshot of the full task state.
   * Used by HandoffProtocol before pause.
   *
   * @param {string} taskId - Task to snapshot
   * @returns {Object} Deep-cloned task state with snapshot metadata
   */
  snapshot(taskId) {}

  /**
   * List tasks with optional filters.
   *
   * @param {Object} [filters={}]
   * @param {string} [filters.status] - Filter by status
   * @param {string} [filters.agent] - Filter by current_agent
   * @param {number} [filters.limit=50] - Max results
   * @returns {Array<Object>} Task state summaries (id, name, status, agent, phase)
   */
  list(filters = {}) {}

  /**
   * Validate a task state object against the JSON schema.
   *
   * @param {Object} state - Task state to validate
   * @returns {{ valid: boolean, errors: string[] }} Validation result
   */
  validate(state) {}

  /**
   * Transition task status (FSM enforcement).
   * Emits lifecycle events for the transition.
   *
   * @param {string} taskId - Task to transition
   * @param {string} newStatus - Target status
   * @param {string} agent - Agent performing transition
   * @param {Object} [metadata={}] - Additional context (reason, etc.)
   * @returns {Object} Updated task state
   * @throws {Error} If transition is invalid per FSM rules
   */
  transition(taskId, newStatus, agent, metadata = {}) {}

  /**
   * Advance to the next execution phase.
   * Records phase completion in phase_history.
   *
   * @param {string} taskId
   * @param {string} newPhase - 'analysis' | 'design' | 'implementation' | 'validation'
   * @param {string} agent - Agent advancing the phase
   * @param {string} [summary=''] - Summary of completed phase work
   * @returns {Object} Updated task state
   */
  advancePhase(taskId, newPhase, agent, summary = '') {}

  /**
   * Record an architectural decision on a task.
   * Emits 'architecture_decided' event.
   *
   * @param {string} taskId
   * @param {Object} decision
   * @param {string} decision.title
   * @param {string} decision.rationale
   * @param {string[]} [decision.alternatives=[]]
   * @param {string} [decision.tradeoffs='']
   * @param {string} decision.agent - Agent making the decision
   * @returns {string} decision_id
   */
  addDecision(taskId, decision) {}

  /**
   * Add a research note to a task.
   * Emits 'research_logged' event.
   *
   * @param {string} taskId
   * @param {Object} note
   * @param {string} note.source - Where the info came from
   * @param {string} note.summary - What was learned
   * @param {string} [note.impact='medium'] - 'low' | 'medium' | 'high'
   * @param {string} note.agent - Agent adding the note
   * @returns {Object} Updated task state
   */
  addResearchNote(taskId, note) {}

  /**
   * Add a subtask to the pending list.
   * Emits 'todo_added' event.
   *
   * @param {string} taskId
   * @param {string} subtask - Subtask description
   * @param {string} agent - Agent adding the subtask
   * @returns {Object} Updated task state
   */
  addSubtask(taskId, subtask, agent) {}

  /**
   * Move a subtask from pending to completed.
   *
   * @param {string} taskId
   * @param {string} subtask - Exact subtask string to complete
   * @param {string} agent
   * @returns {Object} Updated task state
   */
  completeSubtask(taskId, subtask, agent) {}

  /**
   * Move a subtask to blocked.
   *
   * @param {string} taskId
   * @param {string} subtask
   * @param {string} agent
   * @param {string} reason - Why it is blocked
   * @returns {Object} Updated task state
   */
  blockSubtask(taskId, subtask, agent, reason) {}

  /**
   * Flag a risk on a task.
   * Emits 'risk_flagged' event.
   *
   * @param {string} taskId
   * @param {Object} risk
   * @param {string} risk.risk - Risk description
   * @param {string} [risk.likelihood='medium'] - 'low' | 'medium' | 'high'
   * @param {string} [risk.mitigation=''] - Mitigation strategy
   * @param {string} risk.agent
   * @returns {Object} Updated task state
   */
  addRisk(taskId, risk) {}
}
```

### Events Emitted (via OrchestrationEventBus)

| Method | Event Type |
|---|---|
| `create()` | `task_started` |
| `transition()` to paused | `task_paused` |
| `transition()` to active | `task_resumed` |
| `transition()` to completed | `task_completed` |
| `advancePhase()` | `analysis_completed` (when leaving analysis), etc. |
| `addDecision()` | `architecture_decided` |
| `addResearchNote()` | `research_logged` |
| `addSubtask()` | `todo_added` |
| `addRisk()` | `risk_flagged` |

### Error Categories

- `orchestration_error` -- Schema validation failures, FSM transition violations
- Report via `errorHandler.report('orchestration_error', error, { taskId, agent })`

---

## 5. Module 2: OrchestrationEventBus

**File:** `src/orchestration/event-bus.js`
**Log prefix:** `[EVENT-BUS]`
**Responsibility:** Typed event envelopes with SHA256 integrity hashes, ring buffers, and persistent storage to SQLite.

### Event Envelope Schema

```json
{
  "event_id": "UUID (12-char truncated)",
  "timestamp": "ISO8601",
  "agent": "Claude | Ollama | Supervisor | System",
  "task_id": "string (12-char) | null",
  "event_type": "string (from VALID_EVENT_TYPES)",
  "payload": {},
  "integrity_hash": "SHA256 hex string"
}
```

**Integrity hash computation:**
```
SHA256( JSON.stringify({ event_id, timestamp, agent, task_id, event_type, payload }) )
```

This allows any consumer to verify event integrity by recomputing the hash from the envelope fields (excluding the hash itself).

### Valid Event Types

```javascript
const VALID_EVENT_TYPES = [
  'task_started',
  'analysis_completed',
  'architecture_decided',
  'implementation_started',
  'file_written',
  'research_logged',
  'risk_flagged',
  'todo_added',
  'task_paused',
  'task_resumed',
  'task_completed',
  'audit_warning',
  'audit_passed'
];
```

### Class Interface

```javascript
import { EventEmitter } from 'events';

class OrchestrationEventBus extends EventEmitter {
  /**
   * @param {OrchestrationStorage} storage - For persistent event logging
   * @param {Object} [config={}] - From orchestration.yaml event_bus section
   * @param {number} [config.ring_buffer_size=100] - Max events per type
   */
  constructor(storage, config = {}) {}

  /**
   * Emit a typed orchestration event.
   * Creates envelope, computes SHA256 hash, stores to ring buffer + SQLite,
   * forwards to TelemetryBus, and broadcasts via EventEmitter.
   *
   * @param {string} eventType - Must be in VALID_EVENT_TYPES
   * @param {Object} data
   * @param {string} data.agent - Agent emitting the event
   * @param {string} [data.taskId] - Associated task ID
   * @param {Object} [data.payload={}] - Event-specific payload
   * @returns {string} event_id
   * @throws {Error} If eventType is not in VALID_EVENT_TYPES
   */
  emit(eventType, data) {}

  /**
   * Verify the integrity hash of an event envelope.
   *
   * @param {Object} envelope - Full event envelope including integrity_hash
   * @returns {boolean} true if hash matches recomputed value
   */
  verifyIntegrity(envelope) {}

  /**
   * Get recent events from ring buffers.
   *
   * @param {string} [eventType] - Filter by type, or null for all
   * @param {number} [limit=20] - Max events to return
   * @returns {Array<Object>} Event envelopes, newest first
   */
  getRecent(eventType = null, limit = 20) {}

  /**
   * Query persisted events from SQLite.
   *
   * @param {Object} [filters={}]
   * @param {string} [filters.taskId] - Filter by task
   * @param {string} [filters.agent] - Filter by agent
   * @param {string} [filters.eventType] - Filter by type
   * @param {string} [filters.since] - ISO8601 lower bound
   * @param {number} [filters.limit=50] - Max results
   * @returns {Array<Object>} Event envelopes from SQLite
   */
  query(filters = {}) {}

  /**
   * Get event timeline for a specific task (all events, ordered).
   *
   * @param {string} taskId
   * @returns {Array<Object>} Ordered event envelopes for the task
   */
  getTaskTimeline(taskId) {}

  /**
   * Get aggregate counts by event type.
   *
   * @returns {Object} Map of event_type -> count
   */
  getCounts() {}

  /**
   * Clear ring buffers (useful for testing).
   */
  clear() {}
}
```

### Ring Buffer Layout

One ring buffer per event type (13 types), each capped at `ring_buffer_size` (default 100).

```javascript
this.ringBuffers = {
  task_started: [],
  analysis_completed: [],
  architecture_decided: [],
  implementation_started: [],
  file_written: [],
  research_logged: [],
  risk_flagged: [],
  todo_added: [],
  task_paused: [],
  task_resumed: [],
  task_completed: [],
  audit_warning: [],
  audit_passed: []
};
```

### TelemetryBus Integration

Every event emitted via OrchestrationEventBus.emit() also calls:
```javascript
telemetryBus.emit('orchestration_event', {
  eventType,
  agent: data.agent,
  taskId: data.taskId
});
```

This allows the existing /api/metrics endpoint to include orchestration activity.

---

## 6. Module 3: OrchestrationStorage

**File:** `src/orchestration/storage.js`
**Log prefix:** `[ORCH-STORAGE]`
**Responsibility:** SQLite persistence for task states, events, audit results, and agent registry. Mirrors src/forge3d/database.js patterns exactly.

### Constructor

```javascript
class OrchestrationStorage {
  /**
   * @param {string} [dbPath] - Path to SQLite DB file.
   *   Default: config/orchestration.yaml -> storage.db_path -> 'data/orchestration.db'
   */
  constructor(dbPath) {}

  /**
   * Open database, enable WAL/FK, run migrations.
   */
  open() {}

  /**
   * Close database connection.
   */
  close() {}
}
```

### CRUD Methods -- task_states

```javascript
  /**
   * Insert a new task state.
   * @param {Object} state - Full task state JSON (validated by TaskState)
   * @returns {Object} Inserted row
   */
  createTaskState(state) {}

  /**
   * Get a task state by ID.
   * @param {string} taskId
   * @returns {Object|null} Parsed task state or null
   */
  getTaskState(taskId) {}

  /**
   * Update a task state (full replacement of state_json).
   * @param {string} taskId
   * @param {Object} state - Full updated task state JSON
   */
  updateTaskState(taskId, state) {}

  /**
   * List task states with optional filters.
   * @param {Object} [filters={}]
   * @param {string} [filters.status]
   * @param {string} [filters.agent]
   * @param {number} [filters.limit=50]
   * @returns {Array<Object>} Task state summaries
   */
  listTaskStates(filters = {}) {}

  /**
   * Delete a task state and all associated events.
   * @param {string} taskId
   * @returns {boolean} true if deleted
   */
  deleteTaskState(taskId) {}
```

### CRUD Methods -- orchestration_events

```javascript
  /**
   * Insert an event envelope.
   * @param {Object} envelope - Event envelope with integrity_hash
   */
  insertEvent(envelope) {}

  /**
   * Query events with filters.
   * @param {Object} [filters={}]
   * @param {string} [filters.taskId]
   * @param {string} [filters.agent]
   * @param {string} [filters.eventType]
   * @param {string} [filters.since] - ISO8601 lower bound
   * @param {number} [filters.limit=50]
   * @returns {Array<Object>} Event envelopes
   */
  queryEvents(filters = {}) {}

  /**
   * Get all events for a task, ordered by timestamp.
   * @param {string} taskId
   * @returns {Array<Object>} Ordered event envelopes
   */
  getTaskEvents(taskId) {}

  /**
   * Get event counts by type.
   * @returns {Object} Map of event_type -> count
   */
  getEventCounts() {}
```

### CRUD Methods -- audit_results

```javascript
  /**
   * Insert an audit result.
   * @param {Object} result
   * @param {string} result.taskId
   * @param {string} result.auditType - 'structural' | 'coding_standard' | 'continuity'
   * @param {string} result.result - 'pass' | 'warning' | 'fail'
   * @param {number} result.confidenceScore - 0.0 to 1.0
   * @param {Object} result.details - Full audit output
   * @returns {string} audit_id
   */
  insertAuditResult(result) {}

  /**
   * Get audit history for a task.
   * @param {string} taskId
   * @param {number} [limit=20]
   * @returns {Array<Object>} Audit results, newest first
   */
  getAuditHistory(taskId, limit = 20) {}
```

### CRUD Methods -- agent_registry

```javascript
  /**
   * Register or update an agent entry.
   * @param {Object} agent
   * @param {string} agent.name - 'Claude' | 'Ollama'
   * @param {string} agent.type - 'cloud' | 'local'
   * @param {Object} [agent.capabilities={}] - Agent capability metadata
   * @param {string} [agent.status='available'] - 'available' | 'busy' | 'offline'
   */
  upsertAgent(agent) {}

  /**
   * Get all registered agents.
   * @returns {Array<Object>} Agent entries
   */
  listAgents() {}

  /**
   * Update agent status.
   * @param {string} agentName
   * @param {string} status - 'available' | 'busy' | 'offline'
   */
  updateAgentStatus(agentName, status) {}
```

### Utility Methods

```javascript
  /**
   * Run SQLite integrity check.
   * @returns {boolean} true if healthy
   */
  integrityCheck() {}

  /**
   * Get storage stats.
   * @returns {Object} { taskCount, eventCount, auditCount, dbSizeBytes }
   */
  getStats() {}
```

---

## 7. Module 4: SupervisorAgent

**File:** `src/orchestration/supervisor.js`
**Log prefix:** `[SUPERVISOR]`
**Responsibility:** Automated auditing of task state for structural integrity, coding standard compliance, and cross-agent continuity.

### Audit Types

1. **Structural Validation** -- Is the task state well-formed?
2. **Coding Standard Audit** -- Does the work follow Marcus's coding standards?
3. **Continuity Validation** -- Is the resuming agent following the original plan?

### Class Interface

```javascript
class SupervisorAgent {
  /**
   * @param {OrchestrationStorage} storage - For persisting audit results
   * @param {OrchestrationEventBus} eventBus - For emitting audit events
   * @param {Object} [config={}] - From orchestration.yaml supervisor section
   */
  constructor(storage, eventBus, config = {}) {}

  /**
   * Run all three audit types on a task.
   *
   * @param {string} taskId - Task to audit
   * @param {Object} taskState - Current task state snapshot
   * @returns {Object} Combined audit result:
   *   {
   *     audit_id: string,
   *     task_id: string,
   *     timestamp: ISO8601,
   *     structural: { passed: boolean, violations: string[], score: number },
   *     coding_standards: { passed: boolean, violations: string[], score: number },
   *     continuity: { passed: boolean, violations: string[], score: number },
   *     overall_result: 'pass' | 'warning' | 'fail',
   *     confidence_score: number (0.0-1.0),
   *     recommendations: string[]
   *   }
   */
  audit(taskId, taskState) {}

  /**
   * Structural validation only.
   * Checks:
   * - task_state_version matches '1.0.0'
   * - task_id is non-empty string
   * - status is valid enum value
   * - next_action is non-empty when status is 'active'
   * - At least one architectural decision exists when past analysis phase
   * - execution_phase.current_phase is valid
   * - ownership.current_agent is valid
   * - All required top-level fields exist
   *
   * @param {Object} taskState
   * @returns {{ passed: boolean, violations: string[], score: number }}
   */
  validateStructure(taskState) {}

  /**
   * Coding standard audit.
   * Checks task metadata for adherence to Marcus's standards:
   * - code_standards_enforced includes 'observer_pattern' when applicable
   * - code_standards_enforced includes 'no_hardcoded_values'
   * - code_standards_enforced includes 'structured_logging'
   * - code_standards_enforced includes 'typed_errors'
   * - files_affected paths use forward slashes and relative paths
   * - No files_affected entries reference node_modules or .env
   *
   * @param {Object} taskState
   * @returns {{ passed: boolean, violations: string[], score: number }}
   */
  auditCodingStandards(taskState) {}

  /**
   * Continuity validation (cross-agent).
   * Checks that a resuming agent is following the original architect's plan:
   * - Previously rejected alternatives are not reused
   * - Architectural decisions are not contradicted
   * - Completed phases are not re-entered
   * - Files affected are consistent with architectural decisions
   * - Pending subtasks are being addressed, not ignored
   *
   * @param {Object} taskState
   * @param {Array<Object>} eventHistory - Full event timeline from EventBus
   * @returns {{ passed: boolean, violations: string[], score: number }}
   */
  validateContinuity(taskState, eventHistory) {}

  /**
   * Get recent audit results for a task.
   *
   * @param {string} taskId
   * @param {number} [limit=10]
   * @returns {Array<Object>} Audit results, newest first
   */
  getAuditHistory(taskId, limit = 10) {}
}
```

### Scoring

Each audit category produces a score from 0.0 to 1.0:

```
score = 1.0 - (violations.length * penalty_per_violation)
```

Where `penalty_per_violation` is configurable (default 0.1). Score clamps to [0.0, 1.0].

The `confidence_score` in the combined result is the weighted average:
```
confidence_score = (structural.score * 0.4) + (coding_standards.score * 0.3) + (continuity.score * 0.3)
```

The `overall_result` maps:
- `confidence_score >= 0.8` -> `'pass'`
- `confidence_score >= 0.5` -> `'warning'`
- `confidence_score < 0.5` -> `'fail'`

### Events Emitted

| Condition | Event Type |
|---|---|
| `overall_result === 'pass'` | `audit_passed` |
| `overall_result === 'warning'` | `audit_warning` |
| `overall_result === 'fail'` | `audit_warning` (with severity=critical in payload) |

### Error Categories

- `supervisor_error` -- Audit execution failures
- Report via `errorHandler.report('supervisor_error', error, { taskId })`

---

## 8. Module 5: HandoffProtocol

**File:** `src/orchestration/handoff.js`
**Log prefix:** `[HANDOFF]`
**Responsibility:** Deterministic agent handoff with state serialization, validation, and pre-handoff supervisor audit.

### Handoff Flow

```
  Agent A (Claude) working on task
            |
            v
  HandoffProtocol.pause(taskId, 'Claude', reason)
            |
            +-- 1. TaskState.snapshot(taskId)
            +-- 2. SupervisorAgent.audit(taskId, snapshot)
            +-- 3. If audit.overall_result === 'fail' -> throw HandoffError
            +-- 4. TaskState.transition(taskId, 'paused', 'Claude')
            +-- 5. OrchestrationEventBus.emit('task_paused', { ... })
            +-- 6. Return serialized state JSON
            |
            v
  (Time passes. Agent B connects.)
            |
            v
  HandoffProtocol.resume(taskId, 'Ollama')
            |
            +-- 1. OrchestrationStorage.getTaskState(taskId)
            +-- 2. TaskState.validate(loadedState) -> schema check
            +-- 3. If validation fails -> throw HandoffError
            +-- 4. TaskState.transition(taskId, 'active', 'Ollama')
            +-- 5. Update ownership: current_agent='Ollama', push 'Claude' to previous_agents
            +-- 6. OrchestrationEventBus.emit('task_resumed', { ... })
            +-- 7. Return task state with next_action for Agent B to continue
```

### Class Interface

```javascript
class HandoffProtocol {
  /**
   * @param {TaskState} taskState - Task state manager
   * @param {SupervisorAgent} supervisor - For pre-handoff audits
   * @param {OrchestrationEventBus} eventBus - For handoff events
   * @param {Object} [config={}] - From orchestration.yaml handoff section
   * @param {boolean} [config.require_audit=true] - Require passing audit before pause
   * @param {number} [config.min_confidence=0.5] - Minimum confidence to allow handoff
   */
  constructor(taskState, supervisor, eventBus, config = {}) {}

  /**
   * Pause a task for handoff to another agent.
   * Runs pre-handoff supervisor audit (unless disabled in config).
   *
   * @param {string} taskId - Task to pause
   * @param {string} currentAgent - Agent initiating the pause
   * @param {string} [reason=''] - Why the handoff is happening
   * @returns {Object} Handoff package:
   *   {
   *     task_id: string,
   *     snapshot: Object (full task state),
   *     audit_result: Object (supervisor audit output),
   *     paused_at: ISO8601,
   *     paused_by: string,
   *     reason: string,
   *     next_action: string (from task state)
   *   }
   * @throws {HandoffError} If audit fails and require_audit is true
   */
  pause(taskId, currentAgent, reason = '') {}

  /**
   * Resume a paused task with a new agent.
   * Validates state schema integrity before allowing resume.
   *
   * @param {string} taskId - Task to resume
   * @param {string} newAgent - Agent taking over ('Claude' | 'Ollama')
   * @returns {Object} Resume package:
   *   {
   *     task_id: string,
   *     state: Object (current task state),
   *     previous_agent: string,
   *     resumed_at: ISO8601,
   *     resumed_by: string,
   *     next_action: string,
   *     pending_subtasks: string[],
   *     architectural_decisions: Object[] (for context)
   *   }
   * @throws {HandoffError} If task is not paused or schema validation fails
   */
  resume(taskId, newAgent) {}

  /**
   * Get handoff history for a task (all pause/resume events).
   *
   * @param {string} taskId
   * @returns {Array<Object>} Handoff events, ordered chronologically
   */
  getHistory(taskId) {}

  /**
   * Check if a task is eligible for handoff.
   *
   * @param {string} taskId
   * @returns {{ eligible: boolean, reason: string }}
   */
  canHandoff(taskId) {}
}
```

### HandoffError

A custom error class for handoff-specific failures:

```javascript
class HandoffError extends Error {
  /**
   * @param {string} message
   * @param {string} taskId
   * @param {string} code - 'AUDIT_FAILED' | 'NOT_PAUSED' | 'SCHEMA_INVALID' | 'TASK_NOT_FOUND'
   * @param {Object} [details={}]
   */
  constructor(message, taskId, code, details = {}) {
    super(message);
    this.name = 'HandoffError';
    this.taskId = taskId;
    this.code = code;
    this.details = details;
  }
}
```

### Error Categories

- `handoff_error` -- Handoff failures (audit blocked, schema invalid, task not found)
- Report via `errorHandler.report('handoff_error', error, { taskId, agent, code })`

---

## 9. Module 6: Orchestration Facade

**File:** `src/orchestration/index.js`
**Log prefix:** `[ORCHESTRATOR]`
**Responsibility:** Unified initialization, shutdown, and re-exports.

### Class Interface

```javascript
class Orchestrator {
  constructor() {
    this.storage = null;
    this.eventBus = null;
    this.taskState = null;
    this.supervisor = null;
    this.handoff = null;
    this.initialized = false;
  }

  /**
   * Initialize the orchestration runtime.
   * Opens database, runs migrations, creates all subsystem instances.
   *
   * @param {Object} [configOverride={}] - Override orchestration.yaml values
   * @returns {void}
   */
  init(configOverride = {}) {}

  /**
   * Graceful shutdown. Closes database connection.
   */
  shutdown() {}

  /**
   * Get runtime status.
   * @returns {Object} { initialized, taskCount, eventCount, agentStatuses }
   */
  getStatus() {}
}
```

### Re-exports

```javascript
// Named exports for direct access
export { Orchestrator };
export { TaskState } from './task-state.js';
export { OrchestrationEventBus } from './event-bus.js';
export { OrchestrationStorage } from './storage.js';
export { SupervisorAgent } from './supervisor.js';
export { HandoffProtocol, HandoffError } from './handoff.js';

// Singleton default export
const orchestrator = new Orchestrator();
export default orchestrator;
```

### Init Sequence

```
1. Load config/orchestration.yaml (with defaults)
2. new OrchestrationStorage(config.storage.db_path)
3. storage.open()   -- WAL mode, FK, migrations
4. new OrchestrationEventBus(storage, config.event_bus)
5. new TaskState(storage, eventBus)
6. new SupervisorAgent(storage, eventBus, config.supervisor)
7. new HandoffProtocol(taskState, supervisor, eventBus, config.handoff)
8. Register agents: storage.upsertAgent({ name: 'Claude', type: 'cloud' })
9. Register agents: storage.upsertAgent({ name: 'Ollama', type: 'local' })
10. Log: [ORCHESTRATOR] Initialized (tasks: N, events: N)
```

### Shutdown Sequence

```
1. Log: [ORCHESTRATOR] Shutting down...
2. storage.close()
3. Set initialized = false
4. Log: [ORCHESTRATOR] Shutdown complete
```

---

## 10. Module 7: Configuration

**File:** `config/orchestration.yaml`

```yaml
# BrightForge Orchestration Runtime Configuration
# All values can be adjusted without code changes.
# Loaded by src/orchestration/index.js at init time.

storage:
  db_path: "data/orchestration.db"
  journal_mode: "WAL"
  busy_timeout_ms: 5000

event_bus:
  ring_buffer_size: 100
  valid_event_types:
    - task_started
    - analysis_completed
    - architecture_decided
    - implementation_started
    - file_written
    - research_logged
    - risk_flagged
    - todo_added
    - task_paused
    - task_resumed
    - task_completed
    - audit_warning
    - audit_passed
  forward_to_telemetry: true

task_state:
  id_length: 12
  valid_statuses:
    - active
    - paused
    - completed
    - failed
  valid_phases:
    - analysis
    - design
    - implementation
    - validation
  valid_agents:
    - Claude
    - Ollama

supervisor:
  penalty_per_violation: 0.1
  weights:
    structural: 0.4
    coding_standards: 0.3
    continuity: 0.3
  thresholds:
    pass: 0.8
    warning: 0.5
  required_standards:
    - observer_pattern
    - no_hardcoded_values
    - structured_logging
    - typed_errors
    - configuration_driven
    - file_headers

handoff:
  require_audit: true
  min_confidence: 0.5
  max_handoffs_per_task: 10

agents:
  - name: Claude
    type: cloud
    capabilities:
      planning: true
      architecture: true
      code_review: true
      implementation: true
  - name: Ollama
    type: local
    capabilities:
      planning: true
      architecture: false
      code_review: false
      implementation: true
```

---

## 11. Database Schema

**Database file:** `data/orchestration.db`
**Follows:** `src/forge3d/database.js` migration pattern exactly.

### Migration v1 -- Initial Schema

```sql
-- Migration v1: Initial orchestration schema
-- task_states, orchestration_events, audit_results, agent_registry

CREATE TABLE IF NOT EXISTS task_states (
  task_id TEXT PRIMARY KEY,
  task_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'failed')),
  current_agent TEXT NOT NULL,
  current_phase TEXT NOT NULL DEFAULT 'analysis'
    CHECK (current_phase IN ('analysis', 'design', 'implementation', 'validation')),
  state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orchestration_events (
  event_id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  agent TEXT NOT NULL,
  task_id TEXT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  integrity_hash TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES task_states(task_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audit_results (
  audit_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  audit_type TEXT NOT NULL
    CHECK (audit_type IN ('structural', 'coding_standard', 'continuity', 'full')),
  result TEXT NOT NULL
    CHECK (result IN ('pass', 'warning', 'fail')),
  confidence_score REAL NOT NULL DEFAULT 0.0,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES task_states(task_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_registry (
  name TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('cloud', 'local')),
  capabilities TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'busy', 'offline')),
  last_active_at TEXT DEFAULT (datetime('now')),
  registered_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_task_states_status ON task_states(status);
CREATE INDEX IF NOT EXISTS idx_task_states_agent ON task_states(current_agent);
CREATE INDEX IF NOT EXISTS idx_events_task ON orchestration_events(task_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON orchestration_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON orchestration_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_agent ON orchestration_events(agent);
CREATE INDEX IF NOT EXISTS idx_audit_task ON audit_results(task_id);
CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_results(audit_type);
```

### Migration Tracking Table

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  description TEXT,
  applied_at TEXT DEFAULT (datetime('now'))
);
```

### MIGRATIONS Array Pattern

```javascript
const MIGRATIONS = [
  {
    version: 1,
    description: 'Initial schema: task_states, orchestration_events, audit_results, agent_registry',
    sql: `...SQL above...`
  }
];
```

---

## 12. Event Flow Diagrams

### Flow 1: New Task Creation

```
Claude starts a task
        |
        v
TaskState.create({
  taskName: 'Add auth module',
  agent: 'Claude',
  phase: 'analysis',
  nextAction: 'Scan codebase for auth patterns'
})
        |
        +---> OrchestrationStorage.createTaskState(state)
        +---> OrchestrationEventBus.emit('task_started', {
        |       agent: 'Claude',
        |       taskId: 'abc123...',
        |       payload: { taskName, phase }
        |     })
        |       +---> Ring buffer: task_started[]
        |       +---> SQLite: orchestration_events INSERT
        |       +---> TelemetryBus.emit('orchestration_event', {...})
        |
        v
  Return task state snapshot to caller
```

### Flow 2: Agent Handoff (Claude -> Ollama)

```
Claude decides to pause
        |
        v
HandoffProtocol.pause('abc123', 'Claude', 'Switching to local model')
        |
        +---> TaskState.snapshot('abc123')
        |       --> Deep clone of full state
        |
        +---> SupervisorAgent.audit('abc123', snapshot)
        |       +---> validateStructure()    --> { passed: true, score: 1.0 }
        |       +---> auditCodingStandards() --> { passed: true, score: 0.9 }
        |       +---> validateContinuity()   --> { passed: true, score: 1.0 }
        |       --> combined confidence: 0.96 --> 'pass'
        |       --> OrchestrationEventBus.emit('audit_passed', {...})
        |       --> OrchestrationStorage.insertAuditResult(...)
        |
        +---> TaskState.transition('abc123', 'paused', 'Claude')
        |       --> OrchestrationEventBus.emit('task_paused', {...})
        |       --> OrchestrationStorage.updateTaskState(...)
        |
        v
  Return handoff package (snapshot + audit + next_action)

        ... time passes ...

Ollama connects, calls:
        |
        v
HandoffProtocol.resume('abc123', 'Ollama')
        |
        +---> OrchestrationStorage.getTaskState('abc123')
        +---> TaskState.validate(loadedState) --> { valid: true }
        +---> TaskState.transition('abc123', 'active', 'Ollama')
        |       --> Update ownership.current_agent = 'Ollama'
        |       --> Push 'Claude' to ownership.previous_agents
        |       --> Set ownership.handoff_timestamp
        |       --> OrchestrationEventBus.emit('task_resumed', {...})
        |       --> OrchestrationStorage.updateTaskState(...)
        |
        v
  Return resume package (state + next_action + pending_subtasks + decisions)
  Ollama continues from next_action
```

### Flow 3: Supervisor Audit (Pre-Handoff)

```
SupervisorAgent.audit(taskId, taskState)
        |
        +---> validateStructure(taskState)
        |       Check: version, id, status, next_action, phases, ownership
        |       Output: { passed, violations[], score }
        |
        +---> auditCodingStandards(taskState)
        |       Check: code_standards_enforced[], files_affected[] paths
        |       Output: { passed, violations[], score }
        |
        +---> validateContinuity(taskState, eventHistory)
        |       Check: rejected alternatives not reused,
        |              decisions not contradicted,
        |              completed phases not re-entered,
        |              pending subtasks addressed
        |       Output: { passed, violations[], score }
        |
        +---> Compute weighted confidence:
        |       (structural * 0.4) + (coding * 0.3) + (continuity * 0.3)
        |
        +---> Map to overall_result: pass/warning/fail
        |
        +---> OrchestrationStorage.insertAuditResult(combined)
        +---> OrchestrationEventBus.emit('audit_passed' | 'audit_warning')
        |
        v
  Return combined audit result
```

---

## 13. Error Handling Strategy

### New Error Categories

Add to error-handler.js VALID_CATEGORIES:
- `orchestration_error` -- TaskState validation/transition failures
- `handoff_error` -- Handoff protocol failures (audit blocked, schema invalid)
- `supervisor_error` -- Audit execution errors

### Error Reporting Pattern

Every module follows the existing pattern:

```javascript
import errorHandler from '../core/error-handler.js';

try {
  // operation
} catch (err) {
  errorHandler.report('orchestration_error', err, {
    taskId,
    agent,
    operation: 'create'
  });
  throw err;
}
```

### Graceful Degradation

- If OrchestrationStorage fails to open, log warning and disable persistence. TaskState and EventBus still work in-memory only.
- If SupervisorAgent throws during audit, HandoffProtocol logs warning but does NOT block the handoff (configurable via `handoff.require_audit`).
- If TelemetryBus forwarding fails, log warning and continue (non-fatal).

---

## 14. Self-Test Specifications

Each module must have a --test block with the standard guard:

```javascript
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\/]/).pop())) {
  // tests here
}
```

### TaskState Tests

1. Create a task -> verify all fields present and valid
2. Load a task -> verify returns correct state
3. Transition active -> paused -> active -> completed (valid FSM)
4. Transition completed -> active -> expect Error (invalid FSM)
5. advancePhase() -> verify phase_history updated
6. addDecision() -> verify architectural_decisions array updated
7. addResearchNote() -> verify research_notes array updated
8. addSubtask() + completeSubtask() -> verify subtask lists
9. validate() -> pass with valid state, fail with missing fields
10. snapshot() -> verify deep clone (mutation isolation)

### OrchestrationEventBus Tests

1. Emit valid event -> verify envelope has all fields including integrity_hash
2. Emit invalid event type -> expect Error
3. verifyIntegrity() with valid envelope -> true
4. verifyIntegrity() with tampered payload -> false
5. Ring buffer overflow (emit 150 events, verify 100 kept)
6. getRecent() with type filter
7. getCounts() returns correct per-type counts
8. clear() resets all buffers

### OrchestrationStorage Tests

1. Open database with temp path -> verify tables created
2. CRUD task_states -> create, get, update, list, delete
3. CRUD orchestration_events -> insert, query with filters
4. CRUD audit_results -> insert, get history
5. CRUD agent_registry -> upsert, list, update status
6. integrityCheck() -> true on clean database
7. getStats() -> correct counts
8. Migration idempotency -> run open() twice, no errors

### SupervisorAgent Tests

1. Audit valid task state -> overall_result 'pass', confidence >= 0.8
2. Audit state missing next_action -> structural violation
3. Audit state with hardcoded values -> coding_standard violation
4. Audit state with contradicted decision -> continuity violation
5. Score calculation -> verify weighted average formula
6. Threshold mapping -> pass/warning/fail at boundaries

### HandoffProtocol Tests

1. pause() -> returns handoff package with snapshot + audit
2. resume() -> returns resume package with next_action
3. pause() on completed task -> expect HandoffError
4. resume() on non-paused task -> expect HandoffError
5. pause() with failing audit + require_audit=true -> expect HandoffError
6. Full round-trip: create -> pause -> resume -> verify state continuity
7. getHistory() -> returns chronological handoff events
8. canHandoff() -> eligible for active task, not for completed

### Facade (index.js) Tests

1. init() -> all subsystems created, initialized=true
2. shutdown() -> database closed, initialized=false
3. getStatus() -> returns correct task/event counts
4. Re-init after shutdown -> works without error

### npm Scripts to Add

```json
{
  "test-task-state": "node src/orchestration/task-state.js --test",
  "test-orch-events": "node src/orchestration/event-bus.js --test",
  "test-orch-storage": "node src/orchestration/storage.js --test",
  "test-supervisor": "node src/orchestration/supervisor.js --test",
  "test-handoff": "node src/orchestration/handoff.js --test",
  "test-orchestrator": "node src/orchestration/index.js --test"
}
```

---

## 15. Implementation Plan

### Task Sequence and Dependencies

```
Task A: OrchestrationStorage (storage.js)
  Input: ARCHITECTURE.md database schema, migration pattern from database.js
  Output: Working SQLite layer with all 4 tables and CRUD methods
  Dependencies: None (foundation layer)
  Assign to: implementer

Task B: OrchestrationEventBus (event-bus.js)
  Input: ARCHITECTURE.md event envelope spec, ring buffer pattern from telemetry-bus.js
  Output: Working event bus with SHA256 hashing, ring buffers, SQLite persistence
  Dependencies: Task A (needs storage for event persistence)
  Assign to: implementer

Task C: TaskState (task-state.js)
  Input: ARCHITECTURE.md JSON schema, FSM rules, forge-session.js state machine pattern
  Output: Working task lifecycle manager with all CRUD + phase/decision/subtask methods
  Dependencies: Task A + Task B (needs storage + event bus)
  Assign to: implementer

Task D: SupervisorAgent (supervisor.js)
  Input: ARCHITECTURE.md audit rules, scoring formula, threshold config
  Output: Working supervisor with structural, coding standard, and continuity audits
  Dependencies: Task A + Task B (needs storage + event bus)
  Assign to: implementer

Task E: HandoffProtocol (handoff.js)
  Input: ARCHITECTURE.md handoff flow, HandoffError class
  Output: Working pause/resume protocol with pre-handoff audits
  Dependencies: Task C + Task D (needs task state + supervisor)
  Assign to: implementer

Task F: Orchestration Facade (index.js)
  Input: ARCHITECTURE.md init/shutdown sequence, re-exports
  Output: Working facade with unified lifecycle management
  Dependencies: Tasks A-E (integrates all modules)
  Assign to: implementer

Task G: Configuration (config/orchestration.yaml)
  Input: ARCHITECTURE.md config spec
  Output: YAML config file with all default values
  Dependencies: None (can be done in parallel with Task A)
  Assign to: implementer

Task H: Update package.json + error-handler.js
  Input: New npm scripts, new error categories
  Output: Updated package.json scripts section, updated VALID_CATEGORIES in error-handler.js
  Dependencies: Tasks A-F complete (verify scripts work)
  Assign to: implementer

Task I: Review all orchestration modules
  Input: All implemented modules
  Output: Review report with findings
  Dependencies: Tasks A-H complete
  Assign to: reviewer
```

### Dependency Graph

```
  Task G (config)
      \
       \
Task A (storage) -----> Task B (event-bus)
      |                     |
      +------+--------------+
             |
        Task C (task-state)     Task D (supervisor)
             |                       |
             +-----------+-----------+
                         |
                    Task E (handoff)
                         |
                    Task F (facade)
                         |
                    Task H (updates)
                         |
                    Task I (review)
```

### Implementation Order (Recommended)

1. **Task G** -- `config/orchestration.yaml` (standalone, no dependencies)
2. **Task A** -- `storage.js` (foundation, enables everything else)
3. **Task B** -- `event-bus.js` (depends on storage)
4. **Task C** + **Task D** -- `task-state.js` + `supervisor.js` (can be parallelized)
5. **Task E** -- `handoff.js` (depends on C + D)
6. **Task F** -- `index.js` (depends on all above)
7. **Task H** -- Update `package.json` + `error-handler.js`
8. **Task I** -- Full review pass

### Key Files to Reference During Implementation

| Existing File | What to Mirror |
|---|---|
| `src/core/telemetry-bus.js` | EventEmitter pattern, ring buffers, emit() override, clear(), getMetrics() |
| `src/core/error-handler.js` | Error categories, JSONL logging, report() signature, crash reports |
| `src/forge3d/database.js` | SQLite setup (WAL, FK, busy_timeout), MIGRATIONS array, _migrate(), integrityCheck() |
| `src/forge3d/forge-session.js` | State machine (SESSION_STATES), lifecycle transitions, getStatus() |
| `src/forge3d/generation-queue.js` | FIFO processing, pause/resume, recovery on crash |
| `src/forge3d/config-loader.js` | YAML loading, _section() with defaults, resolvePath() |
| `.eslintrc.json` | Code style rules (2-space, single quotes, semicolons, CRLF) |

---

## Appendix A: File Manifest

```
src/orchestration/
  ARCHITECTURE.md         This document
  index.js                Facade -- init/shutdown/re-exports
  task-state.js           Task lifecycle FSM + JSON schema
  event-bus.js            Typed event envelopes + SHA256 + ring buffers
  storage.js              SQLite persistence (4 tables)
  supervisor.js           Structural/coding/continuity audits
  handoff.js              Pause/resume protocol + HandoffError

config/
  orchestration.yaml      Runtime configuration

data/
  orchestration.db        SQLite database (created at runtime)
```

## Appendix B: Integration Checklist

- [ ] `error-handler.js`: Add 'orchestration_error', 'handoff_error', 'supervisor_error' to VALID_CATEGORIES
- [ ] `package.json`: Add 6 new test-* scripts for orchestration modules
- [ ] `telemetry-bus.js`: Add 'orchestration' ring buffer (or route orchestration_event to performance buffer)
- [ ] Dashboard: Future -- add Orchestration tab to public/ (not in scope for v1)
- [ ] API routes: Future -- add routes/orchestration.js REST endpoints (not in scope for v1)

---

*End of Architecture Specification*
