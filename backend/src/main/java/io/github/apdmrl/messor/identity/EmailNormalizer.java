package io.github.apdmrl.messor.identity;

import java.util.Locale;

/**
 * Normalizes email addresses for storage and lookup.
 *
 * <p>Normalization is limited to trimming and lowercase conversion using
 * {@link Locale#ROOT}. Email format validation is intentionally out of scope;
 * it belongs to registration, which is not part of the first release.</p>
 */
public final class EmailNormalizer {

	private EmailNormalizer() {
	}

	public static String normalize(String email) {
		if (email == null || email.isBlank()) {
			throw new IllegalArgumentException("email must not be blank");
		}
		return email.trim().toLowerCase(Locale.ROOT);
	}

}
