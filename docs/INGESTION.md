# Future ingestion contract — disabled

The MVP exposes no `/api/ingest` endpoint. A future Apple Shortcut, Android share target, browser extension, or bookmarklet may call `POST /api/ingest` only with a revocable owner-issued token, HTTPS, strict image byte/pixel limits, MIME decoding, rate limits, replay protection, and the same capture service used by `/add`. It must never accept a Drive URL as an instruction to fetch remote content, never bypass owner authorization, and never become anonymous.
