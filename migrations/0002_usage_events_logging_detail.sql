-- Adds logging detail to usage_events for debugging slow or flaky
-- facilitators in production. Applied directly to the live D1 database
-- (faster than waiting on a deploy pipeline); committed here so a fresh
-- environment stays in sync.
--
-- duration_ms:               total evaluateRequest wall time
-- facilitator_latency_ms:    time spent specifically in facilitator
--                            /verify (+/settle when both happen)
-- facilitator_http_status:   HTTP status the facilitator responded with
-- facilitator_url:           which facilitator was actually used
--                            (auto-resolved via internal_tokens or
--                            explicit facilitator_url)
--
-- Only populated for calls that reach a facilitator or run through
-- evaluateRequest's timed paths; older rows and evaluate_request calls
-- that never touch a facilitator (unprotected, free, challenge_402
-- fast paths) will have NULL for the facilitator_* columns, and older
-- rows will have NULL for duration_ms too. That's expected, not a bug.

ALTER TABLE usage_events ADD COLUMN duration_ms INTEGER;
ALTER TABLE usage_events ADD COLUMN facilitator_latency_ms INTEGER;
ALTER TABLE usage_events ADD COLUMN facilitator_http_status INTEGER;
ALTER TABLE usage_events ADD COLUMN facilitator_url TEXT;
