# Conventions

This document defines syntax rules, naming conventions, file boundaries, and automation patterns for this project.

## Universal DateTime Standard

All projects in this ecosystem MUST follow these datetime rules:

1. **UTC at Rest** — All databases and caches store datetimes in UTC with `TIMESTAMP WITH TIME ZONE`. Banned: naive or local-time storage.
2. **ISO-8601 with Offset / Epoch ms at API Boundaries** — APIs transmit datetimes as Unix Epoch milliseconds (int64) or ISO-8601 with offset (e.g., `2026-07-23T14:30:00+00:00`). Banned: timezone-naive strings.
3. **Clock Injection** — All current-time access must go through an injectable `Clock` abstraction. Banned: direct `new Date()`, `datetime.now()`, `time.Now()` in business logic.
4. **Dual-Representation for Future Events** — Calendar events expose both `event_start_local` (with timezone) and `event_start_epoch_ms` (absolute).
5. **`TZ=UTC` Infrastructure** — All environments run with `TZ=UTC`. Timezone display is a client-layer responsibility only.

## SOLID Programming Guidelines

Enforce these SOLID principles and pragmatic guardrails in every implementation:

1. **SRP** — One reason to change per module. Split merged concerns.
2. **OCP** — Open for extension, closed for modification. Use composition over inheritance.
3. **LSP** — Subtypes must be substitutable. Ban `NotImplementedError` overrides.
4. **ISP** — Small role-specific interfaces. Ban monolithic god-interfaces.
5. **DIP** — Depend on abstractions, not concretions. Core layer must not import adapters.

**Pragmatic Guardrails:** No abstraction for <3 trivial operations. Only extract interfaces with 2+ implementations. Apply YAGNI strictly. Prefer simpler designs unless a measurable requirement forces complexity.

## Software Conventions (blowsh-mcp specific)

- **ESM only**: `"type": "module"`, NodeNext resolution, relative imports always carry `.js` suffix (compiled output must resolve).
- **Strict TS**: `strict: true`; tsc is the only gatekeeper (no linter). No `any` unless the SDK type requires it; `unknown` for unmarshalled data.
- **Runtime deps**: Prefer zero-dependency utilities; external process calls (html2markdown, browsh, firefox) go through thin wrappers in `src/` managers.
- **Config via env**: Single source of truth `.env.example`; new config knobs must be documented there and in `README.md`.
- **Errors**: Every tool failure must surface as `FetchError` (thrown), with optional HTTP status; never return error strings as successful results in UI/client contracts.