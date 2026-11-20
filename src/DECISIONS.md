# src — Decisions

Chronological Architectural Decision Records for the server-side modules. Newest last. Each entry: Context, Decision, Consequences, Rollback.

Sibling of `src/README.md`. Tool-level records live in `src/tools/DECISIONS.md`.

## 2026-11-13 — The render queue is bounded and abortable

**Context.** Every render is serialized through one FIFO slot, and the per-render axios timeout started only *after* the slot was granted. A queued render therefore had no bound at all: a parallel search could wait behind other renders indefinitely, and the caller saw a hang rather than an error.

**Decision.** Extract the mutex into an exported `RenderQueue` class. `acquire(signal)` returns `{ granted: true }` or `{ granted: false, reason }` where reason is `aborted` or `queue-timeout`. A waiter that gives up stays in the queue marked `aborted`, and `release()` skips it, so the slot is never handed to an already-settled promise. When acquisition fails, `fetchRaw` returns before taking the mutex, so nothing is released that was never held.

**Consequences.** The wait contract is provable without a browser, which is why the class is exported and covered by `tests/search-timeout-hardening-tests.ts`. `BrowshManager` now delegates to `queue.isBusy` / `queue.pending`, so recycle and idle-kill decisions read the same accounting the waiters use.

**Rollback.** Restore the previous `acquire()`/`release()` pair on `BrowshManager` and delete the `RenderQueue` export. The two call sites (`fetchRaw`, `scheduleRecycle`) are the only consumers.

## 2026-11-13 — The queue timer must stay referenced

**Context.** The first implementation of the queue budget called `.unref()` on the timeout handle, reasoning that a queued wait should not keep a finished process alive. The effect was the opposite of the intent: with nothing else holding the event loop, the timer never fired, so the queue-timeout branch was unreachable and a queued render would hang forever — the exact bug being fixed.

**Decision.** The queue timer is deliberately NOT `unref()`ed. A queued wait must still fire its timeout even when nothing else holds the loop, or the queue budget is a no-op. The render request itself holds the loop while in flight, so keeping the handle referenced costs nothing.

**Consequences.** A short-lived process that queues a render now stays alive until the budget expires and then fails honestly, instead of exiting silently. Caught by the `queue budget expiry` case in `tests/search-timeout-hardening-tests.ts`, which exits non-zero with an unsettled top-level await when the timer does not fire.

**Rollback.** Not applicable — re-adding `.unref()` reintroduces the hang. Do not "clean this up".

## 2026-11-13 — The four timeout budgets are one ladder

**Context.** The per-render timeout, queue wait, search budget, and enrichment budget were edited as four independent knobs. At one point the search budget (180 s) was shorter than the queue wait it contained (240 s), so the budget expired before the queue bound could ever matter, and 180 s funded only two of the up-to-six renders one query needs. Raising the render timeout alone makes this strictly worse, because fewer renders fit in a fixed budget.

**Decision.** Treat them as one ladder and assert the invariant rather than four numbers: `SEARCH_DEADLINE_MS ≥ BROWSH_QUEUE_TIMEOUT_MS + BROWSH_REQUEST_TIMEOUT_MS`, and the queue funds at least two renders (`queue ≥ 2 × render`). Defaults are exported constants (`DEFAULT_RENDER_TIMEOUT_MS`, `DEFAULT_QUEUE_TIMEOUT_MS`, `DEFAULT_STARTUP_TIMEOUT_MS`, `ENRICH_BUDGET_MS`) so the test reads what the code uses. The invariant lives in the `timeout ladder` group of `tests/search-timeout-hardening-tests.ts`.

**Consequences.** A future edit that raises one knob alone fails the suite with the actual arithmetic printed, instead of silently producing false timeouts in production. Verified by running the suite with `SEARCH_DEADLINE_MS=300000`: it reports `search budget (300000) covers queue + render (780000): FAIL — 300000 < 780000` and exits 1.

**Rollback.** Restore the previous numbers; the assertion reads the constants, so it follows automatically.

## 2026-11-11 — Session health is enforced through the same mutex as fetches

**Context.** Long sessions accumulate tabs in the persistent Firefox process, and a recycle issued mid-request would tear the browser down underneath an in-flight render.

**Decision.** Recycle-after-N-requests and idle-kill are decided only in quiescent windows, re-checked immediately before acting, and deferred via `setImmediate` while the slot is busy or waiters remain. Teardown targets the whole process group (`detached: true` at spawn plus negative-PID `SIGTERM`, escalating to `SIGKILL`) so an orphaned Firefox child can never hold the profile lock and block the next restart. One transparent transport retry covers a request that races a recycle.

**Consequences.** A recycle can never interrupt a live render, and a restart can never fight a stale profile lock. The cost is that a recycle may be deferred rather than immediate.

**Rollback.** The deferral and group-teardown are one block in `scheduleRecycle` / `clearProcess`; reverting to a plain `proc.kill()` reintroduces orphaned Firefox processes.

## 2026-11-11 — Persistent profile via a redirected HOME

**Context.** Browsh 1.8.0 exposes no profile-directory flag, but the server needs cookies, history, and storage to survive restarts.

**Decision.** Redirect the Browsh child's `HOME` to `BROWSH_PROFILE_DIR` so everything Firefox persists lands under one directory that a named volume or bind-mount can back. The directory is created with `mkdirSync(..., { recursive: true })` before spawn, and an existing directory is reused rather than wiped.

**Consequences.** Profile persistence is a deployment concern (mount the volume), not a code path. A suspect profile can be quarantined aside by `quarantineProfileDir` when a boot-path failure looks like a corrupt profile.

**Rollback.** Unset `BROWSH_PROFILE_DIR` to fall back to the default path; the redirect is the only mechanism.

## 2026-11-11 — The SSRF guard resolves DNS before every request

**Context.** A URL that resolves to a private or loopback address must never reach the network, but a hostname-level string check is trivially bypassed by a name that points at `127.0.0.1`.

**Decision.** `assertSafeUrl` resolves the hostname with `dns.lookup(host, { all: true })` and rejects loopback, private (10/8, 172.16/12, 192.168/16), link-local (169.254/16), reserved, IPv4-mapped IPv6, and `localhost` at the *address* level. `ALLOW_PRIVATE_URLS=true` is the single documented kill-switch.

**Consequences.** Every outbound URL pays one DNS resolution, and a hostname that resolves to a blocked address fails before any connection. The guard is a domain-level check, not a network-namespace guarantee.

**Rollback.** Set `ALLOW_PRIVATE_URLS=true` to disable, or remove the `assertSafeUrl` call at a specific fetch path — never both.

## 2026-11-11 — The render cache is in-memory and TTL-only

**Context.** The server is stateless by default and must not require a datastore, but repeated calls for the same page should not re-render.

**Decision.** `pageCache` is a `TtlCache` (default 5 min, `CACHE_TTL_MS`) keyed by URL plus the settle-relevant options. Truncation (`max_chars`) is applied at read time, never stored. Only content a guard already accepted is cached.

**Consequences.** No persistence, no cross-process sharing, and a restart clears the cache. That is the intended trade for a single-container MCP server.

**Rollback.** Set `CACHE_TTL_MS` low, or bypass the cache at a call site; the cache is the only consumer of `TtlCache` for pages.

## 2026-11-17 — A crash storm is contained by a circuit, not by longer budgets

**Context.** The singleton exhausted caller deadlines under parallel load. Logs showed 9 Browsh Go interfacer panics and 35 respawns in 2 days, with 58 aborted queue waits and sustained 312% CPU. `isRunning` relied on `ChildProcess.killed`, which stays false when a child exits by itself, so a crashed browser still looked alive until a request hit `ECONNREFUSED`. Recovery then paid up to `BROWSH_STARTUP_TIMEOUT_MS` (120 s) per crash while every queued caller waited.

**Decision.** Three separate changes, none of which touch the four-budget ladder:

1. Observe the child's `exit` and `error` events. An unexpected exit clears `this.process`, resets the boot prewarm, and records a crash. `clearProcess()` nulls `this.process` before any intentional kill, so recycle, idle-kill, and shutdown are structurally excluded from the crash count. `isRunning` also checks `exitCode`/`signalCode` for the race before the event fires.
2. Add the exported, timer-free `CrashCircuit`: three unexpected exits in 60 s open a 30 s window in which `ensureStarted` and `fetchRaw` fail fast before queueing. The burst history clears on open, so recovery is automatic when the cooldown elapses. Thresholds are env-tunable (`BROWSH_CRASH_WINDOW_MS`, `BROWSH_CRASH_THRESHOLD`, `BROWSH_CRASH_COOLDOWN_MS`).
3. After a storm, quarantine the persisted Firefox profile via the existing allowlisted `quarantineProfileDir` before the next spawn, so a corrupted profile is not retried indefinitely. The backup is renamed, never deleted.

**Alternatives rejected.** (a) Lowering `SEARCH_DEADLINE_MS` / `BROWSH_REQUEST_TIMEOUT_MS` / `BROWSH_QUEUE_TIMEOUT_MS` — rejected, it contradicts the 2026-11-13 ladder ADR, reintroduces false timeouts on slow hosts, and does not stop the respawn storm. (b) Patching Browsh's Go segfault — the binary is external to this repo. (c) Restarting the container only — it clears the symptom but leaves the crash loop able to recur.

**Consequences.** A healthy host keeps the full 900 s chain budget. A crashing browser now fails honestly within the cooldown instead of consuming the queue budget. The profile directory accumulates `.corrupt-<ts>` backups after storms, which are recoverable but should be cleaned by an operator.

**Rollback.** Remove the `exit`/`error` listeners and the two circuit guards, restore the old `isRunning` body, and keep the profile quarantine call dormant. The env knobs are additive; removing their use restores prior behaviour with no default change.

## 2026-11-17 — Quarantine arms on a windowed storm, not a lifetime count

**Context.** QA rejected the first pass: `ensureStarted` compared the lifetime `totalCrashes` counter against `DEFAULT_CRASH_THRESHOLD`. Three crashes spaced across weeks would still move the profile, and the configured `BROWSH_CRASH_THRESHOLD` knob was ignored for the quarantine decision.

**Decision.** Add `stormPending`, set only when `CrashCircuit.record` opens the circuit (i.e. the configured number of crashes lands inside the configured window). `ensureStarted` quarantines on `stormPending`, then clears it and the lifetime counter. `totalCrashes` stays as an observability log field only. `CrashCircuit.reset` is documented as a test seam; the production start path never calls it while the circuit is open, because that would defeat the cooldown. The circuit guard still runs after the quarantine block, so new renders fail fast during cooldown.

**Consequences.** Spaced crashes never trigger a profile move. A real storm triggers exactly one move. Recovery remains automatic when the cooldown elapses.

**Rollback.** Restore the `totalCrashes >= DEFAULT_CRASH_THRESHOLD` check in `ensureStarted` and remove the `stormPending` assignment in the exit listener.

## 2026-11-18 — Env-driven proxy for browser and axios egress

**Context.** Operators running the MCP server in Docker had no way to use an upstream proxy. Firefox ignores `HTTP_PROXY` from the environment (Playwright #6094), Browsh v1.8.0 has no proxy flag, and its Viper loader has no `AutomaticEnv`, so `firefox.preferences` cannot be set from an environment variable. The Browsh profile lives on a persistent `/data/browsh-profile` volume (`Dockerfile:61`), so a config baked into the image can be shadowed by stale state. axios already honors proxy environment variables through `proxy-from-env`, but that library proxies `127.0.0.1` when `NO_PROXY` is unset, which would break the `127.0.0.1:4333` control channel.

**Decision.** Introduce six `PROXY_*` variables (`PROXY_TYPE`, `PROXY_HOST`, `PROXY_PORT`, `PROXY_USERNAME`, `PROXY_PASSWORD`, `PROXY_BYPASS`) resolved once in `src/server.ts` and again before each Browsh spawn. `applyProxyEnv` seeds axios environment variables without changing any of the ~17 axios callsites, preserves explicit operator values, and always merges `localhost,127.0.0.1` into `NO_PROXY`. `ensureFirefoxProxyPrefs` writes `<profileDir>/.config/browsh/firefox_profile/user.js` on every boot with `network.proxy.*` preferences for `http` or `socks5`; when no proxy is configured it writes only `network.proxy.type=0`. Credentials are URL-encoded for axios and JSON-escaped for Firefox and are never logged. The SSRF guard, render queue, and timeout ladder are untouched.

**Alternatives rejected.** (a) Relying only on `HTTP_PROXY` — Firefox does not consume it, so browser renders would stay direct. (b) Baking a Browsh `config.toml` into the image — the `/data/browsh-profile` volume can shadow it and Browsh has no env binding for `firefox.preferences`. (c) Adding a proxy agent at every axios callsite — 17 edits with no benefit over environment seeding. (d) Running a transparent container-level proxy — outside this repository's control and invisible to the operator's `.env`.

**Consequences.** One `.env` contract covers both egress paths without an image rebuild. Direct mode is deterministic across profile reuse. SOCKS5 selects `socks5h` for axios so DNS resolves remotely; operators whose Node-side HTTP client cannot handle a SOCKS URL should use `PROXY_TYPE=http` for axios while keeping a SOCKS proxy in front of Firefox. Firefox builds that prompt for proxy credentials in headless mode need an IP-allowlisted proxy for browser renders.

**Rollback.** Remove the six variables and `src/proxyConfig.ts`, revert the two call sites, and delete the generated `user.js`. `prefs.js` on an existing profile may retain proxy values until the profile volume is reset.

## 2026-11-20 — The startup health probe gets its own budget

**Context.** A deployment behind an upstream proxy reported `FetchError: Browsh did not start in HTTP mode within timeout` on every render. Direct live measurement showed Browsh's control endpoint answering HTTP 200 within 0.9-2 s, well inside the 120 s startup budget. The cause was `waitForReady`'s hardcoded 800 ms axios timeout: it is shorter than one render of Browsh's welcome page, so every probe failed before the endpoint could answer. Two related flaws made the symptom worse: the startup budget was raised from 120 s to 300 s with no effect, and `ensureStarted` quarantined the Firefox profile on any boot-path error, including this pure timeout, so a healthy profile could be discarded and a second full budget paid for nothing.

**Decision.** Add `DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 5000` and expose `BROWSH_HEALTH_PROBE_TIMEOUT_MS` (clamped 1000-60000) through `resolveRenderTimeouts`, alongside the existing render, queue, and startup budgets. `waitForReady` uses that value per probe; the outer `BROWSH_STARTUP_TIMEOUT_MS` loop still bounds total startup time. In `ensureStarted`, a `FetchError` whose message is the startup-timeout text is rethrown unchanged, without profile quarantine. Profile quarantine stays reserved for path and lock failures.

**Alternatives rejected.** (a) Raising `BROWSH_STARTUP_TIMEOUT_MS` — already tried at 300 s; the per-probe timeout is independent, so it cannot help. (b) Removing the upstream proxy — the slow probe reproduces with proxying off, so the proxy is not the root cause. (c) Replacing `/` with a lightweight Browsh health route — Browsh 1.8.0 exposes no such route. (d) Removing the profile quarantine entirely — it is the correct response to a genuine corrupt-profile storm (2026-11-14 ADR).

**Consequences.** A slow-but-healthy browser is now detected in one probe instead of failing after the whole startup budget. Worst-case failure detection inside startup rises from 800 ms to 5 s per probe, still bounded by the startup loop. Operators on unusually slow hosts can raise the knob without touching the render ladder.

**Rollback.** Restore the literal `800` in `waitForReady`, remove the `probe` field and env knob, and delete the timeout guard in `ensureStarted`. No data migration.
