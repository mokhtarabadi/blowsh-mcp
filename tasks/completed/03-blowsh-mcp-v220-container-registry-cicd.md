# Task 03: Blowsh-MCP v2.2 — Container Registry Distribution & CI/CD

**File:** `tasks/completed/03-blowsh-mcp-v220-container-registry-cicd.md`
**Source:** manager
**Type:** feature
**Status:** closed

## Goal

Ship blowsh-mcp as a prebuilt container image on GitHub Container Registry (`ghcr.io/mokhtarabadi/blowsh-mcp`) and automate image builds with GitHub Actions so new users can run the server directly from the published image without building locally. Update README/docs to document the prebuilt image, and point the local opencode configuration at the published image.

## Manager's Notes

- Manager explicitly authorized: create task → research → implement → build & push image to ghcr → push code via `gh` → track CI/CD status → once verified, update docs/README to mention the prebuilt image → update `~/.config/opencode/opencode.jsonc` to use the prebuilt image.
- Registry target: `ghcr.io/mokhtarabadi/blowsh-mcp` (repo is public; package visibility to be confirmed after first push).
- CI/CD must build the Dockerfile and push to ghcr on pushes to `main` and on version tags (`v*`), plus manual `workflow_dispatch`.
- All runtime verification stays container-based (Firefox/Browsh/html2markdown are not installed on the host).
- ZAC applies: staging via `custom_context_stage_and_inject_diff`; commit/push only because the Manager explicitly instructed the push for CI/CD validation.

## Local TODOs

- [ ] Research: gh auth, remote, repo visibility, docker availability, opencode.jsonc state
- [ ] Add `.github/workflows/docker-publish.yml` (buildx + ghcr login + metadata tags + push)
- [ ] Add OCI provenance labels to `Dockerfile` (org.opencontainers.image.*)
- [ ] Add CI smoke test step (MCP initialize → tools/list over `docker run -i`)
- [ ] Build image locally, tag `ghcr.io/mokhtarabadi/blowsh-mcp:latest`, push to ghcr
- [ ] Verify ghcr package exists and is pullable (`docker manifest inspect` / `gh api`)
- [ ] Stage + inject diff via MCP; move task to `tasks/qa/`; re-stage
- [ ] Commit + push via `gh` (explicitly instructed); trigger workflow
- [ ] Track workflow status (`gh run list` / `gh run view`); fix issues if any; re-push
- [ ] Update README (prebuilt image section, opencode config example) and `docs/architecture.md` (deployment/registry section)
- [ ] Update `CHANGELOG.md` (v2.2.0 entry)
- [ ] Update project `opencode.json` to use the published image
- [ ] Update `~/.config/opencode/opencode.jsonc` to use the published image
- [ ] Final `lint_task_file` + notify Manager for QA/review

## Acceptance Criteria

- [ ] `ghcr.io/mokhtarabadi/blowsh-mcp:latest` exists and is pullable by an unauthenticated client (public) or documented as private
- [ ] GitHub Actions workflow builds and pushes the image on `main` push and on `v*` tags
- [ ] CI smoke test passes (container boots, `tools/list` returns the 4 tools)
- [ ] README documents `docker pull ghcr.io/mokhtarabadi/blowsh-mcp:latest` and the opencode/Claude config using the published image
- [ ] `docs/architecture.md` deployment section mentions the registry + CI/CD
- [ ] `CHANGELOG.md` has a v2.2.0 entry
- [ ] `~/.config/opencode/opencode.jsonc` uses the published image
- [ ] `lint_task_file` passes; task file moved to `tasks/qa/` with updated `**File:**` header

## Verification Evidence

- **Test command:** `docker pull ghcr.io/mokhtarabadi/blowsh-mcp:latest && docker run --rm -i ghcr.io/mokhtarabadi/blowsh-mcp:latest` (MCP initialize → tools/list)
- **Expected result:** image pulls without auth; server responds to initialize and lists `fetch_web`, `search_web`, `extract_links`, `fetch_web_batch`
- **Actual result:** _(The Hands fill this during execution)_
- **Exit code:** _(The Hands fill this during execution)_

## Definition of Done

The task is NOT done unless ALL of the following are true (unconditional, applies to every source type):

- [ ] Build/Test/Lint pass with exit code 0
- [ ] `lint_task_file` passes on the active task file
- [ ] `CHANGELOG.md` updated via Parse-Then-Append
- [ ] `verification-before-completion` applied and evidence recorded

## Risk & Rollback

- **Risk:** ghcr package visibility defaults to private; unauthenticated `docker pull` fails until visibility is set public (requires PAT or web UI — may need Manager action).
- **Risk:** CI workflow misconfiguration (permissions, token scopes) blocks the push; workflow run fails.
- **Risk:** Docker build fails in CI due to missing buildx or network-restricted apt/wget downloads.
- **Rollback plan:** revert the workflow file and README/docs changes via `git revert`; delete the ghcr package via `gh api -X DELETE /user/packages/container/blowsh-mcp` if needed; keep local `docker build` as the fallback distribution path.

---

## Execution Log & Reasoning

_Stage: implementation (2026-08-17)._

### Architecture reasoning

1. **CI/CD design:** `.github/workflows/docker-publish.yml` uses the standard buildx + `docker/login-action` + `docker/metadata-action` + `docker/build-push-action` chain. `GITHUB_TOKEN` with `permissions: packages: write` is sufficient for ghcr pushes (no PAT needed). Tag set: `latest` (default branch), branch name, semver (`{{version}}`, `{{major}}.{{minor}}` for `v*` tags), and `sha-<sha>` for provenance. GHA cache (`type=gha`) speeds rebuilds. A smoke-test step boots the built image (`load: true`) over stdio, sends MCP initialize → notifications/initialized → tools/list, and greps for `fetch_web` — so a broken tool surface fails the pipeline.

2. **Registry target:** `ghcr.io/mokhtarabadi/blowsh-mcp` (public repo). Manual `docker push` from this machine was attempted but the `gh` token scopes (`repo`, `gist`, `read:org`, `admin:public_key`) lack `write:packages` → `permission_denied`. CI/CD push path (GITHUB_TOKEN, `packages: write`) is unaffected and is the primary delivery path. Manager action needed later for manual pushes: `gh auth refresh -h github.com -s write:packages`.

3. **Version:** bumped 2.1.1 → 2.2.0 in `package.json` and the server-reported MCP version in `src/server.ts`, synced with the new CHANGELOG entry (distribution capability = minor release).

4. **Docs/config sync:** README gains a Quick Start (prebuilt image) and the opencode example now points at the ghcr image with the 120 s timeout (matching `opencode.json`); `docs/architecture.md` deployment section updated; project `opencode.json` now runs `ghcr.io/mokhtarabadi/blowsh-mcp:latest`. `~/.config/opencode/opencode.jsonc` update follows after CI/CD verification (per Manager ordering).

5. **Verification:** `npm run build` (tsc strict) passes; local `docker build` succeeded; local container smoke test registered all 4 tools (`fetch_web`, `search_web`, `extract_links`, `fetch_web_batch`); workflow YAML parses cleanly.

### ⚠️ Git permission blocker (needs Manager action)

- All work is **staged** and the factual diff is injected into this task file (QA can review it here).
- The environment's permission layer **denies agent-run `git commit` and `git push`** (ZAC: `git commit*`/`git push*` → `deny`), so the Manager must execute the push (or relax the permission rules), then I can track the CI/CD run with `gh`.
- Manual ghcr image push also blocked for token scopes: `gh auth refresh -h github.com -s write:packages` is needed for future manual `docker push`; the CI workflow (GITHUB_TOKEN, `packages: write`) is unaffected.
- ghcr package visibility will likely default to **private** after the first CI push — unauthenticated pulls need the package set public (GitHub UI or `gh api` with a PAT).

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
**Factual Git Diff:** Stored in Commit Hash: `31f04ad1a81649e8fc4568ca8dbe4265476e7b55`
<!-- END_GIT_DIFF -->