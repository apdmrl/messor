package io.github.apdmrl.messor.auth;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.CookieManager;
import java.net.HttpCookie;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;

import io.github.apdmrl.messor.identity.UserAccount;
import io.github.apdmrl.messor.identity.UserAccountRepository;
import io.github.apdmrl.messor.identity.UserRole;
import io.github.apdmrl.messor.support.PostgresIntegrationTestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AuthenticationResponseEncodingIT extends PostgresIntegrationTestSupport {

	@LocalServerPort
	private int port;

	@Autowired
	private UserAccountRepository userAccountRepository;

	@Autowired
	private PasswordEncoder passwordEncoder;

	@Autowired
	private ObjectMapper objectMapper;

	private final CookieManager cookieManager = new CookieManager();

	private final HttpClient http = HttpClient.newBuilder().cookieHandler(cookieManager).build();

	@Test
	void problemDetailBodyIsUtf8() throws Exception {
		String password = "correct horse battery staple";
		UserAccount account = UserAccount.create(
				"problem-utf8@demo.messor.app",
				passwordEncoder.encode(password),
				"Ada",
				"Lovelace",
				UserRole.USER);
		userAccountRepository.saveAndFlush(account);

		String csrfToken = fetchCsrfToken();

		HttpResponse<byte[]> response = postLogin(
				"problem-utf8@demo.messor.app", "wrong-password", csrfToken);

		assertThat(response.statusCode()).isEqualTo(401);
		assertThat(contentType(response)).isEqualTo("application/problem+json;charset=UTF-8");

		String body = new String(response.body(), StandardCharsets.UTF_8);
		assertThat(body).contains("\"detail\":\"E-posta veya parola hatalı.\"");
		assertThat(body).doesNotContain("\uFFFD");
	}

	@Test
	void successfulLoginBodyIsUtf8() throws Exception {
		String password = "correct horse battery staple";
		UserAccount account = UserAccount.create(
				"success-utf8@demo.messor.app",
				passwordEncoder.encode(password),
				"Çağrı",
				"Işık",
				UserRole.USER);
		userAccountRepository.saveAndFlush(account);

		String csrfToken = fetchCsrfToken();

		HttpResponse<byte[]> response = postLogin(
				"success-utf8@demo.messor.app", password, csrfToken);

		assertThat(response.statusCode()).isEqualTo(200);
		assertThat(contentType(response)).isEqualTo("application/json;charset=UTF-8");

		String body = new String(response.body(), StandardCharsets.UTF_8);
		assertThat(body).contains("\"firstName\":\"Çağrı\"", "\"lastName\":\"Işık\"");
		assertThat(body).doesNotContain("\uFFFD");
	}

	private String fetchCsrfToken() throws Exception {
				// Bootstrap a request that flows through the CSRF filter, which issues
		// the XSRF-TOKEN cookie that the client echoes in the X-XSRF-TOKEN header.
		HttpRequest request = HttpRequest.newBuilder(uri("/api/private-probe")).GET().build();
		http.send(request, HttpResponse.BodyHandlers.discarding());
		return csrfCookieValue();
		}

	private String csrfCookieValue() {
		return cookieManager.getCookieStore().getCookies().stream()
				.filter(cookie -> "XSRF-TOKEN".equals(cookie.getName()))
				.map(HttpCookie::getValue)
				.findFirst()
				.orElseThrow(() -> new AssertionError("XSRF-TOKEN cookie not issued"));
	}

	private HttpResponse<byte[]> postLogin(String email, String password, String csrfToken)
			throws Exception {
		String form = "email=" + URLEncoder.encode(email, StandardCharsets.UTF_8)
				+ "&password=" + URLEncoder.encode(password, StandardCharsets.UTF_8);

		HttpRequest request = HttpRequest.newBuilder(uri("/api/auth/login"))
				.header("Content-Type", MediaType.APPLICATION_FORM_URLENCODED_VALUE)
								.header("X-XSRF-TOKEN", csrfToken)
				.POST(HttpRequest.BodyPublishers.ofString(form))
				.build();

		return http.send(request, HttpResponse.BodyHandlers.ofByteArray());
	}

	private URI uri(String path) {
		return URI.create("http://localhost:" + port + path);
	}

	private String contentType(HttpResponse<?> response) {
		return response.headers().firstValue("Content-Type").orElse("");
	}

}
