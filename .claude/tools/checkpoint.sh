#!/usr/bin/env bash
# Save work to version control safely: commit (if needed) and push the current branch, verify the remote has it.
# Usage: checkpoint.sh ["commit message"]
# Safety rules enforced here (agents cannot forget them):
#   - only branches listed in .claude/approved-branches (one name per line) may be pushed;
#   - never force-pushes; if the push is not a fast-forward it stops and says why;
#   - refuses to commit when staged/changed files contain secret-like strings or .env files;
#   - verifies the remote tip equals the local HEAD afterwards.
set -u
MSG=${1:-"wip: checkpoint"}
BR=$(git rev-parse --abbrev-ref HEAD)
ROOT=$(git rev-parse --show-toplevel); cd "$ROOT" || exit 1
ALLOW="$ROOT/.claude/approved-branches"
if [ ! -f "$ALLOW" ] || ! grep -qxF "$BR" "$ALLOW"; then
  echo "REFUSED: branch '$BR' is not listed in .claude/approved-branches. Ask the owner to approve pushes to it (add its name to that file) or work on an approved branch."; exit 2
fi
case "$BR" in main|master|develop) echo "REFUSED: protected branch '$BR'."; exit 2;; esac
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git add -u
  if git diff --cached | grep -E '^\+' | grep -qiE 'sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY'; then
    git reset -q; echo "REFUSED: staged changes contain a secret-like string. Remove it first."; exit 2; fi
  git commit -q -m "$MSG" && echo "committed: $(git log -1 --format='%h %s')"
fi
NEW=$(git ls-files --others --exclude-standard | grep -vE '^(graphify-out|node_modules|\.gate)/' | head -20)
[ -n "$NEW" ] && echo "NOTE: $(echo "$NEW" | wc -l) untracked file(s) not included (add deliberately with git add), e.g. $(echo "$NEW" | head -3 | tr '\n' ' ')"
git ls-files --others --exclude-standard | grep -qE '(^|/)\.env($|\.)' && { echo "REFUSED: an .env file is untracked in the tree; make sure it is ignored."; exit 2; }
# Scan every commit that is about to leave this machine, not only the newest change.
if git rev-parse -q --verify "origin/$BR" >/dev/null; then RANGE="origin/$BR..HEAD"; else RANGE="HEAD --not --remotes"; fi
if git log -p $RANGE 2>/dev/null | grep -E '^\+' | grep -qiE 'sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY'; then
  echo "REFUSED: a commit that would be pushed contains a secret-like string. Remove it from history (amend or reset your own unpushed commit; do not push it)."; exit 2; fi
ERR=$(mktemp); trap 'rm -f "$ERR"' EXIT
D=2; for i in 1 2 3 4; do
  if git push -q origin "$BR" 2>"$ERR"; then break; fi
  if grep -qiE 'non-fast-forward|rejected|fetch first' "$ERR"; then
    echo "STOP: push rejected (remote has commits you do not have). Do NOT force-push. Run: git fetch origin $BR && git log HEAD..origin/$BR --oneline  then integrate (rebase is not allowed here; use merge or cherry-pick) and run this again."; exit 3; fi
  sleep $D; D=$((D*2)); [ $i -eq 4 ] && { echo "push failed after retries: $(tail -1 "$ERR")"; exit 4; }
done
L=$(git rev-parse HEAD); R=$(git ls-remote origin "refs/heads/$BR" | cut -f1)
[ "$L" = "$R" ] && echo "SAVED: $BR is on the remote at ${L:0:7}" || { echo "MISMATCH: local ${L:0:7} remote ${R:0:7}"; exit 5; }
