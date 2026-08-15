package io.github.apdmrl.messor.project;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import javax.sql.DataSource;

import io.github.apdmrl.messor.support.PostgresIntegrationTestSupport;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ProjectMigrationIT extends PostgresIntegrationTestSupport {

	@Autowired
	private DataSource dataSource;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Test
	void v3MigrationIsRecordedAsSuccessful() {
		Integer count = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM flyway_schema_history WHERE version = '3' AND success = true",
				Integer.class);
		assertThat(count).isEqualTo(1);
	}

	@Test
	void projectTableHasExpectedColumns() {
		assertThat(tableExists("project")).isTrue();

		assertColumn("project", "id", "uuid", "NO", null);
		assertColumn("project", "key", "character varying", "NO", 10);
		assertColumn("project", "name", "character varying", "NO", 120);
		assertColumn("project", "description", "character varying", "YES", 2000);
		assertColumn("project", "creator_id", "uuid", "NO", null);
		assertColumn("project", "created_at", "timestamp with time zone", "NO", null);
		assertColumn("project", "updated_at", "timestamp with time zone", "NO", null);
		assertColumn("project", "version", "bigint", "NO", null);
	}

	@Test
	void projectMemberTableHasExpectedColumns() {
		assertThat(tableExists("project_member")).isTrue();

		assertColumn("project_member", "id", "uuid", "NO", null);
		assertColumn("project_member", "project_id", "uuid", "NO", null);
		assertColumn("project_member", "user_account_id", "uuid", "NO", null);
		assertColumn("project_member", "role", "character varying", "NO", 32);
		assertColumn("project_member", "created_at", "timestamp with time zone", "NO", null);
		assertColumn("project_member", "updated_at", "timestamp with time zone", "NO", null);
		assertColumn("project_member", "version", "bigint", "NO", null);
	}

	@Test
	void workflowStatusTableHasExpectedColumns() {
		assertThat(tableExists("workflow_status")).isTrue();

		assertColumn("workflow_status", "id", "uuid", "NO", null);
		assertColumn("workflow_status", "project_id", "uuid", "NO", null);
		assertColumn("workflow_status", "code", "character varying", "NO", 32);
		assertColumn("workflow_status", "display_name", "character varying", "NO", 120);
		assertColumn("workflow_status", "position", "integer", "NO", null);
		assertColumn("workflow_status", "created_at", "timestamp with time zone", "NO", null);
		assertColumn("workflow_status", "updated_at", "timestamp with time zone", "NO", null);
		assertColumn("workflow_status", "version", "bigint", "NO", null);
	}

	@Test
	void projectIdIsThePrimaryKey() {
		assertThat(primaryKeyColumn("project")).isEqualTo("id");
	}

	@Test
	void projectMemberIdIsThePrimaryKey() {
		assertThat(primaryKeyColumn("project_member")).isEqualTo("id");
	}

	@Test
	void workflowStatusIdIsThePrimaryKey() {
		assertThat(primaryKeyColumn("workflow_status")).isEqualTo("id");
	}

	@Test
	void projectKeyIsUnique() {
		UUID creator = insertUser("key-unique@example.com");
		UUID project = insertProject("KEYUNIQ", "First", creator);

		assertThatThrownBy(() -> insertProject("KEYUNIQ", "Second", creator))
				.isInstanceOf(DataAccessException.class);

		assertThat(project).isNotNull();
	}

	@Test
	void projectKeyMustBeNormalizedUppercase() {
		UUID creator = insertUser("key-normalized@example.com");

		assertThatThrownBy(() -> insertProject("lowercase", "Lower", creator))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void projectKeyMustMatchRegex() {
		UUID creator = insertUser("key-regex@example.com");

		assertThatThrownBy(() -> insertProject("1BAD", "Digit start", creator))
				.isInstanceOf(DataAccessException.class);

		assertThatThrownBy(() -> insertProject("BAD-KEY", "Symbol", creator))
				.isInstanceOf(DataAccessException.class);

		assertThatThrownBy(() -> insertProject("A", "Too short", creator))
				.isInstanceOf(DataAccessException.class);

		assertThatThrownBy(() -> insertProject("ABCDEFGHIJK", "Too long", creator))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void projectNameCannotBeBlank() {
		UUID creator = insertUser("name-blank@example.com");

		assertThatThrownBy(() -> insertProject("NAMEBL1", "", creator))
				.isInstanceOf(DataAccessException.class);

		assertThatThrownBy(() -> insertProject("NAMEBL2", "   ", creator))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void projectVersionCannotBeNegative() {
		UUID creator = insertUser("version-negative@example.com");

		assertThatThrownBy(() -> insertProject("NEGVER1", "Neg", creator, -1L))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void projectMemberRoleConstraintAcceptsValidRoles() {
		UUID creator = insertUser("member-roles@example.com");
		UUID project = insertProject("MEMBER1", "Roles", creator);

		insertMember(project, creator, "PROJECT_LEAD");
		insertMember(project, insertUser("member-role-2@example.com"), "MEMBER");
		insertMember(project, insertUser("member-role-3@example.com"), "VIEWER");

		Integer count = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM project_member WHERE project_id = ?", Integer.class, project);
		assertThat(count).isEqualTo(3);
	}

	@Test
	void projectMemberRoleConstraintRejectsInvalidRole() {
		UUID creator = insertUser("member-bad-role@example.com");
		UUID project = insertProject("MEMBER2", "Bad role", creator);

		assertThatThrownBy(() -> insertMember(project, insertUser("member-bad-role-2@example.com"), "OWNER"))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void projectMemberUniqueProjectUser() {
		UUID creator = insertUser("member-unique@example.com");
		UUID project = insertProject("MEMBER3", "Unique", creator);
		insertMember(project, creator, "PROJECT_LEAD");

		assertThatThrownBy(() -> insertMember(project, creator, "MEMBER"))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void workflowStatusCodeUniquePerProject() {
		UUID creator = insertUser("status-code@example.com");
		UUID project = insertProject("STATUS1", "Codes", creator);
		insertStatus(project, "TO_DO", "Yapılacak", 0);

		assertThatThrownBy(() -> insertStatus(project, "TO_DO", "Duplicate", 5))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void workflowStatusPositionUniquePerProject() {
		UUID creator = insertUser("status-position@example.com");
		UUID project = insertProject("STATUS2", "Positions", creator);
		insertStatus(project, "TO_DO", "Yapılacak", 0);

		assertThatThrownBy(() -> insertStatus(project, "IN_PROGRESS", "Devam Ediyor", 0))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void workflowStatusCodeConstraintRejectsInvalidCode() {
		UUID creator = insertUser("status-bad-code@example.com");
		UUID project = insertProject("STATUS3", "Bad code", creator);

		assertThatThrownBy(() -> insertStatus(project, "todo", "Lower", 0))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void workflowStatusDisplayNameCannotBeBlank() {
		UUID creator = insertUser("status-blank@example.com");
		UUID project = insertProject("STATUS4", "Blank name", creator);

		assertThatThrownBy(() -> insertStatus(project, "TO_DO", "", 0))
				.isInstanceOf(DataAccessException.class);

		assertThatThrownBy(() -> insertStatus(project, "IN_PROGRESS", "   ", 1))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void workflowStatusPositionCannotBeNegative() {
		UUID creator = insertUser("status-negative@example.com");
		UUID project = insertProject("STATUS5", "Neg position", creator);

		assertThatThrownBy(() -> insertStatus(project, "TO_DO", "Yapılacak", -1))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void projectMemberVersionCannotBeNegative() {
		UUID creator = insertUser("member-neg-version@example.com");
		UUID project = insertProject("MEMBER4", "Neg version", creator);

		assertThatThrownBy(() -> insertMember(project, creator, "PROJECT_LEAD", -1L))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void workflowStatusVersionCannotBeNegative() {
		UUID creator = insertUser("status-neg-version@example.com");
		UUID project = insertProject("STATUS6", "Neg version", creator);

		assertThatThrownBy(() -> insertStatus(project, "TO_DO", "Yapılacak", 0, -1L))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void projectMemberReferencesExistingProjectAndUser() {
		UUID creator = insertUser("member-fk@example.com");
		UUID project = insertProject("MEMBER5", "FK", creator);

		assertThatThrownBy(() -> insertMember(UUID.randomUUID(), creator, "PROJECT_LEAD"))
				.isInstanceOf(DataAccessException.class);

		assertThatThrownBy(() -> insertMember(project, UUID.randomUUID(), "PROJECT_LEAD"))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void workflowStatusReferencesExistingProject() {
		UUID creator = insertUser("status-fk@example.com");
		insertProject("STATUS7", "FK", creator);

		assertThatThrownBy(() -> insertStatus(UUID.randomUUID(), "TO_DO", "Yapılacak", 0))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void projectCreatorReferencesExistingUser() {
		assertThatThrownBy(() -> insertProject("CREATOR1", "Bad creator", UUID.randomUUID()))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void projectKeyIndexExists() {
		assertThat(indexExists("project", "uq_project_key")).isTrue();
	}

	@Test
	void projectMemberUniqueIndexExists() {
		assertThat(indexExists("project_member", "uq_project_member_project_user")).isTrue();
	}

	@Test
	void workflowStatusUniqueIndexesExist() {
		assertThat(indexExists("workflow_status", "uq_workflow_status_project_code")).isTrue();
		assertThat(indexExists("workflow_status", "uq_workflow_status_project_position")).isTrue();
	}

	@Test
	void projectMemberProjectIndexExists() {
		assertThat(indexExists("project_member", "ix_project_member_project_id")).isTrue();
	}

	@Test
	void workflowStatusProjectIndexExists() {
		assertThat(indexExists("workflow_status", "ix_workflow_status_project_id")).isTrue();
	}

	private boolean tableExists(String tableName) {
		Integer count = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM information_schema.tables"
						+ " WHERE table_schema = 'public' AND table_name = ?",
				Integer.class, tableName);
		return count != null && count == 1;
	}

	private boolean indexExists(String tableName, String indexName) {
		Integer count = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public'"
						+ " AND tablename = ? AND indexname = ?",
				Integer.class, tableName, indexName);
		return count != null && count == 1;
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
		return insertProject(key, name, creator, 0L);
	}

	private UUID insertProject(String key, String name, UUID creator, Long version) {
		UUID id = UUID.randomUUID();
		jdbcTemplate.update(
				"""
				INSERT INTO project (id, key, name, description, creator_id, version)
				VALUES (?, ?, ?, NULL, ?, ?)
				""",
				id, key, name, creator, version);
		return id;
	}

	private void insertMember(UUID projectId, UUID userId, String role) {
		insertMember(projectId, userId, role, 0L);
	}

	private void insertMember(UUID projectId, UUID userId, String role, Long version) {
		jdbcTemplate.update(
				"""
				INSERT INTO project_member (id, project_id, user_account_id, role, version)
				VALUES (gen_random_uuid(), ?, ?, ?, ?)
				""",
				projectId, userId, role, version);
	}

	private void insertStatus(UUID projectId, String code, String displayName, int position) {
		insertStatus(projectId, code, displayName, position, 0L);
	}

	private void insertStatus(UUID projectId, String code, String displayName, int position, Long version) {
		jdbcTemplate.update(
				"""
				INSERT INTO workflow_status (id, project_id, code, display_name, position, version)
				VALUES (gen_random_uuid(), ?, ?, ?, ?, ?)
				""",
				projectId, code, displayName, position, version);
	}

}
