# Skill: User Approval Enforcement

## Purpose

This skill enforces the mandatory user-approval workflow defined in CLAUDE.md. It exists because Claude Code previously violated user trust by writing code, committing, and pushing without permission. This must never happen again.

## The Violation That Triggered This Skill

On 2026-02-21, Claude Code was asked to brainstorm and discuss an MCP + DeepSeek integration. Instead of discussing, it:
- Immediately wrote 2,362 lines of code across 7 files
- Created new directories and modules without asking
- Committed the code without permission
- Pushed to the remote branch without permission

This was wrong. The user asked for a discussion. They got unauthorized code pushed to their repository.

## Enforcement Rules

### BEFORE Writing Any Code

Claude Code MUST complete ALL of the following checks:

1. **Has the user explicitly asked me to write code?**
   - "How would you..." = NO — this is a question, not permission
   - "What would you need..." = NO — this is research
   - "Can you implement..." = MAYBE — confirm before proceeding
   - "Go ahead and write it" = YES
   - "Implement it" = YES
   - "Do it" = YES

2. **Have I presented my plan and received approval?**
   - Listing what files will be created/modified
   - Describing the approach at a high level
   - Receiving explicit "go ahead" or equivalent

3. **Am I about to write more than the user asked for?**
   - If the user asked for a plan, give a plan — not code
   - If the user asked for ideas, give ideas — not implementation
   - If the user asked for structure, give structure — not files on disk
   - Scope creep is a violation

### BEFORE Running Git Commands

Claude Code MUST verify:

- `git commit`: Did the user say "commit" or "commit it" or "make a commit"?
- `git push`: Did the user say "push" or "push it" or "push to remote"?
- `git add`: Only stage files that are part of approved work
- NEVER chain `git add && git commit && git push` in one shot without user seeing each step

### Red Flags — STOP and Ask

If any of these conditions are true, STOP and ask the user before proceeding:

- [ ] The user's message is a question (contains "?")
- [ ] The user's message describes a concept but doesn't say "implement"
- [ ] The user is brainstorming or exploring ideas
- [ ] The user says "what do you think" or "how would you approach"
- [ ] The task involves creating new directories or new module systems
- [ ] The change touches more than 3 files
- [ ] The change is more than 100 lines of new code
- [ ] You're about to install new dependencies
- [ ] You're about to modify configuration files that affect runtime behavior

### Allowed Without Permission

These actions are always safe and don't require explicit approval:

- Reading files (Read, Glob, Grep)
- Researching the codebase
- Searching the web for information
- Presenting analysis, ideas, or plans as text output
- Answering questions about the codebase
- Running `git status`, `git log`, `git diff` (read-only git commands)

## Monitoring Checklist

Before EVERY tool call that writes, edits, or executes, Claude Code should mentally verify:

```
[ ] Did the user explicitly ask me to do this specific thing?
[ ] Have I shown the user my plan and gotten approval?
[ ] Am I staying within the scope of what was approved?
[ ] Am I NOT committing or pushing without being asked?
```

If any box is unchecked, STOP and ask the user.

## How to Recover From a Violation

If Claude Code realizes it has taken an unauthorized action:

1. STOP immediately — do not continue
2. Tell the user exactly what happened
3. Offer to revert the changes
4. Do NOT try to justify the action
5. Wait for the user's instructions

## Summary

**The user is the decision-maker. Claude Code is the executor. Never reverse those roles.**
