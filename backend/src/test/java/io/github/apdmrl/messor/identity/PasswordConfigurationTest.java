package io.github.apdmrl.messor.identity;

import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.assertj.core.api.Assertions.assertThat;

class PasswordConfigurationTest {

	private static final String RAW_PASSWORD = "test-only-password";

	private final PasswordEncoder passwordEncoder = new PasswordConfiguration().passwordEncoder();

	@Test
	void exposesArgon2PasswordEncoder() {
		assertThat(passwordEncoder).isInstanceOf(Argon2PasswordEncoder.class);
	}

	@Test
	void encodesWithArgon2idPrefix() {
		assertThat(passwordEncoder.encode(RAW_PASSWORD)).startsWith("$argon2id$");
	}

	@Test
	void matchesTheOriginalPassword() {
		String encoded = passwordEncoder.encode(RAW_PASSWORD);

		assertThat(passwordEncoder.matches(RAW_PASSWORD, encoded)).isTrue();
	}

	@Test
	void rejectsAWrongPassword() {
		String encoded = passwordEncoder.encode(RAW_PASSWORD);

		assertThat(passwordEncoder.matches("wrong-test-password", encoded)).isFalse();
	}

	@Test
	void producesDifferentHashesForTheSamePasswordBecauseOfSalt() {
		String first = passwordEncoder.encode(RAW_PASSWORD);
		String second = passwordEncoder.encode(RAW_PASSWORD);

		assertThat(first).isNotEqualTo(second);
	}

}
