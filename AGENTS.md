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
- **Don't** execute Git commands like `git add`, `git commit`, or `git mv` autonomously or try to guess when to stage code.
  -> **Do** execute Git commands ONLY when explicitly instructed by an Orchestrator task block. Otherwise, rely on the `custom_context_stage_and_inject_diff` MCP tool.
- **Don't** guess blindly when facing complex bugs, deadlocks, or silent timeouts.
  -> **Do** utilize the `debug-instrumentation` skill to inject strategic logs and trace the runtime execution path.
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

## 🛑 CONTEXT BOOTSTRAPPING

At the start of every task, you MUST call `search_memory` or `list_namespaces` to load any hidden project quirks relevant to your domain before implementing.

## 🛑 MANDATORY END-OF-TASK SEQUENCE

When finishing a task, you MUST execute these exact steps in order:

1. **Update Changelog:** You MUST insert a formal entry into CHANGELOG.md logging your modifications.
2. **Write your Summary:** Manually write your architectural reasoning, local TODO checks, and execution notes into the active `tasks/XX-task.md` file under "OpenCode Execution Log".
3. **Call MCP Tool:** Call the `custom_context_stage_and_inject_diff` MCP tool passing the task file path to automatically stage the files and inject the factual code diff. DO NOT execute any `git commit` commands afterward.
4. **Notify Manager:** Output exactly: "Task ready. Manager, please copy the contents of `tasks/XX-task.md` and send it back to the Orchestrator Brain for review."
