package io.github.apdmrl.messor.auth;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.authentication.event.AuthenticationFailureBadCredentialsEvent;
import org.springframework.security.authentication.event.AuthenticationSuccessEvent;
import org.springframework.security.authentication.event.LogoutSuccessEvent;

import io.github.apdmrl.messor.identity.MessorUserPrincipal;
import io.github.apdmrl.messor.identity.UserAccount;
import io.github.apdmrl.messor.identity.UserRole;

import static org.assertj.core.api.Assertions.assertThat;

@ExtendWith(OutputCaptureExtension.class)
class AuthenticationAuditLoggerTest {

	private static final String PASSWORD_HASH = "stored-argon2-hash";
	private static final String SENTINEL_SECRET = "super-secret-sentinel-value";
	private static final String SENTINEL_RAW_EMAIL = "attacker@raw-email.example";
	private static final String SENTINEL_RAW_PASSWORD = "raw-password-sentinel";
	private static final String SENTINEL_EXCEPTION_SECRET = "exception-secret-sentinel";

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

	@Test
	void logsStableEventNameForFailedLoginWithoutAnyIdentityOrCredential(CapturedOutput output) {
		AuthenticationFailureBadCredentialsEvent event = failureEvent();

		new AuthenticationAuditLogger().onAuthenticationFailure(event);

		assertThat(output).contains("AUTH_LOGIN_FAILURE");
		assertThat(output).doesNotContain(SENTINEL_RAW_EMAIL);
		assertThat(output).doesNotContain(SENTINEL_RAW_PASSWORD);
		assertThat(output).doesNotContain(SENTINEL_EXCEPTION_SECRET);
		assertThat(output).doesNotContain("user_id=");
		assertThat(output).doesNotContain("password");
		assertThat(output).doesNotContain("session");
		assertThat(output).doesNotContain("cookie");
		assertThat(output).doesNotContain("csrf");
		assertThat(output).doesNotContain("Authorization");
	}

	@Test
	void logsStableEventNameAndSafeUserIdForLogoutWithMessorPrincipal(CapturedOutput output) {
		MessorUserPrincipal principal = principal();
		LogoutSuccessEvent event = logoutEvent(principal);

		new AuthenticationAuditLogger().onLogoutSuccess(event);

		assertThat(output).contains("AUTH_LOGOUT_SUCCESS");
		assertThat(output).contains("user_id=" + principal.getId());
		assertThat(output).doesNotContain("member@demo.messor.app");
		assertThat(output).doesNotContain("Ada");
		assertThat(output).doesNotContain("Lovelace");
		assertThat(output).doesNotContain(PASSWORD_HASH);
		assertThat(output).doesNotContain("password");
		assertThat(output).doesNotContain("session");
		assertThat(output).doesNotContain("cookie");
		assertThat(output).doesNotContain("csrf");
		assertThat(output).doesNotContain("Authorization");
	}

	@Test
	void logsOnlyEventNameForLogoutWithUnexpectedPrincipal(CapturedOutput output) {
		String rawPrincipal = "raw-principal-sentinel";
		LogoutSuccessEvent event = logoutEvent(rawPrincipal);

		new AuthenticationAuditLogger().onLogoutSuccess(event);

		assertThat(output).contains("AUTH_LOGOUT_SUCCESS");
		assertThat(output).doesNotContain(rawPrincipal);
		assertThat(output).doesNotContain("user_id=");
		assertThat(output).doesNotContain("password");
		assertThat(output).doesNotContain("session");
		assertThat(output).doesNotContain("cookie");
		assertThat(output).doesNotContain("csrf");
		assertThat(output).doesNotContain("Authorization");
	}

	@Test
	void logsNothingForUnexpectedSuccessPrincipal(CapturedOutput output) {
		String rawPrincipal = "raw-success-principal-sentinel";
		AuthenticationSuccessEvent event = successEvent(rawPrincipal);

		new AuthenticationAuditLogger().onAuthenticationSuccess(event);

		assertThat(output).doesNotContain("AUTH_LOGIN_SUCCESS");
		assertThat(output).doesNotContain(rawPrincipal);
		assertThat(output).doesNotContain("user_id=");
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

	private static AuthenticationSuccessEvent successEvent(String rawPrincipal) {
		UsernamePasswordAuthenticationToken authentication =
				new UsernamePasswordAuthenticationToken(rawPrincipal, SENTINEL_SECRET);
		return new AuthenticationSuccessEvent(authentication);
	}

	private static AuthenticationFailureBadCredentialsEvent failureEvent() {
		UsernamePasswordAuthenticationToken authentication =
				new UsernamePasswordAuthenticationToken(SENTINEL_RAW_EMAIL, SENTINEL_RAW_PASSWORD);
		return new AuthenticationFailureBadCredentialsEvent(
				authentication, new BadCredentialsException(SENTINEL_EXCEPTION_SECRET));
	}

	private static LogoutSuccessEvent logoutEvent(Object principal) {
		UsernamePasswordAuthenticationToken authentication =
				new UsernamePasswordAuthenticationToken(principal, SENTINEL_SECRET);
		return new LogoutSuccessEvent(authentication);
	}

}
