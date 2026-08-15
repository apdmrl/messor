package io.github.apdmrl.messor.auth;

import java.util.UUID;

import io.github.apdmrl.messor.identity.MessorUserPrincipal;
import io.github.apdmrl.messor.identity.UserRole;

/**
 * Immutable, safe projection of an authenticated user for API responses.
 *
 * <p>This record intentionally exposes only the identity and profile fields.
 * Password hashes, account status, version and timestamps are never included.</p>
 */
public record UserSummary(UUID id, String email, String firstName, String lastName, UserRole role) {

	public static UserSummary from(MessorUserPrincipal principal) {
		return new UserSummary(
				principal.getId(),
				principal.getEmail(),
				principal.getFirstName(),
				principal.getLastName(),
				principal.getRole());
	}

}
