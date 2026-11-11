# Conventions

This document defines syntax rules, naming conventions, file boundaries, and automation patterns for this project.

## Universal DateTime Standard

All projects in this ecosystem MUST follow these datetime rules:

1. **UTC at Rest** — All databases and caches store datetimes in UTC with `TIMESTAMP WITH TIME ZONE`. Banned: naive or local-time storage.
2. **ISO-8601 with Offset / Epoch ms at API Boundaries** — APIs transmit datetimes as Unix Epoch milliseconds (int64) or ISO-8601 with offset (e.g., `2026-07-23T14:30:00+00:00`). Banned: timezone-naive strings.
3. **Clock Injection** — All current-time access must go through an injectable `Clock` abstraction. Banned: direct `new Date()`, `datetime.now()`, `time.Now()` in business logic.
4. **Dual-Representation for Future Events** — Calendar events expose both `event_start_local` (with timezone) and `event_start_epoch_ms` (absolute).
5. **`TZ=UTC` Infrastructure** — All environments run with `TZ=UTC`. Timezone display is a client-layer responsibility only.

6. **Scope exemption (blowsh-mcp):** this server holds no persistent datetimes — only in-memory TTL expiry (`src/cache.ts`), elapsed-time/deadline measurements (`fetchWeb.ts`, `crawlWeb.ts`, `searchWeb.ts`), and `fetched_at` epoch-ms stamps on outbound results. For these, direct `Date.now()` is permitted; the Clock-injection ban applies if durable timestamps or test-sensitive scheduling logic are ever introduced.

## SOLID Programming Guidelines

Enforce these SOLID principles and pragmatic guardrails in every implementation:

1. **SRP** — One reason to change per module. Split merged concerns.
2. **OCP** — Open for extension, closed for modification. Use composition over inheritance.
3. **LSP** — Subtypes must be substitutable. Ban `NotImplementedError` overrides.
4. **ISP** — Small role-specific interfaces. Ban monolithic god-interfaces.
5. **DIP** — Depend on abstractions, not concretions. Core layer must not import adapters.

**Pragmatic Guardrails:** No abstraction for <3 trivial operations. Only extract interfaces with 2+ implementations. Apply YAGNI strictly. Prefer simpler designs unless a measurable requirement forces complexity.

## Universal Financial Ledger Standard

All financial, transactional, and countable data operations MUST enforce these mandates:

1. **Snapshot-on-Write for Mutable Totals:** Whenever a financial amount, inventory count, or balance is mutated, persist a read-only snapshot of the preceding state in the same transaction (sidecar table, audit log, or WAL). Banned: mutating without preserving the prior value.
2. **Mandatory `$ifNull` Precedence:** All aggregation queries on monetary fields MUST use explicit null-handling (`COALESCE`, `ISNULL`, `$ifNull`). Banned: passing nullable columns into mathematical operators.
3. **Observability Alerting on Discrepancies:** If a computed total diverges from its line-item sum by more than 0.01, emit a high-severity alert and prevent finalization.
4. **Deep Config Merging for Financial Settings:** Financial configuration updates MUST deeply merge nested properties. Banned: shallow object spread on financial config objects.

## Defensive Shell Protocol (DSP)

When writing or reviewing bash scripts, cron jobs, or container orchestration commands:

1. **Mandatory Strict Mode:** All scripts MUST start with `set -euo pipefail`.
2. **Banned Error Masking:** `2>/dev/null` is STRICTLY FORBIDDEN on data-generation, backup, archive, or database commands.
3. **No Post-Redirect Status Checks:** Never use `command > file; if [ $? -eq 0 ]` — the shell creates the file before running the command, masking failures.
4. **Sidecar Isolation for Hostless Backups:** Never rely on host file staging for Docker volume backups. Always use ephemeral containers (`docker run --rm -v volume:/data:ro alpine tar...`) with read-only mounts.

## Task-Number Reference Discipline

Task numbers are provenance for humans, not reasoning material for the model. A bare task number in visible prompt prose invites hallucination: the model treats it as load-bearing context it cannot resolve.

1. **Allowed Homes (only):** code comments (`#`, `//`), `CHANGELOG.md` entries, task files, history archives, and HTML-comment markers (`<!-- -->`).
2. **Forbidden Homes:** visible prose in prompt fragments, agent instruction files, skill instructions, registry lines, section headings, and any Markdown the Brain or Hands reads as operating instructions.
3. **Authoring Rule:** when writing or editing prompt-facing Markdown, strip task-number parentheticals. Record provenance in the task file and CHANGELOG instead — never in the prompt text itself.

## Decision Logging Standard

All non-trivial architectural, design, and strategic decisions MUST be logged under `## Decision Log` in the active task file using the format:

```
**[YYYY-MM-DD] [DECISION_ID] [SOURCE]:** <summary>
- **Rationale:** <why>
- **Alternatives considered:** <what else>
- **Impact:** <consequence>
```

Where `SOURCE` is one of:

- `ORCHESTRATOR-DETECTED` — pre-seeded by the Orchestrator during task generation
- `EXECUTOR-DETECTED` — detected and logged by the Hands during direct Manager conversation
- `EXECUTION-DETECTED` — technical necessity discovered during implementation

Rules:

- Sequential `DECISION_ID` per task (D1, D2, ... or 001, 002)
- Chronologically ordered, coach-readable
- Preserve `[ORCHESTRATOR-DETECTED]` entries unmodified — append only

See `prompts/fragments/17-decision_logging_mandate.md` for Decision Detection Responsibility and `agents/cognitive-executor.md` for executor role. See the `kanban-lifecycle` skill for the `[SOURCE]` tag template.

## Edit Tool Discipline

File edits use ONLY native file-editing tools (edit for replacements, file-write tools for new files). Using python, shell, heredoc, `sed -i`, or any script to create or modify files is strictly forbidden — scripted edits fail silently (replace-all on non-unique anchors, quoting and encoding mangling) while native tools fail loudly on a non-unique anchor.

1. **Default native only:** one replacement, one location, exact unique anchor. A no-match or multi-match error is a signal, never a retry hint.
2. **No scripted edits:** python, shell, heredoc, and `sed -i` are banned for creating or modifying files. Shell stays read-only for file content (e.g. `grep`, `cat`, `diff`, `ls`, `git status`).
3. **Verify always:** `grep`/`diff` after every edit.

## Living Folder Docs Standard

All vertical slices and component directories in this repository MUST maintain colocated documentation and decision records:

1. **Folder Colocation** — Every domain component or vertical slice directory (e.g. `src/tools/`) must contain:
   - `README.md` — Explains the component's core duties, directory layout, owned files, and critical invariants/risks.
   - `DECISIONS.md` — Chronological log of dated Architectural Decision Records (ADRs). Each entry documents Context, Decision, Consequences, and Rollback strategy.
2. **One-Line Code Pointer Standard** — Primary source files within the component directory must include a top-line comment pointing directly to the sibling docs:
   - JavaScript/TypeScript: `// Sibling Docs: <relative-path>/README.md | Decisions: <relative-path>/DECISIONS.md`
   - Python/Shell: `# Sibling Docs: <relative-path>/README.md | Decisions: <relative-path>/DECISIONS.md`
3. **Synchronization Invariant** — Whenever source code inside a component directory is added, refactored, or altered in behavior or data contract, the sibling `README.md` and `DECISIONS.md` MUST be inspected and updated within the same task. Silent overrides of existing architectural decisions are strictly forbidden.

## Software Conventions (blowsh-mcp specific)

- **ESM only**: `"type": "module"`, NodeNext resolution, relative imports always carry `.js` suffix (compiled output must resolve).
- **Strict TS**: `strict: true`; tsc is the only gatekeeper (no linter). No `any` unless the SDK type requires it; `unknown` for unmarshalled data.
- **Runtime deps**: Prefer zero-dependency utilities; external process calls (html2markdown, browsh, firefox) go through thin wrappers in `src/` managers.
- **Config via env**: Single source of truth `.env.example`; new config knobs must be documented there and in `README.md`.
- **Errors**: Every tool failure must surface as `FetchError` (thrown), with optional HTTP status; never return error strings as successful results in UI/client contracts.
