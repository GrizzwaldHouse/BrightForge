#!/usr/bin/env bash
# Read-only: show everything that exists only locally (unpushed branches, commits, worktrees, stashes, dirty files),
# so nothing is lost when a container or session ends. Changes nothing.
set -u
git fetch -q --all --prune 2>/dev/null
echo "== branches with commits not on any remote branch"
for B in $(git for-each-ref --format='%(refname:short)' refs/heads); do
  N=$(git rev-list --count "$B" --not --remotes 2>/dev/null)
  [ "$N" != "0" ] && echo "  $B: $N commit(s) only here (tip $(git rev-parse --short "$B"))"
done
echo "== branches whose commits are all on some other remote branch (safe; re-point instead of pushing)"
for B in $(git for-each-ref --format='%(refname:short)' refs/heads); do
  [ "$(git rev-list --count "$B" --not --remotes)" = "0" ] && echo "  $B -> contained in: $(git branch -r --contains "$B" | tr -d ' ' | head -2 | tr '\n' ' ')"
done
echo "== worktrees"; git worktree list
echo "== stashes"; git stash list
echo "== uncommitted (tracked)"; git status --porcelain --untracked-files=no | head -20
echo "== untracked (not ignored)"; git ls-files --others --exclude-standard | head -20
echo "== tags only local"; for T in $(git tag); do git ls-remote --tags origin "$T" | grep -q . || echo "  $T"; done
