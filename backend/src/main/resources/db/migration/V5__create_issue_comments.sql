-- Issue comments with retained tombstones.
--
-- A comment is either an active comment (deleted = FALSE, body present,
-- non-blank, at most 5000 characters) or a tombstone (deleted = TRUE,
-- body = NULL). Deletion is a logical tombstone; the row is never removed so
-- activity ordering and the original author, issue and timestamps remain
-- understandable. No cascade is configured so deleting a user or project never
-- erases comment history unexpectedly.
CREATE TABLE issue_comment (
	id UUID NOT NULL,
	issue_id UUID NOT NULL,
	author_id UUID NOT NULL,
	body TEXT,
	deleted BOOLEAN NOT NULL DEFAULT FALSE,
	created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	version BIGINT NOT NULL DEFAULT 0,
	CONSTRAINT pk_issue_comment PRIMARY KEY (id),
	CONSTRAINT ck_issue_comment_state CHECK (
		(deleted = FALSE AND body IS NOT NULL AND btrim(body) <> '' AND char_length(body) <= 5000)
		OR (deleted = TRUE AND body IS NULL)
	),
	CONSTRAINT ck_issue_comment_version_non_negative CHECK (version >= 0),
	CONSTRAINT fk_issue_comment_issue FOREIGN KEY (issue_id) REFERENCES issue (id),
	CONSTRAINT fk_issue_comment_author FOREIGN KEY (author_id) REFERENCES user_account (id)
);

-- Issue comment listing is ordered by created_at then id.
CREATE INDEX ix_issue_comment_issue_created_id
	ON issue_comment (issue_id, created_at, id);
