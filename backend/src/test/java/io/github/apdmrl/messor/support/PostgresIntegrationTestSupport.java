package io.github.apdmrl.messor.support;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * Base class for integration tests that require a real PostgreSQL instance.
 *
 * <p>The container is started by Testcontainers and its connection details are
 * supplied to the Spring context via {@link ServiceConnection}. Tests never
 * fall back to a host-local PostgreSQL.</p>
 */
@SpringBootTest
@ActiveProfiles("test")
@Testcontainers
@DirtiesContext
public abstract class PostgresIntegrationTestSupport {

	@Container
	@ServiceConnection
	protected static final PostgreSQLContainer POSTGRES =
			new PostgreSQLContainer("postgres:17-alpine");

}
