package io.github.apdmrl.messor.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.security.authentication.event.AuthenticationSuccessEvent;
import org.springframework.stereotype.Component;

import io.github.apdmrl.messor.identity.MessorUserPrincipal;

/**
 * Logs a stable, safe audit event for successful form logins.
 *
 * <p>Only the internal user UUID is logged as the user identifier. Email,
 * profile fields, password hashes and any authentication/session material are
 * intentionally never written to the log.</p>
 */
@Component
public class AuthenticationAuditLogger {

	private static final Logger log = LoggerFactory.getLogger(AuthenticationAuditLogger.class);

	@EventListener
	public void onAuthenticationSuccess(AuthenticationSuccessEvent event) {
		if (event.getAuthentication().getPrincipal() instanceof MessorUserPrincipal principal) {
			log.info("AUTH_LOGIN_SUCCESS user_id={}", principal.getId());
		}
	}

}
