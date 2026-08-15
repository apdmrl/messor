package io.github.apdmrl.messor.project;

import java.util.Locale;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

class ProjectKeyNormalizerTest {

	@AfterEach
	void restoreDefaultLocale() {
		Locale.setDefault(Locale.ROOT);
	}

	@Test
	void trimsAndUppercasesMixedCaseKey() {
		assertThat(ProjectKeyNormalizer.normalize("  mes  "))
				.isEqualTo("MES");
	}

	@Test
	void uppercasesLowercaseKey() {
		assertThat(ProjectKeyNormalizer.normalize("mes"))
				.isEqualTo("MES");
	}

	@Test
	void acceptsValidShortKey() {
		assertThat(ProjectKeyNormalizer.normalize("AB"))
				.isEqualTo("AB");
	}

	@Test
	void acceptsValidAlphanumericKey() {
		assertThat(ProjectKeyNormalizer.normalize("mes123"))
				.isEqualTo("MES123");
	}

	@Test
	void rejectsSingleCharacterKey() {
		assertThatIllegalArgumentException()
				.isThrownBy(() -> ProjectKeyNormalizer.normalize("A"));
	}

	@Test
	void acceptsMaximumLengthKey() {
		assertThat(ProjectKeyNormalizer.normalize("ABCDEFGHIJ"))
				.isEqualTo("ABCDEFGHIJ");
	}

	@Test
	void normalizationIsIndependentOfTheDefaultLocale() {
		Locale.setDefault(Locale.forLanguageTag("tr"));

		assertThat(ProjectKeyNormalizer.normalize("mes"))
				.isEqualTo("MES");
	}

	@Test
	void rejectsNull() {
		assertThatIllegalArgumentException()
				.isThrownBy(() -> ProjectKeyNormalizer.normalize(null));
	}

	@Test
	void rejectsEmptyString() {
		assertThatIllegalArgumentException()
				.isThrownBy(() -> ProjectKeyNormalizer.normalize(""));
	}

	@Test
	void rejectsWhitespaceOnlyInput() {
		assertThatIllegalArgumentException()
				.isThrownBy(() -> ProjectKeyNormalizer.normalize("   "));
	}

	@Test
	void rejectsKeyStartingWithDigit() {
		assertThatIllegalArgumentException()
				.isThrownBy(() -> ProjectKeyNormalizer.normalize("1MES"));
	}

	@Test
	void rejectsKeyContainingSymbols() {
		assertThatIllegalArgumentException()
				.isThrownBy(() -> ProjectKeyNormalizer.normalize("MES-1"));
	}

	@Test
	void rejectsKeyContainingSpacesInside() {
		assertThatIllegalArgumentException()
				.isThrownBy(() -> ProjectKeyNormalizer.normalize("ME S"));
	}

	@Test
	void rejectsKeyLongerThanTenCharacters() {
		assertThatIllegalArgumentException()
				.isThrownBy(() -> ProjectKeyNormalizer.normalize("ABCDEFGHIJK"));
	}

}
