-- Candidate key on workflow_status so issue can reference (project_id, id).
ALTER TABLE workflow_status
	ADD CONSTRAINT uq_workflow_status_project_id UNIQUE (project_id, id);

CREATE TABLE project_issue_counter (
	project_id UUID NOT NULL,
	next_number BIGINT NOT NULL DEFAULT 1,
	version BIGINT NOT NULL DEFAULT 0,
	CONSTRAINT pk_project_issue_counter PRIMARY KEY (project_id),
	CONSTRAINT ck_project_issue_counter_next_number_positive CHECK (next_number > 0),
	CONSTRAINT ck_project_issue_counter_version_non_negative CHECK (version >= 0),
	CONSTRAINT fk_project_issue_counter_project FOREIGN KEY (project_id) REFERENCES project (id)
);

CREATE TABLE issue (
	id UUID NOT NULL,
	project_id UUID NOT NULL,
	number BIGINT NOT NULL,
	human_key VARCHAR(32) NOT NULL,
	type VARCHAR(32) NOT NULL,
	title VARCHAR(200) NOT NULL,
	description VARCHAR(10000),
	workflow_status_id UUID NOT NULL,
	reporter_id UUID NOT NULL,
	assignee_id UUID,
	rank BIGINT NOT NULL,
	archived BOOLEAN NOT NULL DEFAULT FALSE,
	created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	version BIGINT NOT NULL DEFAULT 0,
	CONSTRAINT pk_issue PRIMARY KEY (id),
	CONSTRAINT uq_issue_project_number UNIQUE (project_id, number),
	CONSTRAINT uq_issue_human_key UNIQUE (human_key),
	CONSTRAINT ck_issue_type CHECK (type IN ('STORY', 'TASK', 'BUG')),
	CONSTRAINT ck_issue_number_positive CHECK (number > 0),
	CONSTRAINT ck_issue_human_key_format CHECK (human_key ~ '^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]*$'),
	CONSTRAINT ck_issue_title_not_blank CHECK (btrim(title) <> ''),
	CONSTRAINT ck_issue_rank_positive CHECK (rank > 0),
	CONSTRAINT ck_issue_version_non_negative CHECK (version >= 0),
	CONSTRAINT fk_issue_project FOREIGN KEY (project_id) REFERENCES project (id),
	CONSTRAINT fk_issue_reporter FOREIGN KEY (reporter_id) REFERENCES user_account (id),
	CONSTRAINT fk_issue_assignee FOREIGN KEY (assignee_id) REFERENCES user_account (id),
	CONSTRAINT fk_issue_workflow_status FOREIGN KEY (project_id, workflow_status_id)
		REFERENCES workflow_status (project_id, id)
);

CREATE TABLE issue_activity (
	id UUID NOT NULL,
	issue_id UUID NOT NULL,
	actor_id UUID NOT NULL,
	type VARCHAR(32) NOT NULL,
	summary JSONB NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT pk_issue_activity PRIMARY KEY (id),
	CONSTRAINT ck_issue_activity_type CHECK (type IN ('CREATED', 'UPDATED', 'MOVED', 'ARCHIVED')),
	CONSTRAINT fk_issue_activity_issue FOREIGN KEY (issue_id) REFERENCES issue (id),
	CONSTRAINT fk_issue_activity_actor FOREIGN KEY (actor_id) REFERENCES user_account (id)
);

CREATE INDEX ix_issue_project_status_archived_rank
	ON issue (project_id, workflow_status_id, archived, rank);
CREATE INDEX ix_issue_project_archived_number
	ON issue (project_id, archived, number);
CREATE INDEX ix_issue_assignee_archived
	ON issue (assignee_id, archived);
CREATE INDEX ix_issue_activity_issue_created_id
	ON issue_activity (issue_id, created_at, id);
