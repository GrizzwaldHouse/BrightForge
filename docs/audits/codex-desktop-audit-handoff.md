# Codex audit handoff (desktop)

Use this to have Codex independently audit the BrightForge work done in the cloud session. It complements `codex-verification-handoff.md`, which lists the original reproduction commands.

## How to start Codex

Pick one:

- **PowerShell:** `cd "C:\AgentForge Control"` then run `codex`. Paste the prompt below as the first message.
- **ChatGPT desktop app:** open the Codex tab, choose the AgentForge Control project folder, and paste the prompt below.

Codex needs an OpenAI account with available quota. The cloud session's Codex run was blocked by "Quota exceeded", so check billing first.

## Prompt

```text
You are an independent auditor for the BrightForge repository. You did not write any of this work. Do not trust any report in the repository; reproduce every claim yourself. Do not fix code. Output a report only.

Setup (do exactly this; do not use or modify D:\BrightForge or C:\Users\daley\Projects\BrightForge, they hold unpushed work):
  cd "C:\AgentForge Control\work"
  git clone --branch repair/p0-recovery-2026-10 https://github.com/GrizzwaldHouse/BrightForge.git brightforge-audit
  cd brightforge-audit
  git log -1 --oneline        # record this hash in your report

Rules: no secrets (never print or copy API keys), do not download AI models, do not push anywhere, do not merge. Docker is allowed only for the repository's `test` compose profile.

Read first: docs/audits/final-change-manifest.md, fix-spec.md, feature-verification-matrix.md, adversarial-report.md, threat-model.md, sandbox-design.md, clean-room-run-ed7bfca.md, codex-verification-handoff.md.

Verify, and mark each PASS / FAIL / BLOCKED / NOT REPRODUCED with the command and evidence:
1. History: 16c98f2553dd9e90351dca02910e74fd88851224 and origin/main are ancestors of HEAD; the history is linear; `git diff --check 16c98f2...HEAD` is clean.
2. Commit hygiene: no commit message contains AI/tool attribution lines (Co-Authored-By, "Generated with"); no .env files or secrets in any commit (grep the diff and history).
3. Install and lint: `npm ci` exits 0; `npm run lint` has 0 errors.
4. Test suites in Docker: `docker compose --profile test run --rm --no-deps brightforge-test` (compare the script count and pass count with the reports) and `... brightforge-python-test`.
5. Regression tests individually: test-selftest-guard, test-security, test-events-queue, test-frontend-assets, test-mesh-flow, test-frontend-routes, test-llm-contract, test-clean-room-fixes, plus any test-fix-* scripts present.
6. Baseline reproduction: in a `git worktree` of 16c98f2, copy in the regression tests and confirm they FAIL there, including the revert-injection sentinel.
7. Security fixes, adversarially: revert endpoint with ref names, ranges, `--help` and 5000-character input; a model plan containing `../x.txt` must not write outside the project; server refuses a non-loopback bind without BRIGHTFORGE_API_KEY; wrong key 401; spoofed X-Forwarded-For 401.
8. Browser/feature claims: re-run test/clean-room (see its README) and compare with docs/audits/feature-verification-matrix.md row by row. Flag any row where the matrix claims PASS without evidence.
9. Fix quality: review every commit after 1590e5f with `git log -p`. For each fix in fix-spec.md (R-A1 ... R-E2) check the code does what the spec says, the test fails without the change, and nothing outside the stream's file list was touched. List scope creep and weak tests (tests that assert nothing).
10. Overclaims: list any statement in docs/audits that is not backed by a command and result in the same document.

Write the report to:
  C:\AgentForge Control\.claude\Reports\codex-brightforge-audit-<date>.md
and a copy to docs\audits\codex-independent-verification.md inside the clone (commit it locally; do not push).
End with one line: APPROVE, REQUEST CHANGES or BLOCK, with the three most important reasons.
```

## After Codex finishes

Bring the report back to the cloud session. Findings go into a new fix round using the same spec-first process; nothing is merged into `main` until you approve it.
