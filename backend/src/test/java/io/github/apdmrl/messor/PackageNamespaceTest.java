package io.github.apdmrl.messor;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class PackageNamespaceTest {

	@Test
	void applicationUsesPublicPackageNamespace() {
		assertThat(MessorApplication.class.getPackageName())
			.isEqualTo("io.github.apdmrl.messor");
	}

}
