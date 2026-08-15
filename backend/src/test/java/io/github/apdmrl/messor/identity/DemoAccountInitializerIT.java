package io.github.apdmrl.messor.identity;

import java.util.List;
import java.util.Map;

import io.github.apdmrl.messor.support.PostgresIntegrationTestSupport;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration test for {@link DemoAccountInitializer}.
 *
 * <p>Runs with the {@code demo} profile enabled so the initializer seeds the
 * two demo accounts. The demo password is supplied as a test-only value for
 * the canonical {@code messor.demo.password} property, so the test is
 * self-contained and does not depend on the {@code MESSOR_DEMO_PASSWORD}
 * environment variable being set in the shell environment.</p>
 */
@ActiveProfiles({ "test", "demo" })
@TestPropertySource(properties = "messor.demo.password=test-only-demo-password-42")
class DemoAccountInitializerIT extends PostgresIntegrationTestSupport {

	private static final String DEMO_PASSWORD = "test-only-demo-password-42";

	@Autowired
	private DemoAccountInitializer initializer;

	@Autowired
	private UserAccountRepository repository;

	@Autowired
	private PasswordEncoder passwordEncoder;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Test
	void seedsExactlyTwoDemoAccounts() {
		assertThat(repository.count()).isEqualTo(2);

		UserAccount admin = repository.findByNormalizedEmail("admin@demo.messor.app").orElseThrow();
		UserAccount member = repository.findByNormalizedEmail("member@demo.messor.app").orElseThrow();

		assertThat(admin.getFirstName()).isEqualTo("Messor");
		assertThat(admin.getLastName()).isEqualTo("Admin");
		assertThat(admin.getRole()).isEqualTo(UserRole.ORG_ADMIN);
		assertThat(admin.getStatus()).isEqualTo(UserStatus.ACTIVE);

		assertThat(member.getFirstName()).isEqualTo("Messor");
		assertThat(member.getLastName()).isEqualTo("Member");
		assertThat(member.getRole()).isEqualTo(UserRole.USER);
		assertThat(member.getStatus()).isEqualTo(UserStatus.ACTIVE);
	}

	@Test
	void seedsNoOtherUsersOrViewerAccounts() {
		List<String> emails = repository.findAll().stream()
				.map(UserAccount::getEmail)
				.sorted()
				.toList();

		assertThat(emails).containsExactly(
				"admin@demo.messor.app",
				"member@demo.messor.app");

		Integer viewerCount = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM user_account WHERE role = 'VIEWER'",
				Integer.class);
		assertThat(viewerCount).isZero();
	}

	@Test
	void storesNormalizedEmails() {
		UserAccount admin = repository.findByNormalizedEmail("ADMIN@DEMO.MESSOR.APP").orElseThrow();
		UserAccount member = repository.findByNormalizedEmail(" MEMBER@demo.messor.app ").orElseThrow();

		assertThat(admin.getEmail()).isEqualTo("admin@demo.messor.app");
		assertThat(member.getEmail()).isEqualTo("member@demo.messor.app");
	}

	@Test
	void hashesAreArgon2idAndNotPlaintext() {
		UserAccount admin = repository.findByNormalizedEmail("admin@demo.messor.app").orElseThrow();
		UserAccount member = repository.findByNormalizedEmail("member@demo.messor.app").orElseThrow();

		assertThat(admin.getPasswordHash()).startsWith("$argon2id$");
		assertThat(member.getPasswordHash()).startsWith("$argon2id$");

		assertThat(admin.getPasswordHash()).isNotEqualTo(DEMO_PASSWORD);
		assertThat(member.getPasswordHash()).isNotEqualTo(DEMO_PASSWORD);
	}

	@Test
	void passwordEncoderMatchesDemoPassword() {
		UserAccount admin = repository.findByNormalizedEmail("admin@demo.messor.app").orElseThrow();
		UserAccount member = repository.findByNormalizedEmail("member@demo.messor.app").orElseThrow();

		assertThat(passwordEncoder.matches(DEMO_PASSWORD, admin.getPasswordHash())).isTrue();
		assertThat(passwordEncoder.matches(DEMO_PASSWORD, member.getPasswordHash())).isTrue();
	}

	@Test
	void passwordEncoderRejectsWrongPassword() {
		UserAccount admin = repository.findByNormalizedEmail("admin@demo.messor.app").orElseThrow();
		UserAccount member = repository.findByNormalizedEmail("member@demo.messor.app").orElseThrow();

		assertThat(passwordEncoder.matches("wrong-demo-password", admin.getPasswordHash())).isFalse();
		assertThat(passwordEncoder.matches("wrong-demo-password", member.getPasswordHash())).isFalse();
	}

	@Test
	void twoHashesDifferBecauseOfSalt() {
		UserAccount admin = repository.findByNormalizedEmail("admin@demo.messor.app").orElseThrow();
		UserAccount member = repository.findByNormalizedEmail("member@demo.messor.app").orElseThrow();

		assertThat(admin.getPasswordHash()).isNotEqualTo(member.getPasswordHash());
	}

	@Test
	void runningInitializerAgainIsIdempotent() {
		Map<String, Object> before = snapshot("admin@demo.messor.app");
		Map<String, Object> memberBefore = snapshot("member@demo.messor.app");

		initializer.run(new DefaultApplicationArguments(new String[0]));

		assertThat(repository.count()).isEqualTo(2);

		Map<String, Object> after = snapshot("admin@demo.messor.app");
		Map<String, Object> memberAfter = snapshot("member@demo.messor.app");

		assertThat(after.get("id")).isEqualTo(before.get("id"));
		assertThat(memberAfter.get("id")).isEqualTo(memberBefore.get("id"));

		assertThat(after.get("password_hash")).isEqualTo(before.get("password_hash"));
		assertThat(memberAfter.get("password_hash")).isEqualTo(memberBefore.get("password_hash"));

		assertThat(after.get("role")).isEqualTo(before.get("role"));
		assertThat(after.get("status")).isEqualTo(before.get("status"));
		assertThat(memberAfter.get("role")).isEqualTo(memberBefore.get("role"));
		assertThat(memberAfter.get("status")).isEqualTo(memberBefore.get("status"));

		assertThat(after.get("version")).isEqualTo(before.get("version"));
		assertThat(memberAfter.get("version")).isEqualTo(memberBefore.get("version"));
	}

	private Map<String, Object> snapshot(String email) {
		return jdbcTemplate.queryForMap(
				"""
				SELECT id, password_hash, role, status, version
				FROM user_account
				WHERE email = ?
				""",
				email);
	}

}
