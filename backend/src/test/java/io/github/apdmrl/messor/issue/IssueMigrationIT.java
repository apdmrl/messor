package io.github.apdmrl.messor.issue;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import javax.sql.DataSource;

import io.github.apdmrl.messor.support.PostgresIntegrationTestSupport;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.postgresql.util.PSQLException;
import org.postgresql.util.ServerErrorMessage;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * RED-phase migration contract test for the locked V4 schema (issues/activity).
 *
 * <p>This test asserts the exact schema contract that V4 must implement. In the
 * current RED phase V4 does not exist yet, so every schema/constraint/index
 * assertion is expected to fail with a schema-absence error rather than a
 * broken fixture.</p>
 *
 * <p>No production classes are referenced. All fixtures are synthetic and
 * transaction-safe JDBC inserts using random UUIDs and safe values. No
 * passwords, tokens, cookies or secrets are used or logged.</p>
 */
class IssueMigrationIT extends PostgresIntegrationTestSupport {

	@Autowired
	private DataSource dataSource;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@BeforeEach
	void cleanChildRows() {
		cleanupIssueRows();
	}

	@AfterEach
	void cleanChildRowsAfter() {
		cleanupIssueRows();
	}

	// ------------------------------------------------------------------
	// Flyway
	// ------------------------------------------------------------------

	@Test
	void v4MigrationIsRecordedAsSuccessful() {
		Integer count = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM flyway_schema_history WHERE version = '4' AND success = true",
				Integer.class);
		assertThat(count).isEqualTo(1);
	}

	@Test
	void v4MigrationDescriptionIsExact() {
		String description = jdbcTemplate.queryForObject(
				"SELECT description FROM flyway_schema_history WHERE version = '4'",
				String.class);
		assertThat(description).isEqualTo("create issues and activity");
	}

	// ------------------------------------------------------------------
	// project_issue_counter
	// ------------------------------------------------------------------

	@Test
	void projectIssueCounterTableHasExpectedColumns() {
		assertThat(tableExists("project_issue_counter")).isTrue();

		assertColumn("project_issue_counter", "project_id", "uuid", "NO", null);
		assertColumn("project_issue_counter", "next_number", "bigint", "NO", null);
		assertColumn("project_issue_counter", "version", "bigint", "NO", null);
	}

	@Test
	void projectIssueCounterProjectIdIsThePrimaryKey() {
		assertThat(primaryKeyColumn("project_issue_counter")).isEqualTo("project_id");
	}

	@Test
	void projectIssueCounterReferencesProjectExactly() {
		assertForeignKey("project_issue_counter", "fk_project_issue_counter_project",
				List.of("project_id"), "project", List.of("id"));
	}

	@Test
	void projectIssueCounterNextNumberMustBePositive() {
		UUID creator = insertUser("counter-next@example.com");
		UUID project = insertProject("COUNTER1", "Counter", creator);

		assertThatThrownBy(() -> insertCounter(project, 0L))
				.satisfies(thrown -> assertConstraintViolation(thrown, "ck_project_issue_counter_next_number_positive"));
		assertThatThrownBy(() -> insertCounter(project, -5L))
				.satisfies(thrown -> assertConstraintViolation(thrown, "ck_project_issue_counter_next_number_positive"));
	}

	@Test
	void projectIssueCounterVersionCannotBeNegative() {
		UUID creator = insertUser("counter-version@example.com");
		UUID project = insertProject("COUNTER2", "Counter", creator);

		assertThatThrownBy(() -> insertCounter(project, 1L, -1L))
				.satisfies(thrown -> assertConstraintViolation(thrown, "ck_project_issue_counter_version_non_negative"));
	}

	@Test
	void projectIssueCounterDefaultsAreApplied() {
		UUID creator = insertUser("counter-defaults@example.com");
		UUID project = insertProject("COUNTER3", "Counter", creator);

		insertCounter(project);

		Map<String, Object> row = jdbcTemplate.queryForMap(
				"SELECT next_number, version FROM project_issue_counter WHERE project_id = ?",
				project);
		assertThat(row.get("next_number")).isEqualTo(1L);
		assertThat(row.get("version")).isEqualTo(0L);
	}

	// ------------------------------------------------------------------
	// issue table columns
	// ------------------------------------------------------------------

	@Test
	void issueTableHasExpectedColumns() {
		assertThat(tableExists("issue")).isTrue();

		assertColumn("issue", "id", "uuid", "NO", null);
		assertColumn("issue", "project_id", "uuid", "NO", null);
		assertColumn("issue", "number", "bigint", "NO", null);
		assertColumn("issue", "human_key", "character varying", "NO", 32);
		assertColumn("issue", "type", "character varying", "NO", 32);
		assertColumn("issue", "title", "character varying", "NO", 200);
		assertColumn("issue", "description", "character varying", "YES", 10000);
		assertColumn("issue", "workflow_status_id", "uuid", "NO", null);
		assertColumn("issue", "reporter_id", "uuid", "NO", null);
		assertColumn("issue", "assignee_id", "uuid", "YES", null);
		assertColumn("issue", "rank", "bigint", "NO", null);
		assertColumn("issue", "archived", "boolean", "NO", null);
		assertColumn("issue", "created_at", "timestamp with time zone", "NO", null);
		assertColumn("issue", "updated_at", "timestamp with time zone", "NO", null);
		assertColumn("issue", "version", "bigint", "NO", null);
	}

	@Test
	void issueIdIsThePrimaryKey() {
		assertThat(primaryKeyColumn("issue")).isEqualTo("id");
	}

	@Test
	void issueReferencesProjectExactly() {
		assertForeignKey("issue", "fk_issue_project",
				List.of("project_id"), "project", List.of("id"));
	}

	@Test
	void issueReferencesReporterExactly() {
		assertForeignKey("issue", "fk_issue_reporter",
				List.of("reporter_id"), "user_account", List.of("id"));
	}

	@Test
	void issueReferencesAssigneeExactly() {
		assertForeignKey("issue", "fk_issue_assignee",
				List.of("assignee_id"), "user_account", List.of("id"));
	}

	@Test
	void issueReferencesWorkflowStatusExactly() {
		assertForeignKey("issue", "fk_issue_workflow_status",
				List.of("project_id", "workflow_status_id"),
				"workflow_status", List.of("project_id", "id"));
	}

	@Test
	void issueDefaultsAreApplied() {
		UUID creator = insertUser("issue-defaults@example.com");
		UUID project = insertProject("ISSUE00", "Defaults", creator);
		UUID status = insertStatus(project, "TO_DO", "Yapılacak", 0);

		// Omit archived, version, created_at and updated_at so the column defaults
		// must supply them.
		insertIssueWithDefaults(project, 1L, "ISSUE00-1", "STORY", "First", status, creator, null, 1L);

		Map<String, Object> row = jdbcTemplate.queryForMap(
				"SELECT archived, version, created_at, updated_at FROM issue WHERE project_id = ?",
				project);
		assertThat(row.get("archived")).isEqualTo(false);
		assertThat(row.get("version")).isEqualTo(0L);
		assertThat(row.get("created_at")).isNotNull();
		assertThat(row.get("updated_at")).isNotNull();
	}

	@Test
	void issueNumberUniquePerProject() {
		UUID creator = insertUser("issue-number@example.com");
		UUID project = insertProject("ISSUE01", "Numbers", creator);
		UUID status = insertStatus(project, "TO_DO", "Yapılacak", 0);

		insertIssue(project, 1L, "ISSUE01-1", "STORY", "First", status, creator, null, 1L);

		assertThatThrownBy(() ->
				insertIssue(project, 1L, "ISSUE01-2", "STORY", "Duplicate", status, creator, null, 2L))
				.satisfies(thrown -> assertConstraintViolation(thrown, "uq_issue_project_number"));
	}

	@Test
	void issueNumberMayRepeatAcrossProjects() {
		UUID creator = insertUser("issue-repeat@example.com");
		UUID projectA = insertProject("ISSUE02", "A", creator);
		UUID projectB = insertProject("ISSUE03", "B", creator);
		UUID statusA = insertStatus(projectA, "TO_DO", "Yapılacak", 0);
		UUID statusB = insertStatus(projectB, "TO_DO", "Yapılacak", 0);

		insertIssue(projectA, 1L, "ISSUE02-1", "STORY", "First", statusA, creator, null, 1L);
		insertIssue(projectB, 1L, "ISSUE03-1", "STORY", "First", statusB, creator, null, 1L);

		Integer count = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM issue WHERE number = 1", Integer.class);
		assertThat(count).isEqualTo(2);
	}

	@Test
	void issueHumanKeyIsGloballyUnique() {
		UUID creator = insertUser("issue-hkey@example.com");
		UUID projectA = insertProject("ISSUE04", "A", creator);
		UUID projectB = insertProject("ISSUE05", "B", creator);
		UUID statusA = insertStatus(projectA, "TO_DO", "Yapılacak", 0);
		UUID statusB = insertStatus(projectB, "TO_DO", "Yapılacak", 0);

		insertIssue(projectA, 1L, "ISSUE04-1", "STORY", "First", statusA, creator, null, 1L);

		assertThatThrownBy(() ->
				insertIssue(projectB, 1L, "ISSUE04-1", "STORY", "Duplicate", statusB, creator, null, 2L))
				.satisfies(thrown -> assertConstraintViolation(thrown, "uq_issue_human_key"));
	}

	@Test
	void issueTypeAcceptsAllValidValues() {
		UUID creator = insertUser("issue-types@example.com");
		UUID project = insertProject("ISSUE06", "Types", creator);
		UUID status = insertStatus(project, "TO_DO", "Yapılacak", 0);

		insertIssue(project, 1L, "ISSUE06-1", "STORY", "Story", status, creator, null, 1L);
		insertIssue(project, 2L, "ISSUE06-2", "TASK", "Task", status, creator, null, 2L);
		insertIssue(project, 3L, "ISSUE06-3", "BUG", "Bug", status, creator, null, 3L);

		Integer count = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM issue WHERE project_id = ?", Integer.class, project);
		assertThat(count).isEqualTo(3);
	}

	@Test
	void issueTypeRejectsInvalidSentinel() {
		UUID creator = insertUser("issue-type-bad@example.com");
		UUID project = insertProject("ISSUE07", "Types", creator);
		UUID status = insertStatus(project, "TO_DO", "Yapılacak", 0);

		// Valid control fixture so an unrelated FK/default problem cannot create a
		// false positive.
		insertIssue(project, 1L, "ISSUE07-1", "STORY", "Valid", status, creator, null, 1L);

		assertThatThrownBy(() ->
				insertIssue(project, 2L, "ISSUE07-2", "EPIC", "Bad", status, creator, null, 2L))
				.satisfies(thrown -> assertConstraintViolation(thrown, "ck_issue_type"));
	}

	@Test
	void issueNumberMustBePositive() {
		UUID creator = insertUser("issue-zero@example.com");
		UUID project = insertProject("ISSUE08", "Zero", creator);
		UUID status = insertStatus(project, "TO_DO", "Yapılacak", 0);

		insertIssue(project, 1L, "ISSUE08-1", "STORY", "Valid", status, creator, null, 1L);

		// The human key is deliberately a separately valid key (MES-999) so the
		// rejection is caused solely by the invalid number, not by the human-key
		// format constraint. The DB schema does not derive or compare the human-key
		// suffix in this migration; the service derives key and number atomically
		// later, so the fixture's valid suffix may differ from the invalid number.
		assertThatThrownBy(() ->
				insertIssue(project, 0L, "MES-999", "STORY", "Zero", status, creator, null, 1L))
				.satisfies(thrown -> assertConstraintViolation(thrown, "ck_issue_number_positive"));
		assertThatThrownBy(() ->
				insertIssue(project, -1L, "MES-999", "STORY", "Neg", status, creator, null, 1L))
				.satisfies(thrown -> assertConstraintViolation(thrown, "ck_issue_number_positive"));
	}

	@Test
	void issueTitleCannotBeBlank() {
		UUID creator = insertUser("issue-title@example.com");
		UUID project = insertProject("ISSUE09", "Title", creator);
		UUID status = insertStatus(project, "TO_DO", "Yapılacak", 0);

		insertIssue(project, 1L, "ISSUE09-1", "STORY", "Valid", status, creator, null, 1L);

		assertThatThrownBy(() ->
				insertIssue(project, 2L, "ISSUE09-2", "STORY", "", status, creator, null, 1L))
				.satisfies(thrown -> assertConstraintViolation(thrown, "ck_issue_title_not_blank"));
		assertThatThrownBy(() ->
				insertIssue(project, 3L, "ISSUE09-3", "STORY", "   ", status, creator, null, 1L))
				.satisfies(thrown -> assertConstraintViolation(thrown, "ck_issue_title_not_blank"));
	}

	@Test
	void issueRankMustBePositive() {
		UUID creator = insertUser("issue-rank@example.com");
		UUID project = insertProject("ISSUE10", "Rank", creator);
		UUID status = insertStatus(project, "TO_DO", "Yapılacak", 0);

		insertIssue(project, 1L, "ISSUE10-1", "STORY", "Valid", status, creator, null, 1L);

		assertThatThrownBy(() ->
				insertIssue(project, 2L, "ISSUE10-2", "STORY", "Zero", status, creator, null, 0L))
				.satisfies(thrown -> assertConstraintViolation(thrown, "ck_issue_rank_positive"));
		assertThatThrownBy(() ->
				insertIssue(project, 3L, "ISSUE10-3", "STORY", "Neg", status, creator, null, -1L))
				.satisfies(thrown -> assertConstraintViolation(thrown, "ck_issue_rank_positive"));
	}

	@Test
	void issueVersionCannotBeNegative() {
		UUID creator = insertUser("issue-version@example.com");
		UUID project = insertProject("ISSUE11", "Version", creator);
		UUID status = insertStatus(project, "TO_DO", "Yapılacak", 0);

		insertIssue(project, 1L, "ISSUE11-1", "STORY", "Valid", status, creator, null, 1L);

		assertThatThrownBy(() ->
				insertIssue(project, 2L, "ISSUE11-2", "STORY", "Neg", status, creator, null, 1L, -1L))
				.satisfies(thrown -> assertConstraintViolation(thrown, "ck_issue_version_non_negative"));
	}

	@Test
	void issueHumanKeyFormatAcceptsValidProjectKeyAndPositiveNumber() {
		UUID creator = insertUser("issue-hkey-ok@example.com");
		UUID project = insertProject("ISSUE12", "Format", creator);
		UUID status = insertStatus(project, "TO_DO", "Yapılacak", 0);

		// Accepted: shortest prefix, typical prefix, and max-length prefix with a
		// max BIGINT number. Each uses a unique project/number/human-key so no
		// unrelated uniqueness constraint can interfere.
		insertIssue(project, 1L, "ME-1", "STORY", "Short", status, creator, null, 1L);
		insertIssue(project, 2L, "MES-12", "STORY", "Typical", status, creator, null, 2L);
		insertIssue(project, 3L, "A123456789-9223372036854775807", "STORY", "Max", status, creator, null, 3L);

		Integer count = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM issue WHERE project_id = ?", Integer.class, project);
		assertThat(count).isEqualTo(3);
	}

	@Test
	void issueHumanKeyFormatRejectsMalformedKeys() {
		UUID creator = insertUser("issue-hkey-bad@example.com");
		UUID project = insertProject("ISSUE12", "Format", creator);
		UUID status = insertStatus(project, "TO_DO", "Yapılacak", 0);

		// Valid control fixture so an unrelated FK/default problem cannot create a
		// false positive.
		insertIssue(project, 1L, "ISSUE12-1", "STORY", "Valid", status, creator, null, 1L);

		// Each malformed key uses a unique number so only ck_issue_human_key_format
		// can reject it (uq_issue_project_number and uq_issue_human_key stay clear).
		assertThatThrownBy(() ->
				insertIssue(project, 2L, "M-1", "STORY", "Prefix too short", status, creator, null, 1L))
				.satisfies(thrown -> assertConstraintViolation(thrown, "ck_issue_human_key_format"));
		assertThatThrownBy(() ->
				insertIssue(project, 3L, "MES--1", "STORY", "Double hyphen", status, creator, null, 1L))
				.satisfies(thrown -> assertConstraintViolation(thrown, "ck_issue_human_key_format"));
		assertThatThrownBy(() ->
				insertIssue(project, 4L, "MES-0", "STORY", "Zero number", status, creator, null, 1L))
				.satisfies(thrown -> assertConstraintViolation(thrown, "ck_issue_human_key_format"));
		assertThatThrownBy(() ->
				insertIssue(project, 5L, "MES-01", "STORY", "Leading zero", status, creator, null, 1L))
				.satisfies(thrown -> assertConstraintViolation(thrown, "ck_issue_human_key_format"));
		assertThatThrownBy(() ->
				insertIssue(project, 6L, "MES-1-2", "STORY", "Extra hyphen", status, creator, null, 1L))
				.satisfies(thrown -> assertConstraintViolation(thrown, "ck_issue_human_key_format"));
		assertThatThrownBy(() ->
				insertIssue(project, 7L, "mes-1", "STORY", "Lowercase", status, creator, null, 1L))
				.satisfies(thrown -> assertConstraintViolation(thrown, "ck_issue_human_key_format"));
		assertThatThrownBy(() ->
				insertIssue(project, 8L, "MES_", "STORY", "Underscore", status, creator, null, 1L))
				.satisfies(thrown -> assertConstraintViolation(thrown, "ck_issue_human_key_format"));
		assertThatThrownBy(() ->
				insertIssue(project, 9L, "MES-ABC", "STORY", "Non numeric", status, creator, null, 1L))
				.satisfies(thrown -> assertConstraintViolation(thrown, "ck_issue_human_key_format"));
	}

	@Test
	void issueNullableAssigneeIsAccepted() {
		UUID creator = insertUser("issue-assignee@example.com");
		UUID project = insertProject("ISSUE13", "Assignee", creator);
		UUID status = insertStatus(project, "TO_DO", "Yapılacak", 0);

		insertIssue(project, 1L, "ISSUE13-1", "STORY", "Unassigned", status, creator, null, 1L);

		Integer count = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM issue WHERE project_id = ? AND assignee_id IS NULL",
				Integer.class, project);
		assertThat(count).isEqualTo(1);
	}

	@Test
	void issueNonNullAssigneeIsAccepted() {
		UUID creator = insertUser("issue-assignee-nonnull@example.com");
		UUID assignee = insertUser("issue-assignee-real@example.com");
		UUID project = insertProject("ISSUE14", "Assignee", creator);
		UUID status = insertStatus(project, "TO_DO", "Yapılacak", 0);

		insertIssue(project, 1L, "ISSUE14-1", "STORY", "Assigned", status, creator, assignee, 1L);

		Integer count = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM issue WHERE project_id = ? AND assignee_id = ?",
				Integer.class, project, assignee);
		assertThat(count).isEqualTo(1);
	}

	@Test
	void issueArchivedDefaultsToFalse() {
		UUID creator = insertUser("issue-archived@example.com");
		UUID project = insertProject("ISSUE15", "Archived", creator);
		UUID status = insertStatus(project, "TO_DO", "Yapılacak", 0);

		insertIssue(project, 1L, "ISSUE15-1", "STORY", "Active", status, creator, null, 1L);

		Boolean archived = jdbcTemplate.queryForObject(
				"SELECT archived FROM issue WHERE project_id = ?", Boolean.class, project);
		assertThat(archived).isFalse();
	}

	// ------------------------------------------------------------------
	// Same-project workflow integrity
	// ------------------------------------------------------------------

	@Test
	void workflowStatusHasUniqueCandidateKeyOnProjectAndId() {
		assertUniqueCandidateKey("workflow_status", "uq_workflow_status_project_id",
				List.of("project_id", "id"));
	}

	@Test
	void issueHasCompositeForeignKeyToWorkflowStatus() {
		assertForeignKey("issue", "fk_issue_workflow_status",
				List.of("project_id", "workflow_status_id"),
				"workflow_status", List.of("project_id", "id"));
	}

	@Test
	void issueCannotUseWorkflowStatusFromAnotherProject() {
		UUID creator = insertUser("issue-cross-status@example.com");
		UUID projectA = insertProject("ISSUE16", "A", creator);
		UUID projectB = insertProject("ISSUE17", "B", creator);
		UUID statusA = insertStatus(projectA, "TO_DO", "Yapılacak", 0);
		UUID statusB = insertStatus(projectB, "TO_DO", "Yapılacak", 0);

		// A valid issue in project A using project A's status.
		insertIssue(projectA, 1L, "ISSUE16-1", "STORY", "Valid", statusA, creator, null, 1L);

		// An issue in project A must NOT be able to reference project B's status.
		assertThatThrownBy(() ->
				insertIssue(projectA, 2L, "ISSUE16-2", "STORY", "Cross", statusB, creator, null, 2L))
				.satisfies(thrown -> assertConstraintViolation(thrown, "fk_issue_workflow_status"));
	}

	// ------------------------------------------------------------------
	// issue_activity
	// ------------------------------------------------------------------

	@Test
	void issueActivityTableHasExpectedColumns() {
		assertThat(tableExists("issue_activity")).isTrue();

		assertColumn("issue_activity", "id", "uuid", "NO", null);
		assertColumn("issue_activity", "issue_id", "uuid", "NO", null);
		assertColumn("issue_activity", "actor_id", "uuid", "NO", null);
		assertColumn("issue_activity", "type", "character varying", "NO", 32);
		assertColumn("issue_activity", "summary", "jsonb", "NO", null);
		assertColumn("issue_activity", "created_at", "timestamp with time zone", "NO", null);
	}

	@Test
	void issueActivityIdIsThePrimaryKey() {
		assertThat(primaryKeyColumn("issue_activity")).isEqualTo("id");
	}

	@Test
	void issueActivityReferencesIssueExactly() {
		assertForeignKey("issue_activity", "fk_issue_activity_issue",
				List.of("issue_id"), "issue", List.of("id"));
	}

	@Test
	void issueActivityReferencesActorExactly() {
		assertForeignKey("issue_activity", "fk_issue_activity_actor",
				List.of("actor_id"), "user_account", List.of("id"));
	}

	@Test
	void issueActivityTypeAcceptsAllValidValues() {
		UUID creator = insertUser("activity-types@example.com");
		UUID project = insertProject("ISSUE18", "Activity", creator);
		UUID status = insertStatus(project, "TO_DO", "Yapılacak", 0);
		UUID issue = insertIssue(project, 1L, "ISSUE18-1", "STORY", "First", status, creator, null, 1L);

		insertActivity(issue, creator, "CREATED", "{\"field\":\"created\"}");
		insertActivity(issue, creator, "UPDATED", "{\"field\":\"updated\"}");
		insertActivity(issue, creator, "MOVED", "{\"field\":\"moved\"}");
		insertActivity(issue, creator, "ARCHIVED", "{\"field\":\"archived\"}");

		Integer count = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM issue_activity WHERE issue_id = ?", Integer.class, issue);
		assertThat(count).isEqualTo(4);
	}

	@Test
	void issueActivityTypeRejectsInvalidSentinels() {
		UUID creator = insertUser("activity-type-bad@example.com");
		UUID project = insertProject("ISSUE19", "Activity", creator);
		UUID status = insertStatus(project, "TO_DO", "Yapılacak", 0);
		UUID issue = insertIssue(project, 1L, "ISSUE19-1", "STORY", "First", status, creator, null, 1L);

		// Valid control fixture so an unrelated FK/default problem cannot create a
		// false positive.
		insertActivity(issue, creator, "CREATED", "{\"field\":\"valid\"}");

		assertThatThrownBy(() -> insertActivity(issue, creator, "COMMENT", "{\"text\":\"hi\"}"))
				.satisfies(thrown -> assertConstraintViolation(thrown, "ck_issue_activity_type"));
		assertThatThrownBy(() -> insertActivity(issue, creator, "UNARCHIVED", "{}"))
				.satisfies(thrown -> assertConstraintViolation(thrown, "ck_issue_activity_type"));
	}

	@Test
	void issueActivitySummaryCannotBeNull() {
		UUID creator = insertUser("activity-null@example.com");
		UUID project = insertProject("ISSUE20", "Activity", creator);
		UUID status = insertStatus(project, "TO_DO", "Yapılacak", 0);
		UUID issue = insertIssue(project, 1L, "ISSUE20-1", "STORY", "First", status, creator, null, 1L);

		// Valid control fixture so an unrelated FK/default problem cannot create a
		// false positive.
		insertActivity(issue, creator, "CREATED", "{\"field\":\"valid\"}");

		assertThatThrownBy(() -> insertActivity(issue, creator, "CREATED", null))
				.isInstanceOf(DataAccessException.class)
				.satisfies(ex -> {
					ServerErrorMessage error = unwrapServerError((DataAccessException) ex);
					assertThat(error).isNotNull();
					assertThat(error.getSQLState()).isEqualTo("23502");
					assertThat(error.getColumn()).isEqualTo("summary");
				});
	}

	@Test
	void issueActivitySummaryColumnIsJsonb() {
		UUID creator = insertUser("activity-jsonb@example.com");
		UUID project = insertProject("ISSUE21", "Activity", creator);
		UUID status = insertStatus(project, "TO_DO", "Yapılacak", 0);
		UUID issue = insertIssue(project, 1L, "ISSUE21-1", "STORY", "First", status, creator, null, 1L);

		insertActivity(issue, creator, "CREATED", "{\"field\":\"value\"}");

		String dataType = jdbcTemplate.queryForObject(
				"""
				SELECT data_type FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = 'issue_activity' AND column_name = 'summary'
				""",
				String.class);
		assertThat(dataType).isEqualTo("jsonb");
	}

	// ------------------------------------------------------------------
	// Required indexes (exact definitions)
	// ------------------------------------------------------------------

	@Test
	void issueActiveBoardOrderingIndexExists() {
		assertOrdinaryIndex("issue", "ix_issue_project_status_archived_rank",
				List.of("project_id", "workflow_status_id", "archived", "rank"));
	}

	@Test
	void issueProjectActiveNumberListingIndexExists() {
		assertOrdinaryIndex("issue", "ix_issue_project_archived_number",
				List.of("project_id", "archived", "number"));
	}

	@Test
	void issueAssigneeLookupIndexExists() {
		assertOrdinaryIndex("issue", "ix_issue_assignee_archived",
				List.of("assignee_id", "archived"));
	}

	@Test
	void issueActivityDeterministicOrderIndexExists() {
		assertOrdinaryIndex("issue_activity", "ix_issue_activity_issue_created_id",
				List.of("issue_id", "created_at", "id"));
	}

	// ------------------------------------------------------------------
	// Helpers
	// ------------------------------------------------------------------

	private void cleanupIssueRows() {
		// Child-to-parent order so later test classes cannot inherit synthetic
		// fixture rows. Guard each delete on table existence so the RED phase
		// (V4 absent) does not fail on the fixture itself; the schema-absence
		// assertions fail instead.
		if (tableExists("issue_activity")) {
			jdbcTemplate.update("DELETE FROM issue_activity");
		}
		if (tableExists("issue")) {
			jdbcTemplate.update("DELETE FROM issue");
		}
		if (tableExists("project_issue_counter")) {
			jdbcTemplate.update("DELETE FROM project_issue_counter");
		}
		if (tableExists("workflow_status")) {
			jdbcTemplate.update("DELETE FROM workflow_status");
		}
		if (tableExists("project_member")) {
			jdbcTemplate.update("DELETE FROM project_member");
		}
		if (tableExists("project")) {
			jdbcTemplate.update("DELETE FROM project");
		}
		if (tableExists("user_account")) {
			jdbcTemplate.update("DELETE FROM user_account");
		}
	}

	private boolean tableExists(String tableName) {
		Integer count = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM information_schema.tables"
						+ " WHERE table_schema = 'public' AND table_name = ?",
				Integer.class, tableName);
		return count != null && count == 1;
	}

	/**
	 * Asserts that an ordinary (non-unique, non-expression, non-partial) index
	 * exists on the expected table with exactly the expected ordered key columns.
	 */
	private void assertOrdinaryIndex(String tableName, String indexName, List<String> expectedColumns) {
		List<Map<String, Object>> rows = jdbcTemplate.queryForList(
				"""
				SELECT c.relname AS index_name,
				       i.indnkeyatts,
				       i.indnatts,
				       i.indisunique,
				       i.indexprs,
				       i.indpred,
				       a.attname AS column_name
				FROM pg_index i
				JOIN pg_class t ON t.oid = i.indrelid
				JOIN pg_class c ON c.oid = i.indexrelid
				JOIN pg_namespace n ON n.oid = c.relnamespace
				JOIN pg_attribute a ON a.attrelid = t.oid
					AND a.attnum = ANY(i.indkey)
				WHERE n.nspname = 'public'
					AND t.relname = ?
					AND c.relname = ?
				ORDER BY array_position(i.indkey, a.attnum)
				""",
				tableName, indexName);

		assertThat(rows).as("index %s on %s", indexName, tableName).hasSize(expectedColumns.size());

		List<String> actualColumns = rows.stream()
				.map(row -> (String) row.get("column_name"))
				.toList();
		assertThat(actualColumns).containsExactlyElementsOf(expectedColumns);

		Map<String, Object> first = rows.get(0);
		assertThat(first.get("indnkeyatts")).isEqualTo(expectedColumns.size());
		assertThat(first.get("indnatts")).isEqualTo(first.get("indnkeyatts"));
		assertThat(first.get("indisunique")).isEqualTo(false);
		assertThat(first.get("indexprs")).isNull();
		assertThat(first.get("indpred")).isNull();
	}

	/**
	 * Asserts that a unique candidate key exists on the expected table with exactly
	 * the expected ordered columns and no extra or expression columns.
	 */
	private void assertUniqueCandidateKey(String tableName, String constraintName,
			List<String> expectedColumns) {
		List<Map<String, Object>> rows = jdbcTemplate.queryForList(
				"""
				SELECT con.conname,
				       con.contype,
				       i.indnkeyatts,
				       i.indnatts,
				       i.indexprs,
				       i.indpred,
				       a.attname AS column_name
				FROM pg_constraint con
				JOIN pg_class t ON t.oid = con.conrelid
				JOIN pg_namespace n ON n.oid = t.relnamespace
				JOIN pg_index i ON i.indexrelid = con.conindid
				JOIN pg_attribute a ON a.attrelid = t.oid
					AND a.attnum = ANY(i.indkey)
				WHERE n.nspname = 'public'
					AND t.relname = ?
					AND con.conname = ?
				ORDER BY array_position(i.indkey, a.attnum)
				""",
				tableName, constraintName);

		assertThat(rows).as("unique constraint %s on %s", constraintName, tableName)
				.hasSize(expectedColumns.size());

		Map<String, Object> first = rows.get(0);
		assertThat(first.get("contype")).isEqualTo("u");
		assertThat(first.get("indnkeyatts")).isEqualTo(expectedColumns.size());
		assertThat(first.get("indnatts")).isEqualTo(first.get("indnkeyatts"));
		assertThat(first.get("indexprs")).isNull();
		assertThat(first.get("indpred")).isNull();

		List<String> actualColumns = rows.stream()
				.map(row -> (String) row.get("column_name"))
				.toList();
		assertThat(actualColumns).containsExactlyElementsOf(expectedColumns);
	}

	/**
	 * Asserts that a foreign key exists with the exact constraint name, exact
	 * ordered local columns, exact referenced table, and exact ordered referenced
	 * columns, using pg_constraint/pg_attribute ordered arrays.
	 */
	private void assertForeignKey(String tableName, String constraintName,
			List<String> expectedLocalColumns, String expectedReferencedTable,
			List<String> expectedReferencedColumns) {
		List<Map<String, Object>> rows = jdbcTemplate.queryForList(
				"""
				SELECT con.conname,
				       con.contype,
				       t.relname AS local_table,
				       rt.relname AS referenced_table,
				       la.attname AS local_column,
				       ra.attname AS referenced_column
				FROM pg_constraint con
				JOIN pg_class t ON t.oid = con.conrelid
				JOIN pg_class rt ON rt.oid = con.confrelid
				JOIN pg_namespace n ON n.oid = t.relnamespace
				JOIN unnest(con.conkey) WITH ORDINALITY AS lk(attnum, ord)
					ON true
				JOIN unnest(con.confkey) WITH ORDINALITY AS rk(attnum, ord)
					ON rk.ord = lk.ord
				JOIN pg_attribute la ON la.attrelid = t.oid AND la.attnum = lk.attnum
				JOIN pg_attribute ra ON ra.attrelid = rt.oid AND ra.attnum = rk.attnum
				WHERE n.nspname = 'public'
					AND t.relname = ?
					AND con.conname = ?
				ORDER BY lk.ord
				""",
				tableName, constraintName);

		assertThat(rows).as("foreign key %s on %s", constraintName, tableName)
				.hasSize(expectedLocalColumns.size());

		Map<String, Object> first = rows.get(0);
		assertThat(first.get("contype")).isEqualTo("f");
		assertThat(first.get("local_table")).isEqualTo(tableName);
		assertThat(first.get("referenced_table")).isEqualTo(expectedReferencedTable);

		List<String> actualLocalColumns = rows.stream()
				.map(row -> (String) row.get("local_column"))
				.toList();
		assertThat(actualLocalColumns).containsExactlyElementsOf(expectedLocalColumns);

		List<String> actualReferencedColumns = rows.stream()
				.map(row -> (String) row.get("referenced_column"))
				.toList();
		assertThat(actualReferencedColumns).containsExactlyElementsOf(expectedReferencedColumns);
	}

	/**
		* Unwraps the cause chain of a {@link DataAccessException} to the underlying
		* PostgreSQL {@link PSQLException} and returns its {@link ServerErrorMessage}.
		* Returns {@code null} when no PostgreSQL server error is present in the chain.
		*/
	private ServerErrorMessage unwrapServerError(DataAccessException ex) {
		Throwable current = ex;
		while (current != null) {
			if (current instanceof PSQLException psql) {
				return psql.getServerErrorMessage();
			}
			current = current.getCause();
		}
		return null;
	}

	/**
		* Asserts that the thrown exception is a {@link DataAccessException} whose
		* underlying PostgreSQL server error names exactly the expected constraint.
		*/
	private void assertConstraintViolation(Throwable thrown, String expectedConstraint) {
		assertThat(thrown).isInstanceOf(DataAccessException.class);
		ServerErrorMessage error = unwrapServerError((DataAccessException) thrown);
		assertThat(error).as("PostgreSQL server error for %s", expectedConstraint).isNotNull();
		assertThat(error.getConstraint()).isEqualTo(expectedConstraint);
	}

	private String primaryKeyColumn(String tableName) {
		return jdbcTemplate.queryForObject(
				"""
				SELECT kcu.column_name
				FROM information_schema.table_constraints tc
				JOIN information_schema.key_column_usage kcu
					ON tc.constraint_name = kcu.constraint_name
					AND tc.constraint_schema = kcu.constraint_schema
				WHERE tc.table_schema = 'public'
					AND tc.table_name = ?
					AND tc.constraint_type = 'PRIMARY KEY'
				""",
				String.class, tableName);
	}

	private void assertColumn(String tableName, String columnName, String dataType,
			String nullable, Integer maxLength) {
		List<Map<String, Object>> rows = jdbcTemplate.queryForList(
				"""
				SELECT data_type, is_nullable, character_maximum_length
				FROM information_schema.columns
				WHERE table_schema = 'public'
					AND table_name = ?
					AND column_name = ?
				""",
				tableName, columnName);

		assertThat(rows).hasSize(1);
		Map<String, Object> column = rows.get(0);
		assertThat(column.get("data_type")).isEqualTo(dataType);
		assertThat(column.get("is_nullable")).isEqualTo(nullable);
		assertThat(column.get("character_maximum_length")).isEqualTo(maxLength);
	}

	private UUID insertUser(String email) {
		UUID id = UUID.randomUUID();
		jdbcTemplate.update(
				"""
				INSERT INTO user_account (id, email, password_hash, first_name, last_name, role, status)
				VALUES (?, ?, 'fake-hash', 'Ada', 'Lovelace', 'USER', 'ACTIVE')
				""",
				id, email);
		return id;
	}

	private UUID insertProject(String key, String name, UUID creator) {
		UUID id = UUID.randomUUID();
		jdbcTemplate.update(
				"""
				INSERT INTO project (id, key, name, description, creator_id, version)
				VALUES (?, ?, ?, NULL, ?, 0)
				""",
				id, key, name, creator);
		return id;
	}

	private UUID insertStatus(UUID projectId, String code, String displayName, int position) {
		UUID id = UUID.randomUUID();
		jdbcTemplate.update(
				"""
				INSERT INTO workflow_status (id, project_id, code, display_name, position, version)
				VALUES (?, ?, ?, ?, ?, 0)
				""",
				id, projectId, code, displayName, position);
		return id;
	}

	private void insertCounter(UUID projectId) {
		jdbcTemplate.update(
				"INSERT INTO project_issue_counter (project_id) VALUES (?)",
				projectId);
	}

	private void insertCounter(UUID projectId, Long nextNumber) {
		jdbcTemplate.update(
				"INSERT INTO project_issue_counter (project_id, next_number) VALUES (?, ?)",
				projectId, nextNumber);
	}

	private void insertCounter(UUID projectId, Long nextNumber, Long version) {
		jdbcTemplate.update(
				"INSERT INTO project_issue_counter (project_id, next_number, version) VALUES (?, ?, ?)",
				projectId, nextNumber, version);
	}

	private UUID insertIssue(UUID projectId, long number, String humanKey, String type,
			String title, UUID workflowStatusId, UUID reporterId, UUID assigneeId, long rank) {
		return insertIssue(projectId, number, humanKey, type, title, workflowStatusId,
				reporterId, assigneeId, rank, 0L);
	}

	private UUID insertIssue(UUID projectId, long number, String humanKey, String type,
			String title, UUID workflowStatusId, UUID reporterId, UUID assigneeId, long rank,
			long version) {
		UUID id = UUID.randomUUID();
		jdbcTemplate.update(
				"""
				INSERT INTO issue (id, project_id, number, human_key, type, title, description,
					workflow_status_id, reporter_id, assignee_id, rank, archived, version)
				VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, FALSE, ?)
				""",
				id, projectId, number, humanKey, type, title, workflowStatusId,
				reporterId, assigneeId, rank, version);
		return id;
	}

	/**
		* Inserts an issue omitting archived, version, created_at and updated_at so the
		* column defaults must supply them.
		*/
	private UUID insertIssueWithDefaults(UUID projectId, long number, String humanKey, String type,
			String title, UUID workflowStatusId, UUID reporterId, UUID assigneeId, long rank) {
		UUID id = UUID.randomUUID();
		jdbcTemplate.update(
				"""
				INSERT INTO issue (id, project_id, number, human_key, type, title, description,
					workflow_status_id, reporter_id, assignee_id, rank)
				VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
				""",
				id, projectId, number, humanKey, type, title, workflowStatusId,
				reporterId, assigneeId, rank);
		return id;
	}

	private void insertActivity(UUID issueId, UUID actorId, String type, String summary) {
		jdbcTemplate.update(
				"""
				INSERT INTO issue_activity (id, issue_id, actor_id, type, summary)
				VALUES (gen_random_uuid(), ?, ?, ?, CAST(? AS jsonb))
				""",
				issueId, actorId, type, summary);
	}

}
