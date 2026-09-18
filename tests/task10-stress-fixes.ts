// Task 10 regression tests: D1 batch/timeout, D2 archive classification, D3 deadline.
// Run: npx tsx tests/task10-stress-fixes.ts (no network, no Browsh needed)
import assert from "node:assert";
import { FetchError, createDeadlineError, isDeadlineHitError, DEADLINE_HIT_CODE } from "../src/errors.js";
import { isHardFailure, classifyWaybackAvailability, classifySnapshotBody } from "../src/tools/fetchWeb.js";
import { isEmptyResultDeadline } from "../src/tools/searchWeb.js";
import { fetchWebBatch } from "../src/tools/fetchWebBatch.js";

let passed = 0;
const pending: Promise<void>[] = [];
function check(name: string, fn: () => void | Promise<void>): void {
  pending.push(
    (async () => {
      await fn();
      passed++;
      console.log(`ok - ${name}`);
    })()
  );
}

// --- D2: isHardFailure classification ---
check("404 FetchError is hard", () => {
  assert.strictEqual(isHardFailure(new FetchError("Request failed with status 404", { statusCode: 404 })), true);
});
check("Browsh 30s abort string is hard", () => {
  assert.strictEqual(isHardFailure(new FetchError("Browsh rendering aborted after 30s timeout", {})), true);
});
check("axios timeout transport error is hard", () => {
  assert.strictEqual(isHardFailure(new FetchError("Request failed: timeout of 30000ms exceeded", {})), true);
});
check("deadline.hit is NOT hard (no archive rescue, documented)", () => {
  assert.strictEqual(isHardFailure(createDeadlineError("deadline.hit: fetch timed out after 500ms for https://x", "https://x")), false);
});
check("generic Error is not hard", () => {
  assert.strictEqual(isHardFailure(new Error("boom")), false);
});

// --- D2: Wayback availability classifier ---
check("available snapshot is hit", () => {
  assert.strictEqual(
    classifyWaybackAvailability({ archived_snapshots: { closest: { available: true, url: "https://web.archive.org/web/20240101/https://example.com" } } }),
    "hit"
  );
});
check("available:false is no-snapshot", () => {
  assert.strictEqual(classifyWaybackAvailability({ archived_snapshots: { closest: { available: false } } }), "no-snapshot");
});
check("missing payload is no-snapshot", () => {
  assert.strictEqual(classifyWaybackAvailability({}), "no-snapshot");
});
check("non-archive host is no-snapshot", () => {
  assert.strictEqual(
    classifyWaybackAvailability({ archived_snapshots: { closest: { available: true, url: "https://evil.example/snap" } } }),
    "no-snapshot"
  );
});

// --- shared deadline error shape (typed FetchError.code, no casts) ---
check("deadline error carries stable code", () => {
  const e = createDeadlineError("deadline.hit: search timed out after 500ms (query: q)");
  assert.strictEqual(isDeadlineHitError(e), true);
  assert.strictEqual(e.code, DEADLINE_HIT_CODE);
  assert.strictEqual(isDeadlineHitError(new FetchError("other", {})), false);
  assert.strictEqual(isDeadlineHitError(new Error("x")), false);
});
check("deadline error with url keeps url + code", () => {
  const e = createDeadlineError("deadline.hit: fetch timed out after 500ms for https://x", "https://x");
  assert.strictEqual(e.url, "https://x");
  assert.strictEqual(e.code, DEADLINE_HIT_CODE);
  assert.strictEqual(isDeadlineHitError(e), true);
});

// --- F1: snapshot-body classifier (nested boundary kinds) ---
check("usable snapshot body is hit", () => {
  assert.strictEqual(classifySnapshotBody(5000), "hit");
});
check("empty snapshot body is snapshot-fetch-failed, not api-error", () => {
  assert.strictEqual(classifySnapshotBody(0), "snapshot-fetch-failed");
});
check("tiny snapshot body is snapshot-fetch-failed", () => {
  assert.strictEqual(classifySnapshotBody(199), "snapshot-fetch-failed");
});

// --- D3: empty-result deadline precedence ---
check("aborted + empty + no instant answer + deadline = deadline", () => {
  assert.strictEqual(isEmptyResultDeadline(true, 0, false, 500), true);
});
check("not aborted = ordinary empty", () => {
  assert.strictEqual(isEmptyResultDeadline(false, 0, false, 500), false);
});
check("instant answer present = not deadline", () => {
  assert.strictEqual(isEmptyResultDeadline(true, 0, true, 500), false);
});
check("no deadline set = not deadline", () => {
  assert.strictEqual(isEmptyResultDeadline(true, 0, false, undefined), false);
});
check("non-empty merge = not deadline", () => {
  assert.strictEqual(isEmptyResultDeadline(true, 3, false, 500), false);
});

// --- D1: batch validation + offline per-URL isolation ---
check("empty urls throws", async () => {
  await assert.rejects(() => fetchWebBatch({ urls: [], type: "markdown" }), FetchError);
});
check("11 urls throws", async () => {
  await assert.rejects(
    () => fetchWebBatch({ urls: Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`), type: "markdown" }),
    FetchError
  );
});
check("SSRF-blocked items isolate per-URL (offline)", async () => {
  const items = await fetchWebBatch({
    urls: ["http://127.0.0.1:4333/", "http://localhost:9/"],
    type: "markdown",
    deadline_ms: 5000,
  });
  assert.strictEqual(items.length, 2);
  for (const [i, u] of ["http://127.0.0.1:4333/", "http://localhost:9/"].entries()) {
    assert.strictEqual(items[i].url, u);
    assert.strictEqual(items[i].ok, false);
    assert.ok(items[i].error && items[i].error.length > 0, "error text present");
  }
});

await Promise.all(pending);
console.log(`\n${passed} checks passed`);
