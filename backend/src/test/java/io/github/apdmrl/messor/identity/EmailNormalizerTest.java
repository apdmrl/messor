package io.github.apdmrl.messor.identity;

import java.util.Locale;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

class EmailNormalizerTest {

	@AfterEach
	void restoreDefaultLocale() {
		Locale.setDefault(Locale.ROOT);
	}

	@Test
	void trimsAndLowercasesMixedCaseEmail() {
		assertThat(EmailNormalizer.normalize(" Member@Demo.Messor.App "))
				.isEqualTo("member@demo.messor.app");
	}

	@Test
	void leavesLowercaseEmailUnchanged() {
		assertThat(EmailNormalizer.normalize("member@demo.messor.app"))
				.isEqualTo("member@demo.messor.app");
	}

	@Test
	void normalizationIsIndependentOfTheDefaultLocale() {
		Locale.setDefault(Locale.forLanguageTag("tr"));

		assertThat(EmailNormalizer.normalize("MEMBER@DEMO.MESSOR.APP"))
				.isEqualTo("member@demo.messor.app");
	}

	@Test
	void rejectsNull() {
		assertThatIllegalArgumentException()
				.isThrownBy(() -> EmailNormalizer.normalize(null));
	}

	@Test
	void rejectsEmptyString() {
		assertThatIllegalArgumentException()
				.isThrownBy(() -> EmailNormalizer.normalize(""));
	}

	@Test
	void rejectsWhitespaceOnlyInput() {
		assertThatIllegalArgumentException()
				.isThrownBy(() -> EmailNormalizer.normalize("   "));
	}

}
