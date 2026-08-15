package io.github.apdmrl.messor.auth;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.security.authentication.event.AuthenticationSuccessEvent;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;

import io.github.apdmrl.messor.identity.MessorUserPrincipal;
import io.github.apdmrl.messor.identity.UserAccount;
import io.github.apdmrl.messor.identity.UserRole;

import static org.assertj.core.api.Assertions.assertThat;

@ExtendWith(OutputCaptureExtension.class)
class AuthenticationAuditLoggerTest {

	private static final String PASSWORD_HASH = "stored-argon2-hash";
	private static final String SENTINEL_SECRET = "super-secret-sentinel-value";

	@Test
	void logsStableEventNameAndSafeUserIdForSuccessfulLogin(CapturedOutput output) {
		MessorUserPrincipal principal = principal();
		AuthenticationSuccessEvent event = successEvent(principal);

		new AuthenticationAuditLogger().onAuthenticationSuccess(event);

		assertThat(output).contains("AUTH_LOGIN_SUCCESS");
		assertThat(output).contains("user_id=" + principal.getId());
	}

	@Test
	void doesNotLogEmailProfileFieldsOrCredentials(CapturedOutput output) {
		MessorUserPrincipal principal = principal();
		AuthenticationSuccessEvent event = successEvent(principal);

		new AuthenticationAuditLogger().onAuthenticationSuccess(event);

		assertThat(output).doesNotContain("member@demo.messor.app");
		assertThat(output).doesNotContain("Ada");
		assertThat(output).doesNotContain("Lovelace");
		assertThat(output).doesNotContain(PASSWORD_HASH);
		assertThat(output).doesNotContain(SENTINEL_SECRET);
	}

	@Test
	void doesNotLogSensitiveFieldNamesOrAuthenticationObject(CapturedOutput output) {
		MessorUserPrincipal principal = principal();
		AuthenticationSuccessEvent event = successEvent(principal);

		new AuthenticationAuditLogger().onAuthenticationSuccess(event);

		assertThat(output).doesNotContain("password");
		assertThat(output).doesNotContain("session");
		assertThat(output).doesNotContain("cookie");
		assertThat(output).doesNotContain("csrf");
		assertThat(output).doesNotContain("Authorization");
	}

	private static MessorUserPrincipal principal() {
		UserAccount account = UserAccount.create(
				"member@demo.messor.app", PASSWORD_HASH, "Ada", "Lovelace", UserRole.USER);
		return MessorUserPrincipal.from(account);
	}

	private static AuthenticationSuccessEvent successEvent(MessorUserPrincipal principal) {
		UsernamePasswordAuthenticationToken authentication =
				new UsernamePasswordAuthenticationToken(principal, SENTINEL_SECRET);
		return new AuthenticationSuccessEvent(authentication);
	}

}
