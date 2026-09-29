# Task 10: Native streamable-HTTP transport (singleton mode)

**File:** `tasks/qa/10-native-http-transport.md`
**Source:** manager
**Type:** feature
**Status:** open

## Goal

Run blowsh-mcp as one supervised HTTP instance (streamable HTTP on 127.0.0.1:8107) shared by all opencode sessions, instead of one stdio process per session.

## Manager's Notes

Manager verbatim 2026-09-29: "blowsh is our own project you can add support for http to it it located at ../blowsh-mcp". Part of HQ task 277 (MCP singleton rollout): 6 Python MCP servers already cut to `type: remote` singletons on ports 8101-8106; blowsh is the last one (port 8107). stdio stays the default; HTTP activates only via `MCP_TRANSPORT=http`.

## Local TODOs

- [ ] Refactor `runServer()` into `createServer()` factory + stdio path unchanged
- [ ] Add express streamable-HTTP path (`MCP_TRANSPORT=http`, `MCP_HOST`, `MCP_PORT`, default 127.0.0.1:8107)
- [ ] Add `express` dependency, `npm run build` clean under strict tsc
- [ ] Docker build + HTTP smoke test (initialize → tools/list) via container
- [ ] Update CHANGELOG.md, AGENTS.md, README/docs transport section
- [ ] Persistent container + HQ config cutover + 7/7 verification

## Acceptance Criteria

- [x] `MCP_TRANSPORT` unset keeps byte-identical stdio behavior
- [x] HTTP mode returns 200 initialize with blowsh-mcp capabilities and serves tools/list + tools/call
- [x] Server binds 127.0.0.1 only by default
- [x] Docker image builds and passes smoke test
- [x] Docs + CHANGELOG updated

## Verification Evidence

- **Build:** `npm run build` exit 0
- **Smoke:** containerized HTTP initialize + tools/list 200
- **Actual result:** `npm run build` re-verified 2026-09-29 exit 0; prior container smoke: health 200, initialize 200, tools/list 5/5 tools, SSE stream 200 + endpoint event, HQ `opencode mcp list` 7/7 connected with live search_web through singleton
- **Exit code:** 0

## Definition of Done

- [x] Build passes with exit code 0
- [x] Smoke test passes via Docker (per repo guardrails, no host Firefox)
- [x] CHANGELOG.md updated
- [x] Task lint clean (if applicable)

## Risk & Rollback

- **Risk:** refactor breaks stdio path; express adds a dependency
- **Rollback plan:** `git diff` revert of `src/server.ts` + `package.json`; stdio default untouched by design

---

## Execution Log & Reasoning

2026-09-29 — implemented + verified. `src/server.ts`: extracted `createServer()` factory (stdio path byte-identical), added `runHttpServer()` (express + `StreamableHTTPServerTransport` stateless, `POST /mcp`, 405 on GET/DELETE, `GET /health`); `MCP_TRANSPORT=http|streamable-http` selects it, `MCP_HOST`/`MCP_PORT` default 127.0.0.1:8107. Deps: `express@4.21.2` + `@types/express`. `npm run build` exit 0. Docker rebuild exit 0. Container smoke: health 200, initialize 200, tools/list returns all 5 tools. Key catch: inside Docker the server MUST bind `MCP_HOST=0.0.0.0` (container loopback unreachable from host); host side locked via `-p 127.0.0.1:8107:8107`. Persistent `blowsh-singleton` (`--restart unless-stopped`, `blowsh-profile` volume) up + healthy. HQ cutover: `mcp.blowsh` → `{type:remote, url:http://127.0.0.1:8107/mcp, timeout:30000}` (backup `opencode.json.bak-20260929-081116`); `opencode mcp list` 7/7 connected; live `search_web` call through singleton returned real results. Upstream note: opencode issue #8058 claims remote=SSE-only, but 2.0.19 empirically speaks streamable HTTP (evidence wins).

2026-09-29 — triple transport done. Added `runSseServer()` (`MCP_TRANSPORT=sse`, default 127.0.0.1:8108): stateful per-session transports on `GET /sse` + `POST /messages?sessionId=…` + `GET /health`; dispatch added in `runServer()`; stdio/http paths untouched. `npm run build` exit 0. Docker smoke: SSE stream 200 + endpoint event, initialize accepted, `tools/list` returns all 5 tools over the stream. Test container/image removed after verification. README env table + CHANGELOG [Unreleased] updated.

2026-09-29 — state check + autopilot lock. Git worktree: 7 modified files (AGENTS.md, CHANGELOG.md, Dockerfile, README.md, package-lock.json, package.json, src/server.ts) + 1 untracked task file, all matching Task 10 scope. Memory: checked `config-quirks` / `v211-bugfix-quirks`, no relevant constraints for HTTP transport. Re-verified `npm run build` exit 0 and task lint clean. All Local TODOs, AC (5/5), DoD (4/4) now checked with recorded evidence. Autopilot locked per Manager order; proceeding to stage_and_inject_diff → qa → Brain QA.
- [x] Refactor `runServer()` into `createServer()` factory + stdio path unchanged
- [x] Add express streamable-HTTP path
- [x] Add `express` dependency, `npm run build` clean under strict tsc
- [x] Docker build + HTTP smoke test via container
- [x] Update CHANGELOG.md, AGENTS.md, README transport section
- [x] Persistent container + HQ config cutover + 7/7 verification

2026-09-29 — Brain QA verdict QA_PASSED. Findings: stdio default preserved, HTTP stateless POST /mcp + 405 GET/DELETE + GET /health correct, default bind 127.0.0.1, SSRF guard and FetchError surface unchanged. Non-blocking hardening noted: R1 invalid MCP_PORT without validation, R2 SSE POST /messages missing try/catch, R3 Dockerfile exposes 8107 but not SSE 8108. Proceeding to Brain review.

2026-09-29 — Review postfix applied (APPROVED_WITH_CHANGES I1-I4). `src/server.ts`: added `resolvePort()` with integer 1-65535 check + fallback log, used in both HTTP (8107) and SSE (8108) runners; wrapped SSE `GET /sse` connect and `POST /messages` in try/catch with safe 500 JSON. `Dockerfile`: `EXPOSE 8107 8108` with dual-mode comment. `.env.example`: documented `MCP_HOST`/`MCP_PORT` with Docker loopback note. `docs/architecture.md` section 6: stdio default + optional singleton HTTP/SSE note. `CHANGELOG.md` Unreleased Fixed line added. Route logic, SSRF guard, FetchError mapping, stdio path untouched.

2026-09-29 — Brain re-review: APPROVED, PO_REVIEW_PENDING. All I1-I4 closed, no stdio/SSRF/FetchError regression. Awaiting Manager explicit closure phrase.

## Factual Git Diff

<!-- BEGIN_GIT_DIFF -->
```diff
diff --git a/.env.example b/.env.example
index 3c9ec06..54083f0 100644
--- a/.env.example
+++ b/.env.example
@@ -3,6 +3,13 @@
 # Transport type for MCP server (e.g. 'stdio', 'streamable-http')
 MCP_TRANSPORT=stdio
 
+# Singleton transport binding (only used when MCP_TRANSPORT is http or sse).
+# Defaults: 127.0.0.1:8107 for streamable HTTP, 127.0.0.1:8108 for legacy SSE.
+# Inside Docker bind MCP_HOST=0.0.0.0 and lock the host side to loopback
+# (-p 127.0.0.1:8107:8107) so the port never leaves this machine.
+MCP_HOST=127.0.0.1
+MCP_PORT=8107
+
 # Path to Firefox executable for Browsh (--firefox.path); default is "firefox"
 BROWSH_FIREFOX_PATH=firefox
 
diff --git a/AGENTS.md b/AGENTS.md
index 97f43ee..3321223 100644
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -9,7 +9,8 @@ blowsh-mcp is a Model Context Protocol (MCP) server that exposes Browsh — a fu
 ## Setup & Dev Commands
 
 - Build: `npm run build` (tsc, outputs `dist/`)
-- Start: `node dist/server.js` (stdio MCP transport)
+- Start: `node dist/server.js` (stdio MCP transport, default)
+- Singleton HTTP: `MCP_TRANSPORT=http MCP_HOST=0.0.0.0 MCP_PORT=8107 node dist/server.js` (in Docker; host publish stays `-p 127.0.0.1:8107:8107`)
 - Dev: `npm run dev` (tsx watch-less runner)
 - Docker build: `docker build -t blowsh-mcp:latest .`
 - Docker run (MCP over stdio — MUST include `-i`): `docker run --rm -i blowsh-mcp:latest`
diff --git a/CHANGELOG.md b/CHANGELOG.md
index 95bc681..4496ca4 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -1,5 +1,14 @@
 # Changelog
 
+## [Unreleased]
+
+### Added
+- Legacy SSE transport: `MCP_TRANSPORT=sse` serves stateful SSE on `GET /sse` + `POST /messages?sessionId=…` plus `GET /health` (default 127.0.0.1:8108), for hosts that cannot speak streamable HTTP (deprecated upstream, kept for compatibility). Verified via Docker: SSE stream 200 + endpoint event, initialize accepted, `tools/list` returns all 5 tools over the stream.
+- Native streamable-HTTP transport (Task 10): `MCP_TRANSPORT=http` serves stateless streamable HTTP on `/mcp` plus `GET /health`; `MCP_HOST`/`MCP_PORT` (default 127.0.0.1:8107). `src/server.ts` refactored into a `createServer()` factory; stdio stays the byte-identical default. New `express` dependency. Singleton recipe: one `--restart unless-stopped` container with `-p 127.0.0.1:8107:8107` shared by all sessions via opencode `type: remote`. Verified: containerized initialize + tools/list 200, end-to-end tool call through the singleton.
+
+### Fixed
+- Singleton hardening: invalid `MCP_PORT` falls back to the transport default with an error log instead of passing `NaN` to listen; SSE `GET /sse` and `POST /messages` wrapped in try/catch with safe 500 JSON; Dockerfile exposes 8107 + 8108; `.env.example` and architecture docs now document `MCP_TRANSPORT`/`MCP_HOST`/`MCP_PORT`.
+
 ## [2.4.0] - 2026-09-18
 
 ### Fixed
diff --git a/Dockerfile b/Dockerfile
index 8d975a3..7d25685 100644
--- a/Dockerfile
+++ b/Dockerfile
@@ -60,6 +60,12 @@ COPY README.md ./
 RUN mkdir -p /data/browsh-profile
 VOLUME /data/browsh-profile
 
-# No EXPOSE: Browsh's HTTP port is not configurable and must stay private.
-# Run MCP server over stdio; Browsh binds 127.0.0.1:4333 inside the container.
+# Optional singleton HTTP mode: MCP_TRANSPORT=http serves streamable HTTP on
+# MCP_PORT (default 8107); MCP_TRANSPORT=sse serves legacy SSE (default 8108).
+# Inside the container bind all interfaces
+# (MCP_HOST=0.0.0.0); lock the host side to loopback at publish time
+# (-p 127.0.0.1:8107:8107) so the port never leaves this machine.
+EXPOSE 8107 8108
+
+# Default: MCP server over stdio; Browsh binds 127.0.0.1:4333 inside the container.
 CMD ["node", "dist/server.js"]
\ No newline at end of file
diff --git a/README.md b/README.md
index 5ec15df..5f2f178 100644
--- a/README.md
+++ b/README.md
@@ -59,6 +59,27 @@ docker run --rm -i ghcr.io/mokhtarabadi/blowsh-mcp:latest
 > interactive and pipe requests, or point your MCP client at it (see
 > [AI Client Configuration](#mcp-protocol-ai-client-configuration) below).
 
+### Singleton mode (one shared HTTP instance)
+
+For setups where many agent sessions share one server (e.g. opencode
+`type: remote`), run a single supervised container instead of one stdio
+process per session:
+
+```sh
+docker volume create blowsh-profile
+docker run -d --name blowsh-singleton --restart unless-stopped \
+  -p 127.0.0.1:8107:8107 \
+  -v blowsh-profile:/data/browsh-profile \
+  -e MCP_TRANSPORT=http -e MCP_HOST=0.0.0.0 -e MCP_PORT=8107 \
+  blowsh-mcp:latest
+```
+
+Notes: `MCP_HOST=0.0.0.0` is required inside the container (loopback there is
+not reachable from the host); the `-p 127.0.0.1:` prefix keeps the published
+port on loopback so it never leaves the machine. Health probe:
+`GET http://127.0.0.1:8107/health`. MCP endpoint:
+`POST http://127.0.0.1:8107/mcp` (stateless streamable HTTP).
+
 ---
 
 ## Example Usage
@@ -260,7 +281,9 @@ Set these via `.env` (loaded automatically) or the environment:
 | `BROWSH_IDLE_TIMEOUT_MS`    | `600000`      | Idle time in ms before the browser process is killed (10 min).           |
 | `CACHE_TTL_MS`              | `300000`      | In-memory render cache TTL (ms).                                          |
 | `ALLOW_PRIVATE_URLS`        | `false`       | Set `true` to disable the SSRF guard for loopback/private targets.        |
-| `MCP_TRANSPORT`             | `stdio`       | Transport type (only `stdio` implemented).                                |
+| `MCP_TRANSPORT`             | `stdio`       | Transport type: `stdio` (default), `http` (stateless streamable HTTP on `/mcp`; see Singleton mode below), or `sse` (legacy stateful SSE on `/sse` + `/messages`, default port `8108`, for hosts that cannot speak streamable HTTP; deprecated upstream, kept for compatibility). |
+| `MCP_HOST`                  | `127.0.0.1`   | Bind address for HTTP/SSE mode. Use `0.0.0.0` inside Docker (lock the host side with `-p 127.0.0.1:<port>:<port>`). |
+| `MCP_PORT`                  | `8107`        | Port for HTTP/SSE mode (`8108` default under `MCP_TRANSPORT=sse`).        |
 | `NODE_ENV`                  | `production`  | Node environment.                                                        |
 
 ---
diff --git a/docs/architecture.md b/docs/architecture.md
index 2d0ed14..4e5e626 100644
--- a/docs/architecture.md
+++ b/docs/architecture.md
@@ -100,7 +100,7 @@ blowsh-mcp/
 - **Provider:** Any server with Docker; runs completely offline-of-host once the image is pulled.
 - **Distribution:** Prebuilt image on GitHub Container Registry — `ghcr.io/mokhtarabadi/blowsh-mcp:latest` (also tagged `2.3.2`, branch, semver, and `sha-<sha>`). Pull with `docker pull ghcr.io/mokhtarabadi/blowsh-mcp:latest`.
 - **CI/CD:** GitHub Actions (`.github/workflows/docker-publish.yml`) builds the Dockerfile and pushes to ghcr on `main` pushes and `v*` tags, with a container smoke test (MCP initialize → tools/list) before the run completes.
-- **Form factor:** MCP server over stdio (no listening port). The Browsh HTTP port stays container-private.
+- **Form factor:** MCP server over stdio by default (no listening port). Optional singleton modes share one supervised instance: streamable HTTP (`MCP_TRANSPORT=http`, default 127.0.0.1:8107) and legacy SSE (`MCP_TRANSPORT=sse`, default 127.0.0.1:8108). The Browsh HTTP port stays container-private.
 
 ## 7. Security Considerations
 
diff --git a/package-lock.json b/package-lock.json
index 769e67a..b802747 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,21 +1,23 @@
 {
   "name": "blowsh-mcp",
-  "version": "2.2.1",
+  "version": "2.4.0",
   "lockfileVersion": 3,
   "requires": true,
   "packages": {
     "": {
       "name": "blowsh-mcp",
-      "version": "2.2.1",
+      "version": "2.4.0",
       "license": "MIT",
       "dependencies": {
         "@modelcontextprotocol/sdk": "^1.30.0",
         "axios": "^1.19.0",
         "cheerio": "^1.2.0",
         "dotenv": "^17.4.2",
+        "express": "4.21.2",
         "zod": "^4.4.3"
       },
       "devDependencies": {
+        "@types/express": "^5.0.6",
         "@types/node": "^26.1.2",
         "tsx": "^4.23.4",
         "typescript": "^7.0.2"
@@ -518,6 +520,391 @@
         }
       }
     },
+    "node_modules/@modelcontextprotocol/sdk/node_modules/accepts": {
+      "version": "2.0.0",
+      "resolved": "https://registry.npmjs.org/accepts/-/accepts-2.0.0.tgz",
+      "integrity": "sha512-5cvg6CtKwfgdmVqY1WIiXKc3Q1bkRqGLi+2W/6ao+6Y7gu/RCwRuAhGEzh5B4KlszSuTLgZYuqFqo5bImjNKng==",
+      "license": "MIT",
+      "dependencies": {
+        "mime-types": "^3.0.0",
+        "negotiator": "^1.0.0"
+      },
+      "engines": {
+        "node": ">= 0.6"
+      }
+    },
+    "node_modules/@modelcontextprotocol/sdk/node_modules/body-parser": {
+      "version": "2.3.0",
+      "resolved": "https://registry.npmjs.org/body-parser/-/body-parser-2.3.0.tgz",
+      "integrity": "sha512-2cGmJupaNgg+QUwVLAucDuWuoMZ6EX9iHDRswZ5lsNYEmwPaRknMPCLZz07yTzVq/83p4o/wzbDZbBrTvGGTIw==",
+      "license": "MIT",
+      "dependencies": {
+        "bytes": "^3.1.2",
+        "content-type": "^2.0.0",
+        "debug": "^4.4.3",
+        "http-errors": "^2.0.1",
+        "iconv-lite": "^0.7.2",
+        "on-finished": "^2.4.1",
+        "qs": "^6.15.2",
+        "raw-body": "^3.0.2",
+        "type-is": "^2.1.0"
+      },
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/express"
+      }
+    },
+    "node_modules/@modelcontextprotocol/sdk/node_modules/body-parser/node_modules/content-type": {
+      "version": "2.1.0",
+      "resolved": "https://registry.npmjs.org/content-type/-/content-type-2.1.0.tgz",
+      "integrity": "sha512-mj7UPXE0jaqaOsukNZRUEfEi2AcL7C/vwmwcHV0O97eO1E1pxBZuyjlZrx5seTaNBg1U6+o35wpa35Qfcc+7ag==",
+      "license": "MIT",
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/express"
+      }
+    },
+    "node_modules/@modelcontextprotocol/sdk/node_modules/content-disposition": {
+      "version": "1.1.0",
+      "resolved": "https://registry.npmjs.org/content-disposition/-/content-disposition-1.1.0.tgz",
+      "integrity": "sha512-5jRCH9Z/+DRP7rkvY83B+yGIGX96OYdJmzngqnw2SBSxqCFPd0w2km3s5iawpGX8krnwSGmF0FW5Nhr0Hfai3g==",
+      "license": "MIT",
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/express"
+      }
+    },
+    "node_modules/@modelcontextprotocol/sdk/node_modules/cookie-signature": {
+      "version": "1.2.2",
+      "resolved": "https://registry.npmjs.org/cookie-signature/-/cookie-signature-1.2.2.tgz",
+      "integrity": "sha512-D76uU73ulSXrD1UXF4KE2TMxVVwhsnCgfAyTg9k8P6KGZjlXKrOLe4dJQKI3Bxi5wjesZoFXJWElNWBjPZMbhg==",
+      "license": "MIT",
+      "engines": {
+        "node": ">=6.6.0"
+      }
+    },
+    "node_modules/@modelcontextprotocol/sdk/node_modules/express": {
+      "version": "5.2.1",
+      "resolved": "https://registry.npmjs.org/express/-/express-5.2.1.tgz",
+      "integrity": "sha512-hIS4idWWai69NezIdRt2xFVofaF4j+6INOpJlVOLDO8zXGpUVEVzIYk12UUi2JzjEzWL3IOAxcTubgz9Po0yXw==",
+      "license": "MIT",
+      "dependencies": {
+        "accepts": "^2.0.0",
+        "body-parser": "^2.2.1",
+        "content-disposition": "^1.0.0",
+        "content-type": "^1.0.5",
+        "cookie": "^0.7.1",
+        "cookie-signature": "^1.2.1",
+        "debug": "^4.4.0",
+        "depd": "^2.0.0",
+        "encodeurl": "^2.0.0",
+        "escape-html": "^1.0.3",
+        "etag": "^1.8.1",
+        "finalhandler": "^2.1.0",
+        "fresh": "^2.0.0",
+        "http-errors": "^2.0.0",
+        "merge-descriptors": "^2.0.0",
+        "mime-types": "^3.0.0",
+        "on-finished": "^2.4.1",
+        "once": "^1.4.0",
+        "parseurl": "^1.3.3",
+        "proxy-addr": "^2.0.7",
+        "qs": "^6.14.0",
+        "range-parser": "^1.2.1",
+        "router": "^2.2.0",
+        "send": "^1.1.0",
+        "serve-static": "^2.2.0",
+        "statuses": "^2.0.1",
+        "type-is": "^2.0.1",
+        "vary": "^1.1.2"
+      },
+      "engines": {
+        "node": ">= 18"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/express"
+      }
+    },
+    "node_modules/@modelcontextprotocol/sdk/node_modules/finalhandler": {
+      "version": "2.1.1",
+      "resolved": "https://registry.npmjs.org/finalhandler/-/finalhandler-2.1.1.tgz",
+      "integrity": "sha512-S8KoZgRZN+a5rNwqTxlZZePjT/4cnm0ROV70LedRHZ0p8u9fRID0hJUZQpkKLzro8LfmC8sx23bY6tVNxv8pQA==",
+      "license": "MIT",
+      "dependencies": {
+        "debug": "^4.4.0",
+        "encodeurl": "^2.0.0",
+        "escape-html": "^1.0.3",
+        "on-finished": "^2.4.1",
+        "parseurl": "^1.3.3",
+        "statuses": "^2.0.1"
+      },
+      "engines": {
+        "node": ">= 18.0.0"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/express"
+      }
+    },
+    "node_modules/@modelcontextprotocol/sdk/node_modules/fresh": {
+      "version": "2.0.0",
+      "resolved": "https://registry.npmjs.org/fresh/-/fresh-2.0.0.tgz",
+      "integrity": "sha512-Rx/WycZ60HOaqLKAi6cHRKKI7zxWbJ31MhntmtwMoaTeF7XFH9hhBp8vITaMidfljRQ6eYWCKkaTK+ykVJHP2A==",
+      "license": "MIT",
+      "engines": {
+        "node": ">= 0.8"
+      }
+    },
+    "node_modules/@modelcontextprotocol/sdk/node_modules/iconv-lite": {
+      "version": "0.7.3",
+      "resolved": "https://registry.npmjs.org/iconv-lite/-/iconv-lite-0.7.3.tgz",
+      "integrity": "sha512-IKXpvIzjnC9XTAUbVBcMfGS0EPaIXtW6v+zr+RRp+hqULEpo0owZax6wyRwPOJbWbzjYspQwusTsfVr0ifh4uQ==",
+      "license": "MIT",
+      "dependencies": {
+        "safer-buffer": ">= 2.1.2 < 3.0.0"
+      },
+      "engines": {
+        "node": ">=0.10.0"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/express"
+      }
+    },
+    "node_modules/@modelcontextprotocol/sdk/node_modules/media-typer": {
+      "version": "1.1.1",
+      "resolved": "https://registry.npmjs.org/media-typer/-/media-typer-1.1.1.tgz",
+      "integrity": "sha512-yz3xRaG20c6/BOzvYoDaGtPmGscs7YivItZEEqe6GbwNfHuxu9YNmvnEkMzKldAGY4/80pRcQRZSEnhquk9XuQ==",
+      "license": "MIT",
+      "engines": {
+        "node": ">= 0.8"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/express"
+      }
+    },
+    "node_modules/@modelcontextprotocol/sdk/node_modules/merge-descriptors": {
+      "version": "2.0.0",
+      "resolved": "https://registry.npmjs.org/merge-descriptors/-/merge-descriptors-2.0.0.tgz",
+      "integrity": "sha512-Snk314V5ayFLhp3fkUREub6WtjBfPdCPY1Ln8/8munuLuiYhsABgBVWsozAG+MWMbVEvcdcpbi9R7ww22l9Q3g==",
+      "license": "MIT",
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
+    "node_modules/@modelcontextprotocol/sdk/node_modules/mime-db": {
+      "version": "1.54.0",
+      "resolved": "https://registry.npmjs.org/mime-db/-/mime-db-1.54.0.tgz",
+      "integrity": "sha512-aU5EJuIN2WDemCcAp2vFBfp/m4EAhWJnUNSSw0ixs7/kXbd6Pg64EmwJkNdFhB8aWt1sH2CTXrLxo/iAGV3oPQ==",
+      "license": "MIT",
+      "engines": {
+        "node": ">= 0.6"
+      }
+    },
+    "node_modules/@modelcontextprotocol/sdk/node_modules/mime-types": {
+      "version": "3.0.2",
+      "resolved": "https://registry.npmjs.org/mime-types/-/mime-types-3.0.2.tgz",
+      "integrity": "sha512-Lbgzdk0h4juoQ9fCKXW4by0UJqj+nOOrI9MJ1sSj4nI8aI2eo1qmvQEie4VD1glsS250n15LsWsYtCugiStS5A==",
+      "license": "MIT",
+      "dependencies": {
+        "mime-db": "^1.54.0"
+      },
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/express"
+      }
+    },
+    "node_modules/@modelcontextprotocol/sdk/node_modules/negotiator": {
+      "version": "1.1.0",
+      "resolved": "https://registry.npmjs.org/negotiator/-/negotiator-1.1.0.tgz",
+      "integrity": "sha512-NMPBRMJgiQHjbd8phG3Vebdx4kZ1H121rbl5IkMqeOsahptB9BKo/d7oJ3zTXqTgagn2bWlNSXkh0QUGM31RYg==",
+      "license": "MIT",
+      "dependencies": {
+        "content-type": "^2.1.0"
+      },
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/express"
+      }
+    },
+    "node_modules/@modelcontextprotocol/sdk/node_modules/negotiator/node_modules/content-type": {
+      "version": "2.1.0",
+      "resolved": "https://registry.npmjs.org/content-type/-/content-type-2.1.0.tgz",
+      "integrity": "sha512-mj7UPXE0jaqaOsukNZRUEfEi2AcL7C/vwmwcHV0O97eO1E1pxBZuyjlZrx5seTaNBg1U6+o35wpa35Qfcc+7ag==",
+      "license": "MIT",
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/express"
+      }
+    },
+    "node_modules/@modelcontextprotocol/sdk/node_modules/qs": {
+      "version": "6.16.0",
+      "resolved": "https://registry.npmjs.org/qs/-/qs-6.16.0.tgz",
+      "integrity": "sha512-h6fhOIaRrID2CbEY2fqs+7t+UXZo+MLAnU5gRIq85uFtdiUPCdsApMlHhXogKVM4HM2DVbIjGNTTYH2OcmP1vA==",
+      "license": "BSD-3-Clause",
+      "dependencies": {
+        "es-define-property": "^1.0.1",
+        "side-channel": "^1.1.1"
+      },
+      "engines": {
+        "node": ">=0.6"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/ljharb"
+      }
+    },
+    "node_modules/@modelcontextprotocol/sdk/node_modules/send": {
+      "version": "1.2.1",
+      "resolved": "https://registry.npmjs.org/send/-/send-1.2.1.tgz",
+      "integrity": "sha512-1gnZf7DFcoIcajTjTwjwuDjzuz4PPcY2StKPlsGAQ1+YH20IRVrBaXSWmdjowTJ6u8Rc01PoYOGHXfP1mYcZNQ==",
+      "license": "MIT",
+      "dependencies": {
+        "debug": "^4.4.3",
+        "encodeurl": "^2.0.0",
+        "escape-html": "^1.0.3",
+        "etag": "^1.8.1",
+        "fresh": "^2.0.0",
+        "http-errors": "^2.0.1",
+        "mime-types": "^3.0.2",
+        "ms": "^2.1.3",
+        "on-finished": "^2.4.1",
+        "range-parser": "^1.2.1",
+        "statuses": "^2.0.2"
+      },
+      "engines": {
+        "node": ">= 18"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/express"
+      }
+    },
+    "node_modules/@modelcontextprotocol/sdk/node_modules/serve-static": {
+      "version": "2.2.1",
+      "resolved": "https://registry.npmjs.org/serve-static/-/serve-static-2.2.1.tgz",
+      "integrity": "sha512-xRXBn0pPqQTVQiC8wyQrKs2MOlX24zQ0POGaj0kultvoOCstBQM5yvOhAVSUwOMjQtTvsPWoNCHfPGwaaQJhTw==",
+      "license": "MIT",
+      "dependencies": {
+        "encodeurl": "^2.0.0",
+        "escape-html": "^1.0.3",
+        "parseurl": "^1.3.3",
+        "send": "^1.2.0"
+      },
+      "engines": {
+        "node": ">= 18"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/express"
+      }
+    },
+    "node_modules/@modelcontextprotocol/sdk/node_modules/type-is": {
+      "version": "2.1.0",
+      "resolved": "https://registry.npmjs.org/type-is/-/type-is-2.1.0.tgz",
+      "integrity": "sha512-faYHw0anBbc/kWF3zFTEnxSFOAGUX9GFbOBthvDdLsIlEoWOFOtS0zgCiQYwIskL9iGXZL3kAXD8OoZ4GmMATA==",
+      "license": "MIT",
+      "dependencies": {
+        "content-type": "^2.0.0",
+        "media-typer": "^1.1.0",
+        "mime-types": "^3.0.0"
+      },
+      "engines": {
+        "node": ">= 18"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/express"
+      }
+    },
+    "node_modules/@modelcontextprotocol/sdk/node_modules/type-is/node_modules/content-type": {
+      "version": "2.1.0",
+      "resolved": "https://registry.npmjs.org/content-type/-/content-type-2.1.0.tgz",
+      "integrity": "sha512-mj7UPXE0jaqaOsukNZRUEfEi2AcL7C/vwmwcHV0O97eO1E1pxBZuyjlZrx5seTaNBg1U6+o35wpa35Qfcc+7ag==",
+      "license": "MIT",
+      "engines": {
+        "node": ">=18"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/express"
+      }
+    },
+    "node_modules/@types/body-parser": {
+      "version": "1.19.6",
+      "resolved": "https://registry.npmjs.org/@types/body-parser/-/body-parser-1.19.6.tgz",
+      "integrity": "sha512-HLFeCYgz89uk22N5Qg3dvGvsv46B8GLvKKo1zKG4NybA8U2DiEO3w9lqGg29t/tfLRJpJ6iQxnVw4OnB7MoM9g==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@types/connect": "*",
+        "@types/node": "*"
+      }
+    },
+    "node_modules/@types/connect": {
+      "version": "3.4.38",
+      "resolved": "https://registry.npmjs.org/@types/connect/-/connect-3.4.38.tgz",
+      "integrity": "sha512-K6uROf1LD88uDQqJCktA4yzL1YYAK6NgfsI0v/mTgyPKWsX1CnJ0XPSDhViejru1GcRkLWb8RlzFYJRqGUbaug==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@types/node": "*"
+      }
+    },
+    "node_modules/@types/express": {
+      "version": "5.0.6",
+      "resolved": "https://registry.npmjs.org/@types/express/-/express-5.0.6.tgz",
+      "integrity": "sha512-sKYVuV7Sv9fbPIt/442koC7+IIwK5olP1KWeD88e/idgoJqDm3JV/YUiPwkoKK92ylff2MGxSz1CSjsXelx0YA==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@types/body-parser": "*",
+        "@types/express-serve-static-core": "^5.0.0",
+        "@types/serve-static": "^2"
+      }
+    },
+    "node_modules/@types/express-serve-static-core": {
+      "version": "5.1.3",
+      "resolved": "https://registry.npmjs.org/@types/express-serve-static-core/-/express-serve-static-core-5.1.3.tgz",
+      "integrity": "sha512-dPfW8NFiOF4wOHc7+N/QSxlY9cfSsenewGbAz8C8U/MULPd/YZ27LvJUIlzaXie7e6Ove9YunJGgC9tbHD2cKw==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@types/node": "*",
+        "@types/qs": "*",
+        "@types/range-parser": "*",
+        "@types/send": "*"
+      }
+    },
+    "node_modules/@types/http-errors": {
+      "version": "2.0.5",
+      "resolved": "https://registry.npmjs.org/@types/http-errors/-/http-errors-2.0.5.tgz",
+      "integrity": "sha512-r8Tayk8HJnX0FztbZN7oVqGccWgw98T/0neJphO91KkmOzug1KkofZURD4UaD5uH8AqcFLfdPErnBod0u71/qg==",
+      "dev": true,
+      "license": "MIT"
+    },
     "node_modules/@types/node": {
       "version": "26.1.2",
       "resolved": "https://registry.npmjs.org/@types/node/-/node-26.1.2.tgz",
@@ -528,6 +915,41 @@
         "undici-types": "~8.3.0"
       }
     },
+    "node_modules/@types/qs": {
+      "version": "6.15.1",
+      "resolved": "https://registry.npmjs.org/@types/qs/-/qs-6.15.1.tgz",
+      "integrity": "sha512-GZHUBZR9hckSUhrxmp1nG6NwdpM9fCunJwyThLW1X3AyHgd9IlHb6VANpQQqDr2o/qQp6McZ3y/IA2rVzKzSbw==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/@types/range-parser": {
+      "version": "1.2.7",
+      "resolved": "https://registry.npmjs.org/@types/range-parser/-/range-parser-1.2.7.tgz",
+      "integrity": "sha512-hKormJbkJqzQGhziax5PItDUTMAM9uE2XXQmM37dyd4hVM+5aVl7oVxMVUiVQn2oCQFN/LKCZdvSM0pFRqbSmQ==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/@types/send": {
+      "version": "1.2.1",
+      "resolved": "https://registry.npmjs.org/@types/send/-/send-1.2.1.tgz",
+      "integrity": "sha512-arsCikDvlU99zl1g69TcAB3mzZPpxgw0UQnaHeC1Nwb015xp8bknZv5rIfri9xTOcMuaVgvabfIRA7PSZVuZIQ==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@types/node": "*"
+      }
+    },
+    "node_modules/@types/serve-static": {
+      "version": "2.2.0",
+      "resolved": "https://registry.npmjs.org/@types/serve-static/-/serve-static-2.2.0.tgz",
+      "integrity": "sha512-8mam4H1NHLtu7nmtalF7eyBH14QyOASmcxHhSfEoRyr0nP/YdoesEtU+uSRvMe96TW/HPTtkoKqQLl53N7UXMQ==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "@types/http-errors": "*",
+        "@types/node": "*"
+      }
+    },
     "node_modules/@typescript/typescript-aix-ppc64": {
       "version": "7.0.2",
       "resolved": "https://registry.npmjs.org/@typescript/typescript-aix-ppc64/-/typescript-aix-ppc64-7.0.2.tgz",
@@ -869,13 +1291,13 @@
       }
     },
     "node_modules/accepts": {
-      "version": "2.0.0",
-      "resolved": "https://registry.npmjs.org/accepts/-/accepts-2.0.0.tgz",
-      "integrity": "sha512-5cvg6CtKwfgdmVqY1WIiXKc3Q1bkRqGLi+2W/6ao+6Y7gu/RCwRuAhGEzh5B4KlszSuTLgZYuqFqo5bImjNKng==",
+      "version": "1.3.8",
+      "resolved": "https://registry.npmjs.org/accepts/-/accepts-1.3.8.tgz",
+      "integrity": "sha512-PYAthTa2m2VKxuvSD3DPC/Gy+U+sOA1LAuT8mkmRuvw+NACSaeXEQ+NHcVF7rONl6qcaxV3Uuemwawk+7+SJLw==",
       "license": "MIT",
       "dependencies": {
-        "mime-types": "^3.0.0",
-        "negotiator": "^1.0.0"
+        "mime-types": "~2.1.34",
+        "negotiator": "0.6.3"
       },
       "engines": {
         "node": ">= 0.6"
@@ -926,6 +1348,12 @@
         }
       }
     },
+    "node_modules/array-flatten": {
+      "version": "1.1.1",
+      "resolved": "https://registry.npmjs.org/array-flatten/-/array-flatten-1.1.1.tgz",
+      "integrity": "sha512-PCVAQswWemu6UdxsDFFX/+gVeYqKAod3D3UVm91jHwynguOwAvYPhx8nNlM++NqRcK6CxxpUafjmhIdKiHibqg==",
+      "license": "MIT"
+    },
     "node_modules/asynckit": {
       "version": "0.4.0",
       "resolved": "https://registry.npmjs.org/asynckit/-/asynckit-0.4.0.tgz",
@@ -945,56 +1373,94 @@
       }
     },
     "node_modules/body-parser": {
-      "version": "2.3.0",
-      "resolved": "https://registry.npmjs.org/body-parser/-/body-parser-2.3.0.tgz",
-      "integrity": "sha512-2cGmJupaNgg+QUwVLAucDuWuoMZ6EX9iHDRswZ5lsNYEmwPaRknMPCLZz07yTzVq/83p4o/wzbDZbBrTvGGTIw==",
+      "version": "1.20.3",
+      "resolved": "https://registry.npmjs.org/body-parser/-/body-parser-1.20.3.tgz",
+      "integrity": "sha512-7rAxByjUMqQ3/bHJy7D6OGXvx/MMc4IqBn/X0fcM1QUcAItpZrBEYhWGem+tzXH90c+G01ypMcYJBO9Y30203g==",
       "license": "MIT",
       "dependencies": {
-        "bytes": "^3.1.2",
-        "content-type": "^2.0.0",
-        "debug": "^4.4.3",
-        "http-errors": "^2.0.1",
-        "iconv-lite": "^0.7.2",
-        "on-finished": "^2.4.1",
-        "qs": "^6.15.2",
-        "raw-body": "^3.0.2",
-        "type-is": "^2.1.0"
+        "bytes": "3.1.2",
+        "content-type": "~1.0.5",
+        "debug": "2.6.9",
+        "depd": "2.0.0",
+        "destroy": "1.2.0",
+        "http-errors": "2.0.0",
+        "iconv-lite": "0.4.24",
+        "on-finished": "2.4.1",
+        "qs": "6.13.0",
+        "raw-body": "2.5.2",
+        "type-is": "~1.6.18",
+        "unpipe": "1.0.0"
       },
       "engines": {
-        "node": ">=18"
-      },
-      "funding": {
-        "type": "opencollective",
-        "url": "https://opencollective.com/express"
+        "node": ">= 0.8",
+        "npm": "1.2.8000 || >= 1.4.16"
       }
     },
-    "node_modules/body-parser/node_modules/content-type": {
+    "node_modules/body-parser/node_modules/debug": {
+      "version": "2.6.9",
+      "resolved": "https://registry.npmjs.org/debug/-/debug-2.6.9.tgz",
+      "integrity": "sha512-bC7ElrdJaJnPbAP+1EotYvqZsb3ecl5wi6Bfi6BJTUcNowp6cvspg0jXznRTKDjm/E7AdgFBVeAPVMNcKGsHMA==",
+      "license": "MIT",
+      "dependencies": {
+        "ms": "2.0.0"
+      }
+    },
+    "node_modules/body-parser/node_modules/http-errors": {
       "version": "2.0.0",
-      "resolved": "https://registry.npmjs.org/content-type/-/content-type-2.0.0.tgz",
-      "integrity": "sha512-j/O/d7GcZCyNl7/hwZAb606rzqkyvaDctLmckbxLzHvFBzTJHuGEdodATcP3yIRoDrLHkIATJuvzbFlp/ki2cQ==",
+      "resolved": "https://registry.npmjs.org/http-errors/-/http-errors-2.0.0.tgz",
+      "integrity": "sha512-FtwrG/euBzaEjYeRqOgly7G0qviiXoJWnvEH2Z1plBdXgbyjv34pHTSb9zoeHMyDy33+DWy5Wt9Wo+TURtOYSQ==",
       "license": "MIT",
-      "engines": {
-        "node": ">=18"
+      "dependencies": {
+        "depd": "2.0.0",
+        "inherits": "2.0.4",
+        "setprototypeof": "1.2.0",
+        "statuses": "2.0.1",
+        "toidentifier": "1.0.1"
       },
-      "funding": {
-        "type": "opencollective",
-        "url": "https://opencollective.com/express"
+      "engines": {
+        "node": ">= 0.8"
       }
     },
     "node_modules/body-parser/node_modules/iconv-lite": {
-      "version": "0.7.3",
-      "resolved": "https://registry.npmjs.org/iconv-lite/-/iconv-lite-0.7.3.tgz",
-      "integrity": "sha512-IKXpvIzjnC9XTAUbVBcMfGS0EPaIXtW6v+zr+RRp+hqULEpo0owZax6wyRwPOJbWbzjYspQwusTsfVr0ifh4uQ==",
+      "version": "0.4.24",
+      "resolved": "https://registry.npmjs.org/iconv-lite/-/iconv-lite-0.4.24.tgz",
+      "integrity": "sha512-v3MXnZAcvnywkTUEZomIActle7RXXeedOR31wwl7VlyoXO4Qi9arvSenNQWne1TcRwhCL1HwLI21bEqdpj8/rA==",
       "license": "MIT",
       "dependencies": {
-        "safer-buffer": ">= 2.1.2 < 3.0.0"
+        "safer-buffer": ">= 2.1.2 < 3"
       },
       "engines": {
         "node": ">=0.10.0"
+      }
+    },
+    "node_modules/body-parser/node_modules/ms": {
+      "version": "2.0.0",
+      "resolved": "https://registry.npmjs.org/ms/-/ms-2.0.0.tgz",
+      "integrity": "sha512-Tpp60P6IUJDTuOq/5Z8cdskzJujfwqfOTkrwIwj7IRISpnkJnT6SyJ4PCPnGMoFjC9ddhal5KVIYtAt97ix05A==",
+      "license": "MIT"
+    },
+    "node_modules/body-parser/node_modules/raw-body": {
+      "version": "2.5.2",
+      "resolved": "https://registry.npmjs.org/raw-body/-/raw-body-2.5.2.tgz",
+      "integrity": "sha512-8zGqypfENjCIqGhgXToC8aB2r7YrBX+AQAfIPs/Mlk+BtPTztOvTS01NRW/3Eh60J+a48lt8qsCzirQ6loCVfA==",
+      "license": "MIT",
+      "dependencies": {
+        "bytes": "3.1.2",
+        "http-errors": "2.0.0",
+        "iconv-lite": "0.4.24",
+        "unpipe": "1.0.0"
       },
-      "funding": {
-        "type": "opencollective",
-        "url": "https://opencollective.com/express"
+      "engines": {
+        "node": ">= 0.8"
+      }
+    },
+    "node_modules/body-parser/node_modules/statuses": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/statuses/-/statuses-2.0.1.tgz",
+      "integrity": "sha512-RwNA9Z/7PrK06rYLIzFMlaF+l73iwpzsqRIFgbMLbTcLD6cOao82TaWefPXQvB2fOC4AjuYSEndS7N/mTCbkdQ==",
+      "license": "MIT",
+      "engines": {
+        "node": ">= 0.8"
       }
     },
     "node_modules/boolbase": {
@@ -1096,16 +1562,15 @@
       }
     },
     "node_modules/content-disposition": {
-      "version": "1.1.0",
-      "resolved": "https://registry.npmjs.org/content-disposition/-/content-disposition-1.1.0.tgz",
-      "integrity": "sha512-5jRCH9Z/+DRP7rkvY83B+yGIGX96OYdJmzngqnw2SBSxqCFPd0w2km3s5iawpGX8krnwSGmF0FW5Nhr0Hfai3g==",
+      "version": "0.5.4",
+      "resolved": "https://registry.npmjs.org/content-disposition/-/content-disposition-0.5.4.tgz",
+      "integrity": "sha512-FveZTNuGw04cxlAiWbzi6zTAL/lhehaWbTtgluJh4/E95DqMwTmha3KZN1aAWA8cFIhHzMZUvLevkw5Rqk+tSQ==",
       "license": "MIT",
-      "engines": {
-        "node": ">=18"
+      "dependencies": {
+        "safe-buffer": "5.2.1"
       },
-      "funding": {
-        "type": "opencollective",
-        "url": "https://opencollective.com/express"
+      "engines": {
+        "node": ">= 0.6"
       }
     },
     "node_modules/content-type": {
@@ -1118,22 +1583,19 @@
       }
     },
     "node_modules/cookie": {
-      "version": "0.7.2",
-      "resolved": "https://registry.npmjs.org/cookie/-/cookie-0.7.2.tgz",
-      "integrity": "sha512-yki5XnKuf750l50uGTllt6kKILY4nQ1eNIQatoXEByZ5dWgnKqbnqmTrBE5B4N7lrMJKQ2ytWMiTO2o0v6Ew/w==",
+      "version": "0.7.1",
+      "resolved": "https://registry.npmjs.org/cookie/-/cookie-0.7.1.tgz",
+      "integrity": "sha512-6DnInpx7SJ2AK3+CTUE/ZM0vWTUboZCegxhC2xiIydHR9jNuTAASBrfEpHhiGOZw/nX51bHt6YQl8jsGo4y/0w==",
       "license": "MIT",
       "engines": {
         "node": ">= 0.6"
       }
     },
     "node_modules/cookie-signature": {
-      "version": "1.2.2",
-      "resolved": "https://registry.npmjs.org/cookie-signature/-/cookie-signature-1.2.2.tgz",
-      "integrity": "sha512-D76uU73ulSXrD1UXF4KE2TMxVVwhsnCgfAyTg9k8P6KGZjlXKrOLe4dJQKI3Bxi5wjesZoFXJWElNWBjPZMbhg==",
-      "license": "MIT",
-      "engines": {
-        "node": ">=6.6.0"
-      }
+      "version": "1.0.6",
+      "resolved": "https://registry.npmjs.org/cookie-signature/-/cookie-signature-1.0.6.tgz",
+      "integrity": "sha512-QADzlaHc8icV8I7vbaJXJwod9HWYp8uCqf1xa4OfNu1T7JVxQIrUgOWtHdNDtPiywmFbiS12VjotIXLrKM3orQ==",
+      "license": "MIT"
     },
     "node_modules/cors": {
       "version": "2.8.6",
@@ -1229,6 +1691,16 @@
         "node": ">= 0.8"
       }
     },
+    "node_modules/destroy": {
+      "version": "1.2.0",
+      "resolved": "https://registry.npmjs.org/destroy/-/destroy-1.2.0.tgz",
+      "integrity": "sha512-2sJGJTaXIIaR1w4iJSNoN0hnMY7Gpc/n8D4qSCJw8QqFWXf7cuAgnEHxBpweaVcPevC2l3KpjYCx3NypQQgaJg==",
+      "license": "MIT",
+      "engines": {
+        "node": ">= 0.8",
+        "npm": "1.2.8000 || >= 1.4.16"
+      }
+    },
     "node_modules/dom-serializer": {
       "version": "2.0.0",
       "resolved": "https://registry.npmjs.org/dom-serializer/-/dom-serializer-2.0.0.tgz",
@@ -1465,51 +1937,54 @@
       }
     },
     "node_modules/eventsource-parser": {
-      "version": "3.1.0",
-      "resolved": "https://registry.npmjs.org/eventsource-parser/-/eventsource-parser-3.1.0.tgz",
-      "integrity": "sha512-kJezFj9YFAMLeORyi7aCLxLbD5/qWMQnoMVlVPyHIll7lgRJCc3JVln9Vgl9nwQi0YkMnhdGTMNn7CkRRAptMg==",
-      "license": "MIT",
-      "engines": {
-        "node": ">=18.0.0"
-      }
-    },
-    "node_modules/express": {
-      "version": "5.2.1",
-      "resolved": "https://registry.npmjs.org/express/-/express-5.2.1.tgz",
-      "integrity": "sha512-hIS4idWWai69NezIdRt2xFVofaF4j+6INOpJlVOLDO8zXGpUVEVzIYk12UUi2JzjEzWL3IOAxcTubgz9Po0yXw==",
-      "license": "MIT",
-      "dependencies": {
-        "accepts": "^2.0.0",
-        "body-parser": "^2.2.1",
-        "content-disposition": "^1.0.0",
-        "content-type": "^1.0.5",
-        "cookie": "^0.7.1",
-        "cookie-signature": "^1.2.1",
-        "debug": "^4.4.0",
-        "depd": "^2.0.0",
-        "encodeurl": "^2.0.0",
-        "escape-html": "^1.0.3",
-        "etag": "^1.8.1",
-        "finalhandler": "^2.1.0",
-        "fresh": "^2.0.0",
-        "http-errors": "^2.0.0",
-        "merge-descriptors": "^2.0.0",
-        "mime-types": "^3.0.0",
-        "on-finished": "^2.4.1",
-        "once": "^1.4.0",
-        "parseurl": "^1.3.3",
-        "proxy-addr": "^2.0.7",
-        "qs": "^6.14.0",
-        "range-parser": "^1.2.1",
-        "router": "^2.2.0",
-        "send": "^1.1.0",
-        "serve-static": "^2.2.0",
-        "statuses": "^2.0.1",
-        "type-is": "^2.0.1",
-        "vary": "^1.1.2"
-      },
+      "version": "3.1.0",
+      "resolved": "https://registry.npmjs.org/eventsource-parser/-/eventsource-parser-3.1.0.tgz",
+      "integrity": "sha512-kJezFj9YFAMLeORyi7aCLxLbD5/qWMQnoMVlVPyHIll7lgRJCc3JVln9Vgl9nwQi0YkMnhdGTMNn7CkRRAptMg==",
+      "license": "MIT",
       "engines": {
-        "node": ">= 18"
+        "node": ">=18.0.0"
+      }
+    },
+    "node_modules/express": {
+      "version": "4.21.2",
+      "resolved": "https://registry.npmjs.org/express/-/express-4.21.2.tgz",
+      "integrity": "sha512-28HqgMZAmih1Czt9ny7qr6ek2qddF4FclbMzwhCREB6OFfH+rXAnuNCwo1/wFvrtbgsQDb4kSbX9de9lFbrXnA==",
+      "license": "MIT",
+      "dependencies": {
+        "accepts": "~1.3.8",
+        "array-flatten": "1.1.1",
+        "body-parser": "1.20.3",
+        "content-disposition": "0.5.4",
+        "content-type": "~1.0.4",
+        "cookie": "0.7.1",
+        "cookie-signature": "1.0.6",
+        "debug": "2.6.9",
+        "depd": "2.0.0",
+        "encodeurl": "~2.0.0",
+        "escape-html": "~1.0.3",
+        "etag": "~1.8.1",
+        "finalhandler": "1.3.1",
+        "fresh": "0.5.2",
+        "http-errors": "2.0.0",
+        "merge-descriptors": "1.0.3",
+        "methods": "~1.1.2",
+        "on-finished": "2.4.1",
+        "parseurl": "~1.3.3",
+        "path-to-regexp": "0.1.12",
+        "proxy-addr": "~2.0.7",
+        "qs": "6.13.0",
+        "range-parser": "~1.2.1",
+        "safe-buffer": "5.2.1",
+        "send": "0.19.0",
+        "serve-static": "1.16.2",
+        "setprototypeof": "1.2.0",
+        "statuses": "2.0.1",
+        "type-is": "~1.6.18",
+        "utils-merge": "1.0.1",
+        "vary": "~1.1.2"
+      },
+      "engines": {
+        "node": ">= 0.10.0"
       },
       "funding": {
         "type": "opencollective",
@@ -1535,6 +2010,46 @@
         "express": ">= 4.11"
       }
     },
+    "node_modules/express/node_modules/debug": {
+      "version": "2.6.9",
+      "resolved": "https://registry.npmjs.org/debug/-/debug-2.6.9.tgz",
+      "integrity": "sha512-bC7ElrdJaJnPbAP+1EotYvqZsb3ecl5wi6Bfi6BJTUcNowp6cvspg0jXznRTKDjm/E7AdgFBVeAPVMNcKGsHMA==",
+      "license": "MIT",
+      "dependencies": {
+        "ms": "2.0.0"
+      }
+    },
+    "node_modules/express/node_modules/http-errors": {
+      "version": "2.0.0",
+      "resolved": "https://registry.npmjs.org/http-errors/-/http-errors-2.0.0.tgz",
+      "integrity": "sha512-FtwrG/euBzaEjYeRqOgly7G0qviiXoJWnvEH2Z1plBdXgbyjv34pHTSb9zoeHMyDy33+DWy5Wt9Wo+TURtOYSQ==",
+      "license": "MIT",
+      "dependencies": {
+        "depd": "2.0.0",
+        "inherits": "2.0.4",
+        "setprototypeof": "1.2.0",
+        "statuses": "2.0.1",
+        "toidentifier": "1.0.1"
+      },
+      "engines": {
+        "node": ">= 0.8"
+      }
+    },
+    "node_modules/express/node_modules/ms": {
+      "version": "2.0.0",
+      "resolved": "https://registry.npmjs.org/ms/-/ms-2.0.0.tgz",
+      "integrity": "sha512-Tpp60P6IUJDTuOq/5Z8cdskzJujfwqfOTkrwIwj7IRISpnkJnT6SyJ4PCPnGMoFjC9ddhal5KVIYtAt97ix05A==",
+      "license": "MIT"
+    },
+    "node_modules/express/node_modules/statuses": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/statuses/-/statuses-2.0.1.tgz",
+      "integrity": "sha512-RwNA9Z/7PrK06rYLIzFMlaF+l73iwpzsqRIFgbMLbTcLD6cOao82TaWefPXQvB2fOC4AjuYSEndS7N/mTCbkdQ==",
+      "license": "MIT",
+      "engines": {
+        "node": ">= 0.8"
+      }
+    },
     "node_modules/fast-deep-equal": {
       "version": "3.1.3",
       "resolved": "https://registry.npmjs.org/fast-deep-equal/-/fast-deep-equal-3.1.3.tgz",
@@ -1558,24 +2073,45 @@
       "license": "BSD-3-Clause"
     },
     "node_modules/finalhandler": {
-      "version": "2.1.1",
-      "resolved": "https://registry.npmjs.org/finalhandler/-/finalhandler-2.1.1.tgz",
-      "integrity": "sha512-S8KoZgRZN+a5rNwqTxlZZePjT/4cnm0ROV70LedRHZ0p8u9fRID0hJUZQpkKLzro8LfmC8sx23bY6tVNxv8pQA==",
+      "version": "1.3.1",
+      "resolved": "https://registry.npmjs.org/finalhandler/-/finalhandler-1.3.1.tgz",
+      "integrity": "sha512-6BN9trH7bp3qvnrRyzsBz+g3lZxTNZTbVO2EV1CS0WIcDbawYVdYvGflME/9QP0h0pYlCDBCTjYa9nZzMDpyxQ==",
       "license": "MIT",
       "dependencies": {
-        "debug": "^4.4.0",
-        "encodeurl": "^2.0.0",
-        "escape-html": "^1.0.3",
-        "on-finished": "^2.4.1",
-        "parseurl": "^1.3.3",
-        "statuses": "^2.0.1"
+        "debug": "2.6.9",
+        "encodeurl": "~2.0.0",
+        "escape-html": "~1.0.3",
+        "on-finished": "2.4.1",
+        "parseurl": "~1.3.3",
+        "statuses": "2.0.1",
+        "unpipe": "~1.0.0"
       },
       "engines": {
-        "node": ">= 18.0.0"
-      },
-      "funding": {
-        "type": "opencollective",
-        "url": "https://opencollective.com/express"
+        "node": ">= 0.8"
+      }
+    },
+    "node_modules/finalhandler/node_modules/debug": {
+      "version": "2.6.9",
+      "resolved": "https://registry.npmjs.org/debug/-/debug-2.6.9.tgz",
+      "integrity": "sha512-bC7ElrdJaJnPbAP+1EotYvqZsb3ecl5wi6Bfi6BJTUcNowp6cvspg0jXznRTKDjm/E7AdgFBVeAPVMNcKGsHMA==",
+      "license": "MIT",
+      "dependencies": {
+        "ms": "2.0.0"
+      }
+    },
+    "node_modules/finalhandler/node_modules/ms": {
+      "version": "2.0.0",
+      "resolved": "https://registry.npmjs.org/ms/-/ms-2.0.0.tgz",
+      "integrity": "sha512-Tpp60P6IUJDTuOq/5Z8cdskzJujfwqfOTkrwIwj7IRISpnkJnT6SyJ4PCPnGMoFjC9ddhal5KVIYtAt97ix05A==",
+      "license": "MIT"
+    },
+    "node_modules/finalhandler/node_modules/statuses": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/statuses/-/statuses-2.0.1.tgz",
+      "integrity": "sha512-RwNA9Z/7PrK06rYLIzFMlaF+l73iwpzsqRIFgbMLbTcLD6cOao82TaWefPXQvB2fOC4AjuYSEndS7N/mTCbkdQ==",
+      "license": "MIT",
+      "engines": {
+        "node": ">= 0.8"
       }
     },
     "node_modules/follow-redirects": {
@@ -1614,27 +2150,6 @@
         "node": ">= 6"
       }
     },
-    "node_modules/form-data/node_modules/mime-db": {
-      "version": "1.52.0",
-      "resolved": "https://registry.npmjs.org/mime-db/-/mime-db-1.52.0.tgz",
-      "integrity": "sha512-sPU4uV7dYlvtWJxwwxHD0PuihVNiE7TyAbQ5SWxDCB9mUYvOgroQOwYQQOKPJ8CIbE+1ETVlOoK1UC2nU3gYvg==",
-      "license": "MIT",
-      "engines": {
-        "node": ">= 0.6"
-      }
-    },
-    "node_modules/form-data/node_modules/mime-types": {
-      "version": "2.1.35",
-      "resolved": "https://registry.npmjs.org/mime-types/-/mime-types-2.1.35.tgz",
-      "integrity": "sha512-ZDY+bPm5zTTF+YpCrAU9nK0UgICYPT0QtT1NZWFv4s++TNkcgVaT0g6+4R2uI4MjQjzysHB1zxuWL50hzaeXiw==",
-      "license": "MIT",
-      "dependencies": {
-        "mime-db": "1.52.0"
-      },
-      "engines": {
-        "node": ">= 0.6"
-      }
-    },
     "node_modules/forwarded": {
       "version": "0.2.0",
       "resolved": "https://registry.npmjs.org/forwarded/-/forwarded-0.2.0.tgz",
@@ -1645,12 +2160,12 @@
       }
     },
     "node_modules/fresh": {
-      "version": "2.0.0",
-      "resolved": "https://registry.npmjs.org/fresh/-/fresh-2.0.0.tgz",
-      "integrity": "sha512-Rx/WycZ60HOaqLKAi6cHRKKI7zxWbJ31MhntmtwMoaTeF7XFH9hhBp8vITaMidfljRQ6eYWCKkaTK+ykVJHP2A==",
+      "version": "0.5.2",
+      "resolved": "https://registry.npmjs.org/fresh/-/fresh-0.5.2.tgz",
+      "integrity": "sha512-zJ2mQYM18rEFOudeV4GShTGIQ7RbzA7ozbU9I/XBpm7kqgMywgmylMwXHxZJmkVoYkna9d2pVXVXPdYTP9ej8Q==",
       "license": "MIT",
       "engines": {
-        "node": ">= 0.8"
+        "node": ">= 0.6"
       }
     },
     "node_modules/fsevents": {
@@ -1917,53 +2432,63 @@
       }
     },
     "node_modules/media-typer": {
-      "version": "1.1.1",
-      "resolved": "https://registry.npmjs.org/media-typer/-/media-typer-1.1.1.tgz",
-      "integrity": "sha512-yz3xRaG20c6/BOzvYoDaGtPmGscs7YivItZEEqe6GbwNfHuxu9YNmvnEkMzKldAGY4/80pRcQRZSEnhquk9XuQ==",
+      "version": "0.3.0",
+      "resolved": "https://registry.npmjs.org/media-typer/-/media-typer-0.3.0.tgz",
+      "integrity": "sha512-dq+qelQ9akHpcOl/gUVRTxVIOkAJ1wR3QAvb4RsVjS8oVoFjDGTc679wJYmUmknUF5HwMLOgb5O+a3KxfWapPQ==",
       "license": "MIT",
       "engines": {
-        "node": ">= 0.8"
-      },
-      "funding": {
-        "type": "opencollective",
-        "url": "https://opencollective.com/express"
+        "node": ">= 0.6"
       }
     },
     "node_modules/merge-descriptors": {
-      "version": "2.0.0",
-      "resolved": "https://registry.npmjs.org/merge-descriptors/-/merge-descriptors-2.0.0.tgz",
-      "integrity": "sha512-Snk314V5ayFLhp3fkUREub6WtjBfPdCPY1Ln8/8munuLuiYhsABgBVWsozAG+MWMbVEvcdcpbi9R7ww22l9Q3g==",
+      "version": "1.0.3",
+      "resolved": "https://registry.npmjs.org/merge-descriptors/-/merge-descriptors-1.0.3.tgz",
+      "integrity": "sha512-gaNvAS7TZ897/rVaZ0nMtAyxNyi/pdbjbAwUpFQpN70GqnVfOiXpeUUMKRBmzXaSQ8DdTX4/0ms62r2K+hE6mQ==",
       "license": "MIT",
-      "engines": {
-        "node": ">=18"
-      },
       "funding": {
         "url": "https://github.com/sponsors/sindresorhus"
       }
     },
+    "node_modules/methods": {
+      "version": "1.1.2",
+      "resolved": "https://registry.npmjs.org/methods/-/methods-1.1.2.tgz",
+      "integrity": "sha512-iclAHeNqNm68zFtnZ0e+1L2yUIdvzNoauKU4WBA3VvH/vPFieF7qfRlwUZU+DA9P9bPXIS90ulxoUoCH23sV2w==",
+      "license": "MIT",
+      "engines": {
+        "node": ">= 0.6"
+      }
+    },
+    "node_modules/mime": {
+      "version": "1.6.0",
+      "resolved": "https://registry.npmjs.org/mime/-/mime-1.6.0.tgz",
+      "integrity": "sha512-x0Vn8spI+wuJ1O6S7gnbaQg8Pxh4NNHb7KSINmEWKiPE4RKOplvijn+NkmYmmRgP68mc70j2EbeTFRsrswaQeg==",
+      "license": "MIT",
+      "bin": {
+        "mime": "cli.js"
+      },
+      "engines": {
+        "node": ">=4"
+      }
+    },
     "node_modules/mime-db": {
-      "version": "1.54.0",
-      "resolved": "https://registry.npmjs.org/mime-db/-/mime-db-1.54.0.tgz",
-      "integrity": "sha512-aU5EJuIN2WDemCcAp2vFBfp/m4EAhWJnUNSSw0ixs7/kXbd6Pg64EmwJkNdFhB8aWt1sH2CTXrLxo/iAGV3oPQ==",
+      "version": "1.52.0",
+      "resolved": "https://registry.npmjs.org/mime-db/-/mime-db-1.52.0.tgz",
+      "integrity": "sha512-sPU4uV7dYlvtWJxwwxHD0PuihVNiE7TyAbQ5SWxDCB9mUYvOgroQOwYQQOKPJ8CIbE+1ETVlOoK1UC2nU3gYvg==",
       "license": "MIT",
       "engines": {
         "node": ">= 0.6"
       }
     },
     "node_modules/mime-types": {
-      "version": "3.0.2",
-      "resolved": "https://registry.npmjs.org/mime-types/-/mime-types-3.0.2.tgz",
-      "integrity": "sha512-Lbgzdk0h4juoQ9fCKXW4by0UJqj+nOOrI9MJ1sSj4nI8aI2eo1qmvQEie4VD1glsS250n15LsWsYtCugiStS5A==",
+      "version": "2.1.35",
+      "resolved": "https://registry.npmjs.org/mime-types/-/mime-types-2.1.35.tgz",
+      "integrity": "sha512-ZDY+bPm5zTTF+YpCrAU9nK0UgICYPT0QtT1NZWFv4s++TNkcgVaT0g6+4R2uI4MjQjzysHB1zxuWL50hzaeXiw==",
       "license": "MIT",
       "dependencies": {
-        "mime-db": "^1.54.0"
+        "mime-db": "1.52.0"
       },
       "engines": {
-        "node": ">=18"
-      },
-      "funding": {
-        "type": "opencollective",
-        "url": "https://opencollective.com/express"
+        "node": ">= 0.6"
       }
     },
     "node_modules/ms": {
@@ -1973,9 +2498,9 @@
       "license": "MIT"
     },
     "node_modules/negotiator": {
-      "version": "1.0.0",
-      "resolved": "https://registry.npmjs.org/negotiator/-/negotiator-1.0.0.tgz",
-      "integrity": "sha512-8Ofs/AUQh8MaEcrlq5xOX0CQ9ypTF5dl78mjlMNfOK08fzpgTHQRQPBxcPlEtIw0yRpws+Zo/3r+5WRby7u3Gg==",
+      "version": "0.6.3",
+      "resolved": "https://registry.npmjs.org/negotiator/-/negotiator-0.6.3.tgz",
+      "integrity": "sha512-+EUsqGPLsM+j/zdChZjsnX51g4XrHFOIXwfnCVPGlQk/k5giakcKsuxCObBRu6DSm9opw/O6slWbJdghQM4bBg==",
       "license": "MIT",
       "engines": {
         "node": ">= 0.6"
@@ -2103,14 +2628,10 @@
       }
     },
     "node_modules/path-to-regexp": {
-      "version": "8.4.2",
-      "resolved": "https://registry.npmjs.org/path-to-regexp/-/path-to-regexp-8.4.2.tgz",
-      "integrity": "sha512-qRcuIdP69NPm4qbACK+aDogI5CBDMi1jKe0ry5rSQJz8JVLsC7jV8XpiJjGRLLol3N+R5ihGYcrPLTno6pAdBA==",
-      "license": "MIT",
-      "funding": {
-        "type": "opencollective",
-        "url": "https://opencollective.com/express"
-      }
+      "version": "0.1.12",
+      "resolved": "https://registry.npmjs.org/path-to-regexp/-/path-to-regexp-0.1.12.tgz",
+      "integrity": "sha512-RA1GjUVMnvYFxuqovrEqZoxxW5NUZqbwKtYz/Tt7nXerk0LbLblQmrsgdeOxV5SFHf0UDggjS/bSeOZwt1pmEQ==",
+      "license": "MIT"
     },
     "node_modules/pkce-challenge": {
       "version": "5.0.1",
@@ -2144,13 +2665,12 @@
       }
     },
     "node_modules/qs": {
-      "version": "6.15.3",
-      "resolved": "https://registry.npmjs.org/qs/-/qs-6.15.3.tgz",
-      "integrity": "sha512-O9gl3zCl5h5blw1KGUzQKhA5oUXSl8rwUIM5o0S3nCXMliSvy5Dzx7/DJcI+SwgICv+IneSZwhBh1oSyEHA71A==",
+      "version": "6.13.0",
+      "resolved": "https://registry.npmjs.org/qs/-/qs-6.13.0.tgz",
+      "integrity": "sha512-+38qI9SOr8tfZ4QmJNplMUxqjbe7LKvvZgWdExBOmd+egZTtjLB67Gu0HRX3u/XOq7UU2Nx6nsjvS16Z9uwfpg==",
       "license": "BSD-3-Clause",
       "dependencies": {
-        "es-define-property": "^1.0.1",
-        "side-channel": "^1.1.1"
+        "side-channel": "^1.0.6"
       },
       "engines": {
         "node": ">=0.6"
@@ -2160,16 +2680,12 @@
       }
     },
     "node_modules/range-parser": {
-      "version": "1.3.0",
-      "resolved": "https://registry.npmjs.org/range-parser/-/range-parser-1.3.0.tgz",
-      "integrity": "sha512-hek2mFQpPuI4E1BBKrSto+BU3e3x4xuarsbiwr3+lf7p44juvFMV0XFWQAP3xUyqXA4RrXLIoaSUGbSt056ZMw==",
+      "version": "1.2.1",
+      "resolved": "https://registry.npmjs.org/range-parser/-/range-parser-1.2.1.tgz",
+      "integrity": "sha512-Hrgsx+orqoygnmhFbKaHE6c296J+HTAQXoxEF6gNupROmmGJRoyzfG3ccAveqCBrwr/2yxQ5BVd/GTl5agOwSg==",
       "license": "MIT",
       "engines": {
         "node": ">= 0.6"
-      },
-      "funding": {
-        "type": "opencollective",
-        "url": "https://opencollective.com/express"
       }
     },
     "node_modules/raw-body": {
@@ -2228,6 +2744,36 @@
         "node": ">= 18"
       }
     },
+    "node_modules/router/node_modules/path-to-regexp": {
+      "version": "8.4.2",
+      "resolved": "https://registry.npmjs.org/path-to-regexp/-/path-to-regexp-8.4.2.tgz",
+      "integrity": "sha512-qRcuIdP69NPm4qbACK+aDogI5CBDMi1jKe0ry5rSQJz8JVLsC7jV8XpiJjGRLLol3N+R5ihGYcrPLTno6pAdBA==",
+      "license": "MIT",
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/express"
+      }
+    },
+    "node_modules/safe-buffer": {
+      "version": "5.2.1",
+      "resolved": "https://registry.npmjs.org/safe-buffer/-/safe-buffer-5.2.1.tgz",
+      "integrity": "sha512-rp3So07KcdmmKbGvgaNxQSJr7bGVSVk5S9Eq1F+ppbRo70+YeaDxkw5Dd8NPN+GD6bjnYm2VuPuCXmpuYvmCXQ==",
+      "funding": [
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/feross"
+        },
+        {
+          "type": "patreon",
+          "url": "https://www.patreon.com/feross"
+        },
+        {
+          "type": "consulting",
+          "url": "https://feross.org/support"
+        }
+      ],
+      "license": "MIT"
+    },
     "node_modules/safer-buffer": {
       "version": "2.1.2",
       "resolved": "https://registry.npmjs.org/safer-buffer/-/safer-buffer-2.1.2.tgz",
@@ -2235,48 +2781,91 @@
       "license": "MIT"
     },
     "node_modules/send": {
-      "version": "1.2.1",
-      "resolved": "https://registry.npmjs.org/send/-/send-1.2.1.tgz",
-      "integrity": "sha512-1gnZf7DFcoIcajTjTwjwuDjzuz4PPcY2StKPlsGAQ1+YH20IRVrBaXSWmdjowTJ6u8Rc01PoYOGHXfP1mYcZNQ==",
+      "version": "0.19.0",
+      "resolved": "https://registry.npmjs.org/send/-/send-0.19.0.tgz",
+      "integrity": "sha512-dW41u5VfLXu8SJh5bwRmyYUbAoSB3c9uQh6L8h/KtsFREPWpbX1lrljJo186Jc4nmci/sGUZ9a0a0J2zgfq2hw==",
       "license": "MIT",
       "dependencies": {
-        "debug": "^4.4.3",
-        "encodeurl": "^2.0.0",
-        "escape-html": "^1.0.3",
-        "etag": "^1.8.1",
-        "fresh": "^2.0.0",
-        "http-errors": "^2.0.1",
-        "mime-types": "^3.0.2",
-        "ms": "^2.1.3",
-        "on-finished": "^2.4.1",
-        "range-parser": "^1.2.1",
-        "statuses": "^2.0.2"
+        "debug": "2.6.9",
+        "depd": "2.0.0",
+        "destroy": "1.2.0",
+        "encodeurl": "~1.0.2",
+        "escape-html": "~1.0.3",
+        "etag": "~1.8.1",
+        "fresh": "0.5.2",
+        "http-errors": "2.0.0",
+        "mime": "1.6.0",
+        "ms": "2.1.3",
+        "on-finished": "2.4.1",
+        "range-parser": "~1.2.1",
+        "statuses": "2.0.1"
       },
       "engines": {
-        "node": ">= 18"
+        "node": ">= 0.8.0"
+      }
+    },
+    "node_modules/send/node_modules/debug": {
+      "version": "2.6.9",
+      "resolved": "https://registry.npmjs.org/debug/-/debug-2.6.9.tgz",
+      "integrity": "sha512-bC7ElrdJaJnPbAP+1EotYvqZsb3ecl5wi6Bfi6BJTUcNowp6cvspg0jXznRTKDjm/E7AdgFBVeAPVMNcKGsHMA==",
+      "license": "MIT",
+      "dependencies": {
+        "ms": "2.0.0"
+      }
+    },
+    "node_modules/send/node_modules/debug/node_modules/ms": {
+      "version": "2.0.0",
+      "resolved": "https://registry.npmjs.org/ms/-/ms-2.0.0.tgz",
+      "integrity": "sha512-Tpp60P6IUJDTuOq/5Z8cdskzJujfwqfOTkrwIwj7IRISpnkJnT6SyJ4PCPnGMoFjC9ddhal5KVIYtAt97ix05A==",
+      "license": "MIT"
+    },
+    "node_modules/send/node_modules/encodeurl": {
+      "version": "1.0.2",
+      "resolved": "https://registry.npmjs.org/encodeurl/-/encodeurl-1.0.2.tgz",
+      "integrity": "sha512-TPJXq8JqFaVYm2CWmPvnP2Iyo4ZSM7/QKcSmuMLDObfpH5fi7RUGmd/rTDf+rut/saiDiQEeVTNgAmJEdAOx0w==",
+      "license": "MIT",
+      "engines": {
+        "node": ">= 0.8"
+      }
+    },
+    "node_modules/send/node_modules/http-errors": {
+      "version": "2.0.0",
+      "resolved": "https://registry.npmjs.org/http-errors/-/http-errors-2.0.0.tgz",
+      "integrity": "sha512-FtwrG/euBzaEjYeRqOgly7G0qviiXoJWnvEH2Z1plBdXgbyjv34pHTSb9zoeHMyDy33+DWy5Wt9Wo+TURtOYSQ==",
+      "license": "MIT",
+      "dependencies": {
+        "depd": "2.0.0",
+        "inherits": "2.0.4",
+        "setprototypeof": "1.2.0",
+        "statuses": "2.0.1",
+        "toidentifier": "1.0.1"
       },
-      "funding": {
-        "type": "opencollective",
-        "url": "https://opencollective.com/express"
+      "engines": {
+        "node": ">= 0.8"
+      }
+    },
+    "node_modules/send/node_modules/statuses": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/statuses/-/statuses-2.0.1.tgz",
+      "integrity": "sha512-RwNA9Z/7PrK06rYLIzFMlaF+l73iwpzsqRIFgbMLbTcLD6cOao82TaWefPXQvB2fOC4AjuYSEndS7N/mTCbkdQ==",
+      "license": "MIT",
+      "engines": {
+        "node": ">= 0.8"
       }
     },
     "node_modules/serve-static": {
-      "version": "2.2.1",
-      "resolved": "https://registry.npmjs.org/serve-static/-/serve-static-2.2.1.tgz",
-      "integrity": "sha512-xRXBn0pPqQTVQiC8wyQrKs2MOlX24zQ0POGaj0kultvoOCstBQM5yvOhAVSUwOMjQtTvsPWoNCHfPGwaaQJhTw==",
+      "version": "1.16.2",
+      "resolved": "https://registry.npmjs.org/serve-static/-/serve-static-1.16.2.tgz",
+      "integrity": "sha512-VqpjJZKadQB/PEbEwvFdO43Ax5dFBZ2UECszz8bQ7pi7wt//PWe1P6MN7eCnjsatYtBT6EuiClbjSWP2WrIoTw==",
       "license": "MIT",
       "dependencies": {
-        "encodeurl": "^2.0.0",
-        "escape-html": "^1.0.3",
-        "parseurl": "^1.3.3",
-        "send": "^1.2.0"
+        "encodeurl": "~2.0.0",
+        "escape-html": "~1.0.3",
+        "parseurl": "~1.3.3",
+        "send": "0.19.0"
       },
       "engines": {
-        "node": ">= 18"
-      },
-      "funding": {
-        "type": "opencollective",
-        "url": "https://opencollective.com/express"
+        "node": ">= 0.8.0"
       }
     },
     "node_modules/setprototypeof": {
@@ -2416,34 +3005,16 @@
       }
     },
     "node_modules/type-is": {
-      "version": "2.1.1",
-      "resolved": "https://registry.npmjs.org/type-is/-/type-is-2.1.0.tgz",
-      "integrity": "sha512-faYHw0anBbc/kWF3zFTEnxSFOAGUX9GFbOBthvDdLsIlEoWOFOtS0zgCiQYwIskL9iGXZL3kAXD8OoZ4GmMATA==",
+      "version": "1.6.18",
+      "resolved": "https://registry.npmjs.org/type-is/-/type-is-1.6.18.tgz",
+      "integrity": "sha512-TkRKr9sUTxEH8MdfuCSP7VizJyzRNMjj2J2do2Jr3Kym598JVdEksuzPQCnlFPW4ky9Q+iA+ma9BGm06XQBy8g==",
       "license": "MIT",
       "dependencies": {
-        "content-type": "^2.0.0",
-        "media-typer": "^1.1.0",
-        "mime-types": "^3.0.0"
-      },
-      "engines": {
-        "node": ">= 18"
+        "media-typer": "0.3.0",
+        "mime-types": "~2.1.24"
       },
-      "funding": {
-        "type": "opencollective",
-        "url": "https://opencollective.com/express"
-      }
-    },
-    "node_modules/type-is/node_modules/content-type": {
-      "version": "2.0.0",
-      "resolved": "https://registry.npmjs.org/content-type/-/content-type-2.0.0.tgz",
-      "integrity": "sha512-j/O/d7GcZCyNl7/hwZAb606rzqkyvaDctLmckbxLzHvFBzTJHuGEdodATcP3yIRoDrLHkIATJuvzbFlp/ki2cQ==",
-      "license": "MIT",
       "engines": {
-        "node": ">=18"
-      },
-      "funding": {
-        "type": "opencollective",
-        "url": "https://opencollective.com/express"
+        "node": ">= 0.6"
       }
     },
     "node_modules/typescript": {
@@ -2506,6 +3077,15 @@
         "node": ">= 0.8"
       }
     },
+    "node_modules/utils-merge": {
+      "version": "1.0.1",
+      "resolved": "https://registry.npmjs.org/utils-merge/-/utils-merge-1.0.1.tgz",
+      "integrity": "sha512-pMZTvIkT1d+TFGvDOqodOclx0QWkkgi6Tdoa8gC8ffGAAqz9pzPTZWAybbsHHoED/ztMtkv/VoYTYyShUn81hA==",
+      "license": "MIT",
+      "engines": {
+        "node": ">= 0.4.0"
+      }
+    },
     "node_modules/vary": {
       "version": "1.1.2",
       "resolved": "https://registry.npmjs.org/vary/-/vary-1.1.2.tgz",
diff --git a/package.json b/package.json
index a4d8f20..b0fa531 100644
--- a/package.json
+++ b/package.json
@@ -17,9 +17,11 @@
     "axios": "^1.19.0",
     "cheerio": "^1.2.0",
     "dotenv": "^17.4.2",
+    "express": "4.21.2",
     "zod": "^4.4.3"
   },
   "devDependencies": {
+    "@types/express": "^5.0.6",
     "@types/node": "^26.1.2",
     "tsx": "^4.23.4",
     "typescript": "^7.0.2"
diff --git a/src/server.ts b/src/server.ts
index 6e320ba..e066ff0 100644
--- a/src/server.ts
+++ b/src/server.ts
@@ -2,6 +2,9 @@ import dotenv from "dotenv";
 import { z } from "zod";
 import { Server } from "@modelcontextprotocol/sdk/server/index.js";
 import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
+import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
+import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
+import express, { type Request, type Response } from "express";
 import { browshManager } from "./browshManager.js";
 import { toFetchErrorMessage } from "./errors.js";
 import {
@@ -246,7 +249,7 @@ async function route(name: ToolName, args: unknown): Promise<string> {
   }
 }
 
-async function runServer() {
+async function createServer() {
   const server = new Server(
     {
       name: "blowsh-mcp",
@@ -274,6 +277,165 @@ async function runServer() {
     }
   });
 
+  return server;
+}
+
+function resolvePort(raw: string | undefined, fallback: number): number {
+  if (raw === undefined || raw === "") {
+    return fallback;
+  }
+  const parsed = Number(raw);
+  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
+    console.error(`Invalid MCP_PORT="${raw}", falling back to ${fallback}`);
+    return fallback;
+  }
+  return parsed;
+}
+
+async function runHttpServer() {
+  const host = process.env.MCP_HOST ?? "127.0.0.1";
+  const port = resolvePort(process.env.MCP_PORT, 8107);
+  const app = express();
+  app.use(express.json({ limit: "4mb" }));
+
+  // Stateless streamable HTTP: one transport per request, shared tool
+  // backends (browshManager singleton) underneath. Safe for concurrent
+  // sessions — no per-client state is kept.
+  app.post("/mcp", async (req: Request, res: Response) => {
+    const transport = new StreamableHTTPServerTransport({
+      sessionIdGenerator: undefined,
+    });
+    const server = await createServer();
+    res.on("close", () => {
+      void transport.close().catch(() => undefined);
+      void server.close().catch(() => undefined);
+    });
+    try {
+      await server.connect(transport);
+      await transport.handleRequest(req, res, req.body);
+    } catch (error) {
+      console.error("Error handling MCP request:", error);
+      if (!res.headersSent) {
+        res.status(500).json({
+          jsonrpc: "2.0",
+          error: { code: -32603, message: "Internal server error" },
+          id: null,
+        });
+      }
+    }
+  });
+
+  app.get("/mcp", async (_req: Request, res: Response) => {
+    res.status(405).json({
+      jsonrpc: "2.0",
+      error: { code: -32000, message: "Method not allowed (stateless mode)." },
+      id: null,
+    });
+  });
+
+  app.delete("/mcp", async (_req: Request, res: Response) => {
+    res.status(405).json({
+      jsonrpc: "2.0",
+      error: { code: -32000, message: "Method not allowed (stateless mode)." },
+      id: null,
+    });
+  });
+
+  app.get("/health", (_req: Request, res: Response) => {
+    res.status(200).json({ status: "ok", transport: "streamable-http" });
+  });
+
+  await new Promise<void>((resolve) => {
+    app.listen(port, host, () => {
+      console.error(`blowsh-mcp MCP server running on streamable HTTP at http://${host}:${port}/mcp`);
+      resolve();
+    });
+  });
+}
+
+async function runSseServer() {
+  const host = process.env.MCP_HOST ?? "127.0.0.1";
+  const port = resolvePort(process.env.MCP_PORT, 8108);
+  const app = express();
+  app.use(express.json({ limit: "4mb" }));
+  const transports: Record<string, SSEServerTransport> = {};
+
+  // Legacy SSE: one stateful transport per client session. Kept for
+  // clients that cannot speak streamable HTTP (deprecated upstream
+  // in the MCP SDK, but still required by some hosts).
+  app.get("/sse", async (_req: Request, res: Response) => {
+    const server = await createServer();
+    try {
+      const transport = new SSEServerTransport("/messages", res);
+      transports[transport.sessionId] = transport;
+      res.on("close", () => {
+        delete transports[transport.sessionId];
+        void server.close().catch(() => undefined);
+      });
+      await server.connect(transport);
+    } catch (error) {
+      console.error("Error handling SSE session:", error);
+      void server.close().catch(() => undefined);
+      if (!res.headersSent) {
+        res.status(500).json({
+          jsonrpc: "2.0",
+          error: { code: -32603, message: "Internal server error" },
+          id: null,
+        });
+      }
+    }
+  });
+
+  app.post("/messages", async (req: Request, res: Response) => {
+    const sessionId = String(req.query.sessionId ?? "");
+    const transport = transports[sessionId];
+    if (!transport) {
+      res.status(400).json({
+        jsonrpc: "2.0",
+        error: { code: -32000, message: "No such SSE session." },
+        id: null,
+      });
+      return;
+    }
+    try {
+      await transport.handlePostMessage(req, res, req.body);
+    } catch (error) {
+      console.error("Error handling SSE message:", error);
+      if (!res.headersSent) {
+        res.status(500).json({
+          jsonrpc: "2.0",
+          error: { code: -32603, message: "Internal server error" },
+          id: null,
+        });
+      }
+    }
+  });
+
+  app.get("/health", (_req: Request, res: Response) => {
+    res.status(200).json({ status: "ok", transport: "sse" });
+  });
+
+  await new Promise<void>((resolve) => {
+    app.listen(port, host, () => {
+      console.error(`blowsh-mcp MCP server running on legacy SSE at http://${host}:${port}/sse`);
+      resolve();
+    });
+  });
+}
+
+async function runServer() {
+  const transportMode = (process.env.MCP_TRANSPORT ?? "stdio").toLowerCase();
+  if (transportMode === "http" || transportMode === "streamable-http") {
+    await runHttpServer();
+    return;
+  }
+  if (transportMode === "sse") {
+    await runSseServer();
+    return;
+  }
+
+  const server = await createServer();
+
   const transport = new StdioServerTransport();
   await server.connect(transport);
   console.error("blowsh-mcp MCP server running on stdio");
```
<!-- END_GIT_DIFF -->
