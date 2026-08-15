package io.github.apdmrl.messor.identity;

import java.util.List;
import java.util.Map;

import javax.sql.DataSource;

import io.github.apdmrl.messor.support.PostgresIntegrationTestSupport;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class UserMigrationIT extends PostgresIntegrationTestSupport {

	@Autowired
	private DataSource dataSource;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Test
	void userAccountTableHasExpectedColumns() {
		assertThat(tableExists("user_account")).isTrue();

		assertColumn("id", "uuid", "NO", null);
		assertColumn("email", "character varying", "NO", 320);
		assertColumn("password_hash", "character varying", "NO", 255);
		assertColumn("first_name", "character varying", "NO", 100);
		assertColumn("last_name", "character varying", "NO", 100);
		assertColumn("role", "character varying", "NO", 32);
		assertColumn("status", "character varying", "NO", 32);
		assertColumn("created_at", "timestamp with time zone", "NO", null);
		assertColumn("updated_at", "timestamp with time zone", "NO", null);
		assertColumn("version", "bigint", "NO", null);
	}

	@Test
	void idIsThePrimaryKey() {
		String primaryKeyColumn = jdbcTemplate.queryForObject(
				"""
				SELECT kcu.column_name
				FROM information_schema.table_constraints tc
				JOIN information_schema.key_column_usage kcu
					ON tc.constraint_name = kcu.constraint_name
					AND tc.constraint_schema = kcu.constraint_schema
				WHERE tc.table_schema = 'public'
					AND tc.table_name = 'user_account'
					AND tc.constraint_type = 'PRIMARY KEY'
				""",
				String.class);

		assertThat(primaryKeyColumn).isEqualTo("id");
	}

	@Test
	void emailIsUnique() {
		insertUser("duplicate@example.com");

		assertThatThrownBy(() -> insertUser("duplicate@example.com"))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void emailMustAlreadyBeNormalized() {
		assertThatThrownBy(() -> insertUser("Member@demo.messor.app"))
				.isInstanceOf(DataAccessException.class);

		assertThatThrownBy(() -> insertUser(" member@demo.messor.app "))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void emailCannotBeBlank() {
		assertThatThrownBy(() -> insertUser(""))
				.isInstanceOf(DataAccessException.class);

		assertThatThrownBy(() -> insertUser("   "))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void normalizedEmailIsStoredAsIs() {
		String email = "member@demo.messor.app";
		insertUser(email);

		String stored = jdbcTemplate.queryForObject(
				"SELECT email FROM user_account WHERE email = ?", String.class, email);
		assertThat(stored).isEqualTo(email);
	}

	@Test
	void validRolesAreAccepted() {
		insertUser("admin@example.com", "fake-hash", "Ada", "Lovelace", "ORG_ADMIN", "ACTIVE");
		insertUser("user@example.com", "fake-hash", "Grace", "Hopper", "USER", "ACTIVE");

		Integer count = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM user_account WHERE email IN ('admin@example.com', 'user@example.com')",
				Integer.class);
		assertThat(count).isEqualTo(2);
	}

	@Test
	void invalidRoleIsRejected() {
		assertThatThrownBy(() -> insertUser("viewer@example.com", "fake-hash", "Alan", "Turing", "VIEWER", "ACTIVE"))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void validStatusesAreAccepted() {
		insertUser("active@example.com", "fake-hash", "Ada", "Lovelace", "USER", "ACTIVE");
		insertUser("disabled@example.com", "fake-hash", "Grace", "Hopper", "USER", "DISABLED");

		Integer count = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM user_account WHERE email IN ('active@example.com', 'disabled@example.com')",
				Integer.class);
		assertThat(count).isEqualTo(2);
	}

	@Test
	void invalidStatusIsRejected() {
		assertThatThrownBy(() -> insertUser("locked@example.com", "fake-hash", "Alan", "Turing", "USER", "LOCKED"))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void createdAtUpdatedAtAndVersionHaveDefaults() {
		insertUser("defaults@example.com");

		Map<String, Object> row = jdbcTemplate.queryForMap(
				"""
				SELECT created_at, updated_at, version
				FROM user_account
				WHERE email = 'defaults@example.com'
				""");

		assertThat(row.get("created_at")).isNotNull();
		assertThat(row.get("updated_at")).isNotNull();
		assertThat(row.get("version")).isEqualTo(0L);
	}

	@Test
	void versionCannotBeNegative() {
		assertThatThrownBy(() -> insertUser("negative-version@example.com", -1L))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void firstNameCannotBeBlank() {
		assertThatThrownBy(() -> insertUser("blank-first@example.com", "fake-hash", "", "Lovelace", "USER", "ACTIVE"))
				.isInstanceOf(DataAccessException.class);

		assertThatThrownBy(() -> insertUser("ws-first@example.com", "fake-hash", "   ", "Lovelace", "USER", "ACTIVE"))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void lastNameCannotBeBlank() {
		assertThatThrownBy(() -> insertUser("blank-last@example.com", "fake-hash", "Ada", "", "USER", "ACTIVE"))
				.isInstanceOf(DataAccessException.class);

		assertThatThrownBy(() -> insertUser("ws-last@example.com", "fake-hash", "Ada", "   ", "USER", "ACTIVE"))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void passwordHashCannotBeBlank() {
		assertThatThrownBy(() -> insertUser("blank-hash@example.com", "", "Ada", "Lovelace", "USER", "ACTIVE"))
				.isInstanceOf(DataAccessException.class);

		assertThatThrownBy(() -> insertUser("ws-hash@example.com", "   ", "Ada", "Lovelace", "USER", "ACTIVE"))
				.isInstanceOf(DataAccessException.class);
	}

	@Test
	void v2MigrationIsRecordedAsSuccessful() {
		Integer count = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM flyway_schema_history WHERE version = '2' AND success = true",
				Integer.class);
		assertThat(count).isEqualTo(1);
	}

	private boolean tableExists(String tableName) {
		Integer count = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM information_schema.tables"
						+ " WHERE table_schema = 'public' AND table_name = ?",
				Integer.class, tableName);
		return count != null && count == 1;
	}

	private void assertColumn(String columnName, String dataType, String nullable, Integer maxLength) {
		List<Map<String, Object>> rows = jdbcTemplate.queryForList(
				"""
				SELECT data_type, is_nullable, character_maximum_length
				FROM information_schema.columns
				WHERE table_schema = 'public'
					AND table_name = 'user_account'
					AND column_name = ?
				""",
				columnName);

		assertThat(rows).hasSize(1);
		Map<String, Object> column = rows.get(0);
		assertThat(column.get("data_type")).isEqualTo(dataType);
		assertThat(column.get("is_nullable")).isEqualTo(nullable);
		assertThat(column.get("character_maximum_length")).isEqualTo(maxLength);
	}

	private void insertUser(String email) {
		insertUser(email, "fake-hash", "Ada", "Lovelace", "ORG_ADMIN", "ACTIVE");
	}

	private void insertUser(String email, Long version) {
		jdbcTemplate.update(
				"""
				INSERT INTO user_account (id, email, password_hash, first_name, last_name, role, status, version)
				VALUES (gen_random_uuid(), ?, 'fake-hash', 'Ada', 'Lovelace', 'ORG_ADMIN', 'ACTIVE', ?)
				""",
				email, version);
	}

	private void insertUser(String email, String passwordHash, String firstName, String lastName,
			String role, String status) {
		jdbcTemplate.update(
				"""
				INSERT INTO user_account (id, email, password_hash, first_name, last_name, role, status)
				VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, ?)
				""",
				email, passwordHash, firstName, lastName, role, status);
	}

}
