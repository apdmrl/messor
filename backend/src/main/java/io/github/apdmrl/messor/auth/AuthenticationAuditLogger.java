package io.github.apdmrl.messor.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.security.authentication.event.AbstractAuthenticationFailureEvent;
import org.springframework.security.authentication.event.AuthenticationSuccessEvent;
import org.springframework.security.authentication.event.LogoutSuccessEvent;
import org.springframework.stereotype.Component;

import io.github.apdmrl.messor.identity.MessorUserPrincipal;

/**
 * Logs stable, safe audit events for authentication and logout.
 *
 * <p>Only the internal user UUID is logged as the user identifier. Email,
 * profile fields, password hashes, submitted credentials and any
 * authentication/session material are intentionally never written to the log.
 * Failed logins are logged as a single generic event without any identity or
 * credential detail.</p>
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

	@EventListener
	public void onAuthenticationFailure(AbstractAuthenticationFailureEvent event) {
		log.info("AUTH_LOGIN_FAILURE");
	}

	@EventListener
	public void onLogoutSuccess(LogoutSuccessEvent event) {
		if (event.getAuthentication().getPrincipal() instanceof MessorUserPrincipal principal) {
			log.info("AUTH_LOGOUT_SUCCESS user_id={}", principal.getId());
		} else {
			log.info("AUTH_LOGOUT_SUCCESS");
		}
	}

}
