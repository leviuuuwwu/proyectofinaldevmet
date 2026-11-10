-- 002: per-document lookup of unprocessed outbox events (index-status, indexer cleanup).
-- Expand-only: compatible with the previous image.
CREATE INDEX outbox_doc_pending_idx ON outbox (doc_id) WHERE processed_at IS NULL;
