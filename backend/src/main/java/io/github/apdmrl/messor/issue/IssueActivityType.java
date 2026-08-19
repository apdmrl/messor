package io.github.apdmrl.messor.issue;

/**
 * The locked set of issue activity types supported by the MVP. The V4 schema
 * check constraint {@code ck_issue_activity_type} mirrors exactly these values.
 */
public enum IssueActivityType {

	CREATED,
	UPDATED,
	MOVED,
	ARCHIVED

}
