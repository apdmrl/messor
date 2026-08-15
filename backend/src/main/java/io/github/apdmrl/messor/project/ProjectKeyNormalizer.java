package io.github.apdmrl.messor.project;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Normalizes and validates project keys.
 *
 * <p>A project key is trimmed and uppercased using {@link Locale#ROOT} and must
 * match {@code ^[A-Z][A-Z0-9]{1,9}$}: it starts with an uppercase letter and is
 * between 2 and 10 characters long, containing only uppercase letters and
 * digits.</p>
 */
public final class ProjectKeyNormalizer {

	private static final Pattern VALID_KEY = Pattern.compile("^[A-Z][A-Z0-9]{1,9}$");

	private ProjectKeyNormalizer() {
	}

	public static String normalize(String key) {
		if (key == null || key.isBlank()) {
			throw new IllegalArgumentException("key must not be blank");
		}
		String normalized = key.trim().toUpperCase(Locale.ROOT);
		if (!VALID_KEY.matcher(normalized).matches()) {
			throw new IllegalArgumentException("key must match ^[A-Z][A-Z0-9]{1,9}$");
		}
		return normalized;
	}

}
