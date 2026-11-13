#!/usr/bin/env bash
# Optional Stop hook: block stopping while the current approved branch has unpushed commits.
# Gives up after 3 blocks per commit (cannot trap a session). Resolution is always: run checkpoint.sh.
ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"; cd "$ROOT" 2>/dev/null || exit 0
BR=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
[ -f .claude/approved-branches ] && grep -qxF "$BR" .claude/approved-branches || exit 0
AHEAD=$(git rev-list --count "origin/$BR..HEAD" 2>/dev/null || echo 0)
[ "$AHEAD" -gt 0 ] || exit 0
mkdir -p .gate; K=".gate/unpushed-attempts"; H=$(git rev-parse HEAD); N=0
[ -f "$K" ] && { read -r h n < "$K"; [ "$h" = "$H" ] && N=$n; }
[ "$N" -ge 3 ] && exit 0
echo "$H $((N+1))" > "$K"
echo "Branch $BR has $AHEAD unpushed commit(s). Save them: run the work-preservation skill's checkpoint.sh (it never force-pushes and verifies the remote). If the commits are already contained in another remote branch, run preserve_report.sh and re-point the local branch instead." >&2
exit 2
