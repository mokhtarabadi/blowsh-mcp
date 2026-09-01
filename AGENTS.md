# blowsh-mcp — Project Context Hub

## Project Overview

blowsh-mcp is a Model Context Protocol (MCP) server that exposes Browsh — a fully JavaScript-capable terminal browser backed by headless Firefox — to AI agents. It renders any modern web page after full JS execution and returns plain text, HTML, or Markdown. Version 2.0.0 adds web search, link extraction, batch fetching, structured extraction, an SSRF guard, and a TTL render cache.

**Tech stack:** TypeScript 7 (strict, NodeNext ESM), Node.js >= 20.18, @modelcontextprotocol/sdk 1.30, zod 4, axios, cheerio, html2markdown CLI (external binary), Browsh CLI + Firefox (external binaries), Docker (multi-stage fat image).

## Setup & Dev Commands

- Build: `npm run build` (tsc, outputs `dist/`)
- Start: `node dist/server.js` (stdio MCP transport)
- Dev: `npm run dev` (tsx watch-less runner)
- Docker build: `docker build -t blowsh-mcp:latest .`
- Docker run (MCP over stdio — MUST include `-i`): `docker run --rm -i blowsh-mcp:latest`
- Verify: build, `docker build`, then an MCP JSON-RPC smoke test over stdio (initialize → tools/list → tools/call)
- Lint: none configured; strict tsc is the gatekeeper

## Actionable Guardrails (Do's & Don'ts)

- **Don't** run the server directly on this machine for fetch tests — Firefox/Browsh/html2markdown are NOT installed locally.
  -> **Do** test through Docker: `docker run --rm -i blowsh-mcp:latest`.
- **Don't** use `firefox-esr` as a bare binary name for Browsh — it resolves `/usr/bin/firefox-esr` only.
  -> **Do** set `BROWSH_FIREFOX_PATH=/usr/bin/firefox-esr` in the Dockerfile (already done).
- **Don't** return error strings as successful tool results — tools must throw `FetchError` so MCP responds with `isError: true`.
  -> **Do** propagate `FetchError` (with HTTP status when known) and let `server.ts` format it.
- **Don't** bypass the SSRF guard (`assertSafeUrl`) when adding new fetch paths.
  -> **Do** call `assertSafeUrl(url)` before any URL reaches Browsh.
- **Don't** execute Git commands like `git add`, `git commit`, or `git push` autonomously or try to guess when to stage code.
  -> **Do** execute Git commands ONLY when explicitly instructed by an Orchestrator task block. Otherwise, rely on the `custom_context_stage_and_inject_diff` MCP tool.
  -> **Exception:** `git mv` is permitted autonomously for moving task files between Kanban directories (`backlog`, `in-progress`, `qa`, `completed`, `archive`).
- **Don't** read `context-reports/` markdown files yourself.
  -> **Do** generate them using the MCP server — context reports via `custom_context_read_source_files`, tree reports via `custom_context_create_tree_report` ("create a tree of the project") — and hand the file path to the Manager.
- **Don't** guess blindly when facing complex bugs, deadlocks, or silent timeouts.
  -> **Do** utilize the `debug-instrumentation` skill to inject strategic logs and trace the runtime execution path.
- **Don't** write bash scripts without strict mode or mask errors with `2>/dev/null` on data commands.
  -> **Do** follow the Defensive Shell Protocol: `set -euo pipefail`, ban error masking, sidecar isolation for Docker backups. See `docs/conventions.md`.
- **Don't** perform financial mutations without snapshotting the prior state or allow nulls in monetary aggregations.
  -> **Do** follow the Universal Financial Ledger Standard: snapshot-on-write, `$ifNull` precedence, discrepancy alerting, deep config merging. See `docs/conventions.md`.
- **Don't** carry over assumptions, partial results, or architectural hypotheses from a previous task.
  -> **Do** flush context and treat every task as contextually independent (Buffer Isolation directive in validation-phase).
- **Don't** execute raw, informal, or non-English (Farsi) prompts directly.
  -> **Do** load the `prompt-refactor` skill to translate and expand the intent into an elite English spec first. (Note: If you receive a standard XML task block, skip this and execute normally).
- **Don't** attempt to resolve cross-disciplinary ambiguity within a single persona.
  -> **Do** trigger the Multi-Agent Brainstorming Loop if the Manager explicitly requests brainstorming or a task exhibits cross-disciplinary ambiguity. Interpret the `<brainstorming_session>` results in backlog tasks as non-functional guidelines that govern execution.

## Documentation Sync Rules

When modifying this repository, you must keep these files synchronized:

1. Active task file in `tasks/` (single source of truth for current work items)
2. `CHANGELOG.md` (Keep a Changelog format)
3. `DESIGN.md` (MCP response/output design language, if modified)
4. `docs/conventions.md` (syntax rules, datetime standard, SOLID guidelines)
5. `docs/architecture.md` and `docs/data_model.md` (if structural patterns were altered)
6. Relevant `SKILL.md` files (if structural patterns were altered)

## 🛑 GATEKEEPER VALIDATION (HALT PROTOCOL)

You (OpenCode) are the final gatekeeper. Before executing any implementation task, you MUST evaluate the Orchestrator's instructions against this file and any referenced specs (`DESIGN.md`, `docs/architecture.md`, etc.). If the instructions violate project rules, ignore them. HALT immediately and output a `⚠️ RULE VIOLATION WARNING` back to the Manager explaining exactly what the Orchestrator got wrong, forcing it to self-correct.

## 🛑 CORE FILE LOCATIONS

You MUST strictly adhere to these exact paths. Do not create duplicates elsewhere:

- **Global Rules:** `AGENTS.md` (Root)
- **UI/UX Specs:** `DESIGN.md` (Root)
- **Agent Skills:** `.opencode/skills/<skill-name>/SKILL.md` (Local workspace)
- **Architecture:** `docs/architecture.md`
- **Data Model:** `docs/data_model.md`
- **Conventions:** `docs/conventions.md`
- **Active Tasks:** `tasks/backlog/<task-number>-<name>.md` (backlog), `tasks/in-progress/`, `tasks/qa/`, `tasks/completed/`, `tasks/archive/`

## 🛑 MANDATORY FIRST-READ RULE

Before any execution, you MUST read this `AGENTS.md` file first. Inside it, you are routed to read `DESIGN.md`, `docs/architecture.md`, `docs/data_model.md`, and `docs/conventions.md` before starting implementation work.

## 🛑 SKILL LOADING RULES

You MUST follow these skill loading rules in every session:

- **Task-Generator Skill:** Before creating any new task file, you MUST load the `task-generator` skill using the `skill` tool to ensure the correct template format with `<!-- BEGIN_GIT_DIFF -->` / `<!-- END_GIT_DIFF -->` markers.
- **Project Skills:** Before implementing any task, you MUST load every available skill matching the project's tech stack. This project uses TypeScript/Node — if a Node/TypeScript or MCP-related skill exists in the environment, load it; otherwise rely on this file, `docs/`, and the strict tsc build. For debugging, load `debug-instrumentation`; for docs, `doc-coauthoring`.

## 🛑 TASK MANAGEMENT & OPENCODE RULES

- **Decentralized Task Management:** Agents MUST strictly use decentralized, individual task files in the Kanban directories (`tasks/backlog`, `tasks/in-progress`, `tasks/qa`, `tasks/completed`, `tasks/archive`) as their single source of truth.
- **No Monolithic State:** Agents are strictly forbidden from creating `TODO.md` or `STATE.md`.
- **Zero-Autonomous-Commit:** Agents MUST be strictly forbidden from executing Git commands autonomously; they may only run Git commands when explicitly instructed by the Orchestrator. **Exception:** `git mv` is permitted for moving task files between Kanban directories (`backlog`, `in-progress`, `qa`, `completed`, `archive`).
- **Explicit Staging Contract (F5):** Verify that the active task's `Execution Log & Reasoning` or `summary_phase` passed a `modified_files` list to `stage_and_inject_diff` — blind `git add -A .` staging is banned because it sweeps parallel-session files into unrelated commits.
- **Buffer Isolation:** The shared validation phase MUST include a buffer-flush directive requiring Hands to treat every task as contextually independent, preventing cross-task context leakage.
- **MCP Report Generation:** Agents MUST generate context reports (`custom_context_read_source_files`) and tree reports (`custom_context_create_tree_report` — "create a tree of the project") via the MCP server and hand the file path to the Manager instead of reading `context-reports/` files inline.
- **UI/UX Enforcement:** Any UI/UX changes MUST enforce the guidelines defined in the project's `DESIGN.md`.
- **Complex Debugging:** Agents MUST be instructed not to guess blindly on complex bugs, but instead utilize the `debug-instrumentation` skill.
- **Bilingual Prompt Refactoring & Brainstorming Protocol:** Agents MUST be instructed not to execute raw, informal, or non-English prompts directly. The `prompt-refactor` skill must be loaded, or the Phase 1.5 Multi-Agent Brainstorming Protocol triggered, to translate and expand intent first. Standard XML task blocks are exempt.

## 🛑 CONTEXT BOOTSTRAPPING

At the start of every task, you MUST call `search_memory` or `list_namespaces` to load any hidden project quirks relevant to your domain before implementing.

## 🛑 MANDATORY END-OF-TASK SEQUENCE

When finishing a task, you MUST execute these exact steps in order:

1. **Update Changelog:** You MUST insert a formal entry into CHANGELOG.md logging your modifications.
2. **Write your Summary:** Manually write your architectural reasoning, local TODO checks, and execution notes into the active `tasks/XX-task.md` file under "OpenCode Execution Log" / "Execution Log & Reasoning".
3. **Call MCP Tool & QA Transition:** Call the `custom_context_stage_and_inject_diff` MCP tool passing the task file path and the full `modified_files` array. After injection, you MUST move the task file to `tasks/qa/` via `git mv tasks/in-progress/<file> tasks/qa/<file>` before notifying the Manager (implementation tasks only — discovery tasks stay in place). DO NOT execute any `git commit` commands. Closure to `tasks/completed/` happens ONLY after the Manager explicitly says "Approved for closure" or "Close task".
4. **Kanban Metadata Synchronization (mandatory after ANY authorized `git mv`):** After the move, update the task file's `**File:**` metadata header to the new `tasks/qa/<file>` path. If the move happened AFTER staging, re-run `lint_task_file` and call `custom_context_stage_and_inject_diff` AGAIN with the NEW task path and the full `modified_files` array before notifying the Manager — the re-stage keeps the injected diff and staging state in sync with the final path. Never notify the Manager with a stale `**File:**` header.
5. **Notify Manager:** Output exactly: "Task ready. Manager, please copy the contents of `tasks/XX-task.md` and send it back to the Orchestrator Brain for review."

## 🛑 LITE MODE PROTOCOL

- **Eligibility:** When a task is single-file, has no security/financial impact, and has obvious simplicity, the full 9-step production line can be bypassed.
- **Justification:** The Hands MUST log a `[LITE]` justification entry in the task's `## Manager Decisions` section using the format `**[YYYY-MM-DD] [LITE] [EXECUTION-DETECTED]:** <reason>`.
- **Escalation:** If hidden complexity is discovered mid-execution, escalation to Full Mode is mandatory — the Hands MUST halt Lite execution and switch to the complete workflow.
- **Guardrail:** Lite Mode is never allowed for multi-file changes, security-sensitive paths, or financial ledger operations.

## 🛑 DECISION LOGGING MANDATE

- Agents MUST log non-trivial architectural, design, and strategic decisions under `## Manager Decisions` in the active task file using the format `**[YYYY-MM-DD] [DECISION_ID] [SOURCE]:** <summary>` where `SOURCE` is `ORCHESTRATOR-DETECTED`, `EXECUTOR-DETECTED`, or `EXECUTION-DETECTED`, with rationale, alternatives considered, and impact.
- The Orchestrator is expected to pre-seed this section with `[ORCHESTRATOR-DETECTED]` entries during task generation when applicable.
- **Decision Detection Responsibility:** When the Manager talks directly to the Hands without going through the Orchestrator, the Hands MUST perform the decision-detection role: Detect the Manager's goals/decisions, Log them tagged `[EXECUTOR-DETECTED]`, Preserve pre-seeded `[ORCHESTRATOR-DETECTED]` entries, and ensure the log is Coach-Readable and chronologically ordered. See `agents/cognitive-executor.md` for the executor detection role.
- **AC/DoD Box-Checking at Implementation Time:** During the implementation `<summary_phase>`, the Hands MUST check every `## Acceptance Criteria` and `## Definition of Done` box that is genuinely satisfied by the recorded `## Verification Evidence` — do NOT defer box-checking to a closure task. See `prompts/fragments/09-hands_protocols.md` for the authoritative instruction.
- See `docs/conventions.md` `## Decision Logging Standard` for the canonical format. See `skill-templates/task-generator/SKILL.md` for the `[SOURCE]` tag template.

## 🛑 DEFENSIVE SHELL PROTOCOL (DSP)

- All bash scripts MUST start with `set -euo pipefail`.
- `2>/dev/null` is STRICTLY FORBIDDEN on data-generation, backup, archive, or database commands.
- Never use `command > file; if [ $? -eq 0 ]` — the shell creates the file before running the command, masking failures.
- For Docker volume backups, use sidecar isolation (`docker run --rm -v volume:/data:ro alpine tar...`) with read-only mounts.

## 🛑 UNIVERSAL FINANCIAL LEDGER STANDARD

- Whenever a financial amount, inventory count, or balance is mutated, persist a read-only snapshot of the preceding state in the same transaction (snapshot-on-write).
- All aggregation queries on monetary fields MUST use explicit null-handling (`COALESCE`, `ISNULL`, `$ifNull`). Banned: passing nullable columns into mathematical operators.
- If a computed total diverges from its line-item sum by more than 0.01, emit a high-severity alert and prevent finalization.
- Financial configuration updates MUST deeply merge nested properties. Banned: shallow object spread on financial config objects.

