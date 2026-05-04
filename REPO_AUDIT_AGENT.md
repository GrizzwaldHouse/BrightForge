# REPO_AUDIT_AGENT.md — AgentForge Integration Audit
# Developer: Marcus Daley | Date: 2026-05-03
# Drop into any GrizzwaldHouse repo. Run: claude --print "$(cat REPO_AUDIT_AGENT.md)"

## AGENT IDENTITY
GrizzwaldHouse Repo Audit Agent. AgentForge PRD v2 reference (biomechanical model):
Heart=Orchestrator | Nervous=EventBus/OwlWatcher | Brain=KnowledgeGraph/RAG
Muscles=Execution/Playwright | Skin=Auth | Endocrine=Config | Skeletal=Contracts | Lymphatic=Observability

## STEP 1 - IDENTIFY REPO ROLE
Classify against: HEART | NERVOUS_SYSTEM | BRAIN | MUSCLES | SKIN | ENDOCRINE | SKELETAL | LYMPHATIC | UI | STANDALONE

## STEP 2 - COMPLIANCE CHECKS
Run these and record PASS/FAIL:
- grep polling: setInterval|while True|time.sleep
- grep hardcoded: "http://|localhost:[0-9]
- find config files: *.config.json|.env.example
- grep observer pattern: EventEmitter|event_bus|on(|emit(
- grep VRAM watchdog: nvidia-smi|VramWatchdog
- grep EM dashes: " — | – " (PRD violation)
- check file headers on first 3 source files
- check .env.example exists

## STEP 3 - FUNCTION INVENTORY
Scan all .py .ts .tsx .cpp .cs files. For each function/class assign:
COMPLETE | PARTIAL | TODO | NEEDS_TEST | BLOCKED | AGENTFORGE_READY

Output table per file: Symbol | Type | Status | AgentForge Layer | Notes

## STEP 4 - TODO/GAP EXTRACTION  
grep TODO FIXME HACK PLACEHOLDER NOT_IMPLEMENTED
Also find: missing event types, missing config, direct agent-to-agent calls, hardcoded model names

## STEP 5 - TEST COVERAGE
Find test files. Count test functions. Rate: NONE|LOW|MEDIUM|HIGH

## STEP 6 - AGENTFORGE READINESS GATE
Per component: READY|PARTIAL|NOT_READY|NEEDS_MIGRATION

## STEP 7 - AGENTFORGE GAP REPORT
List: Missing Components | Refactors Required | Config Files Needed | Event Contracts Needed | PRD Violations

## STEP 8 - WRITE STATUS.md with all above sections

## STEP 9 - WRITE .agentforge/audit_result.json
Schema: {repo, auditTimestamp, agentforgeRole, integrationStatus, readiness, compliance{}, stats{}, gaps{}}

## STEP 10 - COMMIT AND PUSH
git add STATUS.md .agentforge/audit_result.json
git commit -m "audit: AgentForge integration audit $(date -u +%Y-%m-%d) [skip ci]"
git push origin HEAD

## CONSTRAINTS
- Read-only on source code. Never modify .py .ts .cpp .cs files.
- Never commit credentials or .env files.
- Flag ALL polling loops as PRD_VIOLATION (mandatory event-driven per PRD v2).
- Flag ALL hardcoded values as PRD_VIOLATION.
- Flag direct agent-to-agent calls as PRD_VIOLATION.
