Env var quirks (v2.1):
- PDF_MAX_BYTES (default 20971520): max PDF size for fetch_web type: pdf; enforced via Content-Length AND streaming; requires poppler-utils (pdftotext) in the image.
- BROWSH_RECYCLE_REQUESTS (default 100): browsh process recycled after N requests; recycling fires ONLY in quiescent windows (busy=false, waiting=0) via setImmediate deferral, never mid-request.
- BROWSH_IDLE_TIMEOUT_MS (default 600000): idle time before browser kill + pageCache.clear().
- BROWSH_FIREFOX_PATH must be the absolute path (/usr/bin/firefox-esr) in container images — bare "firefox-esr" fails Browsh's lookup.
- Recycling/teardown kills the whole process group (detached spawn); SIGTERM to browsh ALONE orphans Firefox and blocks restarts with the profile lock.
- Docker run for MCP must include -i (interactive) to keep stdin open.