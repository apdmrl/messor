package io.github.apdmrl.messor.issue;

/**
 * The locked set of issue types supported by the MVP. The V4 schema check
 * constraint {@code ck_issue_type} mirrors exactly these values.
 */
public enum IssueType {

	STORY,
	TASK,
	BUG

}
