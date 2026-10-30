# Handoff for Independent Verification

This branch is ready for the independent verification described in the clean-room package (`02_CODEX_INDEPENDENT_VERIFICATION.md`). Do not trust the claims in the other reports; reproduce them.

## Inputs

- Branch: `repair/p0-recovery-2026-10`
- Base for the diff: `16c98f2553dd9e90351dca02910e74fd88851224`
- Reports to check against:
  - `branch-reconciliation-report.md`
  - `security-and-repository-hygiene.md`
  - `baseline-test-report.md`
  - `ollama-docker-validation.md`
  - `final-change-manifest.md`

## Suggested command sequence

```bash
git fetch origin repair/p0-recovery-2026-10 feat/migrate-d-drive-untracked-work main
git checkout repair/p0-recovery-2026-10
git merge-base --is-ancestor 16c98f2 HEAD && git merge-base --is-ancestor origin/main HEAD   # ancestry
git diff --check 16c98f2...HEAD                                                               # whitespace
git diff --stat 16c98f2...HEAD

# Clean install and the full deterministic suite, isolated
docker compose config -q
docker compose --profile test build
docker compose --profile test run --rm --no-deps brightforge-test          # expect 86/86
docker compose --profile test run --rm --no-deps brightforge-python-test   # expect 4 tests OK

# Individual regression tests (also part of the suite)
npm ci
npm run test-selftest-guard   # imports never run tests; failed console.assert -> exit 1
npm run test-security         # bind address, API key, revert injection (sentinel)
npm run test-events-queue     # dead-letter + WebSocket bridge
npm run test-frontend-assets  # pinned three.js served locally
npm run test-mesh-flow        # optimised bytes are the exported bytes
npm run test-frontend-routes  # every UI /api URL has a route
npm run test-llm-contract     # forceProvider, budget, Ollama behaviours (mock)

# Reproduce the baseline failures (in a disposable copy of 16c98f2)
git worktree add ../bf-baseline 16c98f2
cp src/tests/{security-regression,events-queue-integration,mesh-optimize-flow,frontend-routes-check}.js ../bf-baseline/src/tests/
mkdir -p ../bf-baseline/test/fixtures && cp test/fixtures/cube.glb ../bf-baseline/test/fixtures/
(cd ../bf-baseline && npm install && node src/tests/security-regression.js)   # expect failures incl. sentinel
```

The worktree commands above add a local worktree only; remove it afterwards with `git worktree remove ../bf-baseline`.

## Points that deserve adversarial attention

1. **Self-test guard.**
   - `isSelfTest()` compares real paths. Check it on Windows (drive-letter case, backslashes, symlinked checkouts).
   - The guard check runs its dynamic probe over every module that has a self-test.
2. **Assertion guard.**
   - It overrides `process.exit` during self-tests only.
   - Confirm that no production path imports a module with `--test` in `argv`.
3. **Auth.**
   - With no key, only loopback peers are allowed, and the decision uses the socket address, not `X-Forwarded-For`.
   - Behind a same-host reverse proxy every request appears to come from loopback. Evaluate whether that is acceptable.
4. **Revert endpoint.** It accepts only hex hashes of existing commits whose subject starts with `brightforge:`. Try ref names, ranges, option-like values (`--help`), and very long input.
5. **Mesh flow.** The Node test uses a fake inference server. The Python function is tested directly; the FastAPI endpoint itself was not exercised (it imports torch-dependent modules).
6. **Docker.** Confirm nothing from build secrets or proxy args persists in layers (`docker history --no-trunc`), and that the runtime user is non-root.
7. **Excluded scripts** in `src/tests/run-deterministic-suite.js`: confirm every exclusion is justified.

## Not mergeable until

- The owner confirms the MSI/PowerSpec state (no unpushed local commits), or integrates any it finds.
- The independent verification report is written to `docs/audits/codex-independent-verification.md`.
- The owner approves the merge into `main`.
