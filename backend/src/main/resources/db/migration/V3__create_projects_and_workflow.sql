CREATE TABLE project (
	id UUID NOT NULL,
	key VARCHAR(10) NOT NULL,
	name VARCHAR(120) NOT NULL,
	description VARCHAR(2000),
	creator_id UUID NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	version BIGINT NOT NULL DEFAULT 0,
	CONSTRAINT pk_project PRIMARY KEY (id),
	CONSTRAINT uq_project_key UNIQUE (key),
	CONSTRAINT ck_project_key_normalized CHECK (key = upper(btrim(key))),
	CONSTRAINT ck_project_key_regex CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
	CONSTRAINT ck_project_name_not_blank CHECK (btrim(name) <> ''),
	CONSTRAINT ck_project_version_non_negative CHECK (version >= 0),
	CONSTRAINT fk_project_creator FOREIGN KEY (creator_id) REFERENCES user_account (id)
);

CREATE TABLE project_member (
	id UUID NOT NULL,
	project_id UUID NOT NULL,
	user_account_id UUID NOT NULL,
	role VARCHAR(32) NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	version BIGINT NOT NULL DEFAULT 0,
	CONSTRAINT pk_project_member PRIMARY KEY (id),
	CONSTRAINT uq_project_member_project_user UNIQUE (project_id, user_account_id),
	CONSTRAINT ck_project_member_role CHECK (role IN ('PROJECT_LEAD', 'MEMBER', 'VIEWER')),
	CONSTRAINT ck_project_member_version_non_negative CHECK (version >= 0),
	CONSTRAINT fk_project_member_project FOREIGN KEY (project_id) REFERENCES project (id),
	CONSTRAINT fk_project_member_user FOREIGN KEY (user_account_id) REFERENCES user_account (id)
);

CREATE INDEX ix_project_member_project_id ON project_member (project_id);
CREATE INDEX ix_project_member_user_account_id ON project_member (user_account_id);

CREATE TABLE workflow_status (
	id UUID NOT NULL,
	project_id UUID NOT NULL,
	code VARCHAR(32) NOT NULL,
	display_name VARCHAR(120) NOT NULL,
	position INTEGER NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	version BIGINT NOT NULL DEFAULT 0,
	CONSTRAINT pk_workflow_status PRIMARY KEY (id),
	CONSTRAINT uq_workflow_status_project_code UNIQUE (project_id, code),
	CONSTRAINT uq_workflow_status_project_position UNIQUE (project_id, position),
	CONSTRAINT ck_workflow_status_code CHECK (code IN ('TO_DO', 'IN_PROGRESS', 'DONE')),
	CONSTRAINT ck_workflow_status_display_name_not_blank CHECK (btrim(display_name) <> ''),
	CONSTRAINT ck_workflow_status_position_non_negative CHECK (position >= 0),
	CONSTRAINT ck_workflow_status_version_non_negative CHECK (version >= 0),
	CONSTRAINT fk_workflow_status_project FOREIGN KEY (project_id) REFERENCES project (id)
);

CREATE INDEX ix_workflow_status_project_id ON workflow_status (project_id);
