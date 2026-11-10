-- 001_init: catalog (source of truth), outbox, index state, search index and rebuild jobs.
-- Migrations follow expand/contract so the previous image keeps working (rollback, 5.7).

-- Source of truth. version increments on every write.
CREATE TABLE documents (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
	description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
	tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 10),
	category text NOT NULL CHECK (char_length(category) BETWEEN 1 AND 50),
	date timestamptz NOT NULL,
	status text NOT NULL CHECK (status IN ('draft', 'published', 'unpublished')),
	version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

-- Written in the same transaction as documents. traceparent links the indexer span to the API span.
CREATE TABLE outbox (
	id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	doc_id uuid NOT NULL REFERENCES documents (id),
	version integer NOT NULL,
	op text NOT NULL CHECK (op IN ('upsert', 'delete')),
	traceparent text,
	created_at timestamptz NOT NULL DEFAULT now(),
	processed_at timestamptz,
	attempts integer NOT NULL DEFAULT 0,
	last_error text
);
CREATE INDEX outbox_pending_idx ON outbox (id) WHERE processed_at IS NULL;

-- Last version applied to the index per document (kept even when unpublished).
CREATE TABLE index_state (
	doc_id uuid PRIMARY KEY REFERENCES documents (id),
	indexed_version integer NOT NULL,
	indexed_at timestamptz NOT NULL DEFAULT now(),
	last_error text
);

-- Derived index: published documents only. Rebuilt via search_documents_shadow + atomic swap.
CREATE TABLE search_documents (
	id uuid PRIMARY KEY,
	version integer NOT NULL,
	title text NOT NULL,
	description text NOT NULL,
	tags text[] NOT NULL,
	category text NOT NULL,
	published_at timestamptz NOT NULL,
	tsv tsvector GENERATED ALWAYS AS (
		setweight(to_tsvector('spanish', title), 'A') ||
		setweight(to_tsvector('spanish', description), 'B')
	) STORED
);
CREATE INDEX search_documents_tsv_idx ON search_documents USING gin (tsv);
CREATE INDEX search_documents_tags_idx ON search_documents USING gin (tags);
CREATE INDEX search_documents_category_idx ON search_documents (category);
CREATE INDEX search_documents_order_idx ON search_documents (published_at DESC, id);

CREATE TABLE reindex_jobs (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	state text NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed')),
	requested_by text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	started_at timestamptz,
	finished_at timestamptz,
	documents integer,
	error text
);
-- At most one active rebuild.
CREATE UNIQUE INDEX reindex_jobs_one_active_idx ON reindex_jobs ((true))
	WHERE state IN ('queued', 'running');
