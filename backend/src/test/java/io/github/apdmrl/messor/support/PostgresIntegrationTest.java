package io.github.apdmrl.messor.support;

import java.sql.Connection;
import java.sql.DatabaseMetaData;

import javax.sql.DataSource;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;

class PostgresIntegrationTest extends PostgresIntegrationTestSupport {

	@Autowired
	private DataSource dataSource;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Test
	void contextBootsAgainstRealPostgresTestcontainer() throws Exception {
		try (Connection connection = dataSource.getConnection()) {
			DatabaseMetaData metaData = connection.getMetaData();
			String url = metaData.getURL();

			assertThat(url).isEqualTo(POSTGRES.getJdbcUrl());

			assertThat(metaData.getDatabaseProductName()).isEqualTo("PostgreSQL");
			assertThat(metaData.getDatabaseMajorVersion()).isEqualTo(17);
		}

		assertThat(tableExists("flyway_schema_history")).isTrue();
		assertThat(tableExists("spring_session")).isTrue();

		Integer v1Applied = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM flyway_schema_history WHERE version = '1' AND success = true",
				Integer.class);
		assertThat(v1Applied).isEqualTo(1);
	}

	private boolean tableExists(String tableName) {
		Integer count = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM information_schema.tables"
						+ " WHERE table_schema = 'public' AND table_name = ?",
				Integer.class, tableName);
		return count != null && count == 1;
	}

}
