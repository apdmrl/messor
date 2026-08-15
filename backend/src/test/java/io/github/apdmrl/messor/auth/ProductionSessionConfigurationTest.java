package io.github.apdmrl.messor.auth;

import java.time.Duration;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.web.server.Cookie;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.server.autoconfigure.ServerProperties;
import org.springframework.boot.web.server.servlet.Session;
import org.springframework.context.annotation.Configuration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Verifies the production session cookie contract and that the development
 * configuration keeps localhost HTTP usable.
 *
 * <p>The production profile must bind a {@code __Host-MESSOR_SESSION} cookie
 * with {@code Secure}, {@code HttpOnly}, {@code SameSite=Lax}, {@code Path=/}
 * and no {@code Domain}. Session tracking must remain cookie-only. The default
 * (development) configuration must keep {@code Secure=false} so localhost HTTP
 * keeps working and must not leak the production cookie name.</p>
 */
class ProductionSessionConfigurationTest {

	private static final String PRODUCTION_COOKIE_NAME = "__Host-MESSOR_SESSION";

	private final ApplicationContextRunner runner = new ApplicationContextRunner()
			.withInitializer(new ConfigDataApplicationContextInitializer())
			.withUserConfiguration(ServerPropertiesConfiguration.class);

	@Configuration(proxyBeanMethods = false)
	@EnableConfigurationProperties(ServerProperties.class)
	static class ServerPropertiesConfiguration {
	}

	@Test
	void productionProfileUsesSecureHostCookie() {
		runner.withPropertyValues("spring.profiles.active=prod").run(context -> {
			Cookie cookie = sessionCookie(context);

			assertThat(cookie.getName()).isEqualTo(PRODUCTION_COOKIE_NAME);
			assertThat(cookie.getSecure()).isTrue();
			assertThat(cookie.getHttpOnly()).isTrue();
			assertThat(cookie.getSameSite()).isEqualTo(Cookie.SameSite.LAX);
			assertThat(cookie.getPath()).isEqualTo("/");
			assertThat(cookie.getDomain()).isNull();
		});
	}

	@Test
	void productionProfileKeepsCookieOnlySessionTracking() {
		runner.withPropertyValues("spring.profiles.active=prod").run(context -> {
			Session session = session(context);

			assertThat(session.getTrackingModes()).isEqualTo(Set.of(Session.SessionTrackingMode.COOKIE));
		});
	}

	@Test
	void productionProfileKeepsTheExistingSessionTimeout() {
		runner.withPropertyValues("spring.profiles.active=prod").run(context -> {
			Session session = session(context);

			assertThat(session.getTimeout()).isEqualTo(Duration.ofMinutes(30));
		});
	}

	@Test
	void developmentConfigurationKeepsSecureFalse() {
		runner.run(context -> {
			Cookie cookie = sessionCookie(context);

			assertThat(cookie.getSecure()).isFalse();
		});
	}

	@Test
	void developmentConfigurationDoesNotLeakTheProductionCookieName() {
		runner.run(context -> {
			Cookie cookie = sessionCookie(context);

			assertThat(cookie.getName()).isNotEqualTo(PRODUCTION_COOKIE_NAME);
		});
	}

	private static Session session(org.springframework.context.ApplicationContext context) {
		return context.getBean(ServerProperties.class).getServlet().getSession();
	}

	private static Cookie sessionCookie(org.springframework.context.ApplicationContext context) {
		return session(context).getCookie();
	}

}
