#!/usr/bin/env bash
# Stop hook: do not let an agent stop while the build gate has known, fixable failures
# for the current commit. Reads .gate/build-gate-report.json (see references/fix-loop.md).
# Allows stopping when: no report, verdict READY, report is for another commit,
# only OWNER failures remain, or this commit was already blocked 3 times.
DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
REPORT="$DIR/.gate/build-gate-report.json"
COUNTER="$DIR/.gate/stop-attempts"
[ -f "$REPORT" ] || exit 0
HEAD_SHA=$(git -C "$DIR" rev-parse HEAD 2>/dev/null) || exit 0
python3 - "$REPORT" "$HEAD_SHA" "$COUNTER" <<'PY'
import json, os, sys
report, head, counter = sys.argv[1:4]
try:
    d = json.load(open(report))
except Exception:
    sys.exit(0)
if d.get("verdict") == "READY" or d.get("head") != head:
    sys.exit(0)
fixable = [s for s in d.get("steps", [])
           if s.get("result") in ("FAIL", "NOT RUN")
           and s.get("failure_class") in ("PRODUCT", "HARNESS", "UNEXPLAINED", None)]
if not fixable:
    sys.exit(0)
tries = 0
if os.path.exists(counter):
    h, _, k = open(counter).read().partition(" ")
    if h == head:
        tries = int(k or 0)
if tries >= 3:
    sys.exit(0)
open(counter, "w").write("%s %d" % (head, tries + 1))
lines = ["Build gate is NOT READY at %s with fixable failures (attempt %d of 3):" % (head[:7], tries + 1)]
for s in fixable:
    lines.append("  - step %s %s [%s]: %s" % (s.get("step"), s.get("name"), s.get("failure_class"), str(s.get("detail"))[:160]))
lines.append("Do not stop and report these. Fix them (skill verified-build-gate, references/fix-loop.md),")
lines.append("re-run only the failed steps, update the report, and report back when READY or blocked on the owner.")
sys.stderr.write("\n".join(lines) + "\n")
sys.exit(2)
PY
