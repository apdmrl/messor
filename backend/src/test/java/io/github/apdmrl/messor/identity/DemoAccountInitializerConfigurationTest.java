package io.github.apdmrl.messor.identity;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.context.PropertyPlaceholderAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * Focused configuration tests for {@link DemoAccountInitializer}.
 *
 * <p>These tests use an {@link ApplicationContextRunner} so they are fast and
 * do not require a database. The repository and password encoder are mock
 * beans; the real seed/idempotency behaviour is covered by the Testcontainers
 * integration test {@link DemoAccountInitializerIT}.</p>
 *
 * <p>The canonical {@code messor.demo.password} property is used so the tests
 * are not affected by the outer shell environment's {@code MESSOR_DEMO_PASSWORD}
 * variable.</p>
 */
class DemoAccountInitializerConfigurationTest {

	private static final String DEMO_PASSWORD = "test-only-demo-password-42";

	private final ApplicationContextRunner runner = new ApplicationContextRunner()
			.withConfiguration(AutoConfigurations.of(PropertyPlaceholderAutoConfiguration.class))
			.withUserConfiguration(MockBeans.class)
			.withPropertyValues("messor.demo.password=" + DEMO_PASSWORD);

	@Test
	void demoProfileWithValidPasswordRegistersInitializerBean() {
		runner.withPropertyValues("spring.profiles.active=demo")
				.run(context -> {
					assertThat(context).hasSingleBean(DemoAccountInitializer.class);
					assertThat(context).hasNotFailed();
				});
	}

	@Test
	void noActiveProfileDoesNotRegisterInitializerBean() {
		runner.run(context -> {
			assertThat(context).doesNotHaveBean(DemoAccountInitializer.class);
			assertThat(context).hasNotFailed();
		});
	}

	@Test
	void testProfileDoesNotRegisterInitializerBean() {
		runner.withPropertyValues("spring.profiles.active=test")
				.run(context -> {
					assertThat(context).doesNotHaveBean(DemoAccountInitializer.class);
					assertThat(context).hasNotFailed();
				});
	}

	@Test
	void prodProfileDoesNotRegisterInitializerBean() {
		runner.withPropertyValues("spring.profiles.active=prod")
				.run(context -> {
					assertThat(context).doesNotHaveBean(DemoAccountInitializer.class);
					assertThat(context).hasNotFailed();
				});
	}

	@Test
	void demoProfileWithMissingPropertyFailsFastWithoutLeakingSecret() {
		ApplicationContextRunner missingRunner = new ApplicationContextRunner()
				.withConfiguration(AutoConfigurations.of(PropertyPlaceholderAutoConfiguration.class))
				.withUserConfiguration(MockBeans.class)
				.withPropertyValues("spring.profiles.active=demo")
				.withInitializer(context -> context.getEnvironment().getPropertySources()
						.remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME));

		missingRunner.run(context -> {
			assertThat(context).hasFailed();
			Throwable failure = context.getStartupFailure();
			assertThat(failure).isNotNull();
			assertThat(rootCauseMessage(failure))
					.contains("messor.demo.password")
					.doesNotContain(DEMO_PASSWORD);
		});
	}

	@Test
	void demoProfileWithBlankPasswordFailsFastWithSafeValidationMessage() {
		ApplicationContextRunner blankRunner = new ApplicationContextRunner()
				.withConfiguration(AutoConfigurations.of(PropertyPlaceholderAutoConfiguration.class))
				.withUserConfiguration(MockBeans.class)
				.withPropertyValues("spring.profiles.active=demo", "messor.demo.password=   ");

		blankRunner.run(context -> {
			assertThat(context).hasFailed();
			Throwable failure = context.getStartupFailure();
			assertThat(failure).isNotNull();
			assertThat(rootCauseMessage(failure))
					.contains("MESSOR_DEMO_PASSWORD")
					.contains("required")
					.doesNotContain("   ")
					.doesNotContain(DEMO_PASSWORD);
		});
	}

	private static String rootCauseMessage(Throwable failure) {
		Throwable current = failure;
		while (current.getCause() != null) {
			current = current.getCause();
		}
		return current.getMessage() == null ? "" : current.getMessage();
	}

	@Configuration(proxyBeanMethods = false)
	@Import(DemoAccountInitializer.class)
	static class MockBeans {

		@Bean
		UserAccountRepository userAccountRepository() {
			return mock(UserAccountRepository.class);
		}

		@Bean
		PasswordEncoder passwordEncoder() {
			return mock(PasswordEncoder.class);
		}
	}

}
