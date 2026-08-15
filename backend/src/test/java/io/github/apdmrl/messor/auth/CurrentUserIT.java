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
class CurrentUserIT extends PostgresIntegrationTestSupport {

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
	void authenticatedCurrentUserReturnsSafeSummary() throws Exception {
		String password = "correct horse battery staple";
		UserAccount account = UserAccount.create(
				"Current@Demo.Messor.App",
				passwordEncoder.encode(password),
				"Çağrı",
				"Işık",
				UserRole.ORG_ADMIN);
		userAccountRepository.saveAndFlush(account);

		String csrfToken = fetchCsrfToken();
		HttpResponse<byte[]> login = postLogin("current@demo.messor.app", password, csrfToken);

		assertThat(login.statusCode()).isEqualTo(200);

		HttpResponse<byte[]> response = get("/api/auth/me");

		assertThat(response.statusCode()).isEqualTo(200);
		assertThat(contentType(response)).startsWith("application/json");
		assertThat(response.headers().firstValue("Cache-Control").orElse(""))
				.contains("no-store");

		JsonNode body = objectMapper.readTree(decodeUtf8(response));

		assertThat(body.size()).isEqualTo(5);
		assertThat(body.get("id").asText()).isEqualTo(account.getId().toString());
		assertThat(body.get("email").asText()).isEqualTo("current@demo.messor.app");
		assertThat(body.get("firstName").asText()).isEqualTo("Çağrı");
		assertThat(body.get("lastName").asText()).isEqualTo("Işık");
		assertThat(body.get("role").asText()).isEqualTo("ORG_ADMIN");

		assertThat(body.has("password")).isFalse();
		assertThat(body.has("passwordHash")).isFalse();
		assertThat(body.has("status")).isFalse();
		assertThat(body.has("version")).isFalse();
		assertThat(body.has("createdAt")).isFalse();
		assertThat(body.has("updatedAt")).isFalse();
		assertThat(body.has("enabled")).isFalse();
		assertThat(body.has("authorities")).isFalse();

		String raw = decodeUtf8(response);
		assertThat(raw).doesNotContain(password, account.getPasswordHash());
		assertThat(raw).contains("\"firstName\":\"Çağrı\"", "\"lastName\":\"Işık\"");
		assertThat(raw).doesNotContain("\uFFFD");
	}

	@Test
	void anonymousCurrentUserRequestReturnsUnauthorizedProblemDetails() throws Exception {
		String csrfToken = fetchCsrfToken();
		String sessionId = sessionCookieValue();

		HttpResponse<byte[]> response = get("/api/auth/me");

		assertThat(response.statusCode()).isEqualTo(401);
		assertThat(contentType(response)).startsWith("application/problem+json");
		assertThat(response.headers().firstValue("Cache-Control").orElse(""))
				.contains("no-store");

		JsonNode body = objectMapper.readTree(decodeUtf8(response));

		assertThat(body.get("type").asText()).isEqualTo("about:blank");
		assertThat(body.get("title").asText()).isEqualTo("Unauthorized");
		assertThat(body.get("status").asInt()).isEqualTo(401);
		assertThat(body.get("detail").asText()).isEqualTo("Oturum açmanız gerekiyor.");
		assertThat(body.get("instance").asText()).isEqualTo("/api/auth/me");
		assertThat(body.get("code").asText()).isEqualTo("UNAUTHENTICATED");

		assertThat(body.has("id")).isFalse();
		assertThat(body.has("email")).isFalse();
		assertThat(body.has("firstName")).isFalse();
		assertThat(body.has("lastName")).isFalse();
		assertThat(body.has("role")).isFalse();
		assertThat(body.has("password")).isFalse();
		assertThat(body.has("passwordHash")).isFalse();
		assertThat(body.has("version")).isFalse();
		assertThat(body.has("exception")).isFalse();
		assertThat(body.has("message")).isFalse();
		assertThat(body.has("stackTrace")).isFalse();
		assertThat(body.has("trace")).isFalse();

		String raw = decodeUtf8(response);
		assertThat(raw).doesNotContain(sessionId, csrfToken);
		assertThat(raw).doesNotContain("\uFFFD");
	}

	private String fetchCsrfToken() throws Exception {
		HttpResponse<byte[]> response = get("/api/auth/csrf");

		assertThat(response.statusCode()).isEqualTo(200);
		JsonNode body = objectMapper.readTree(decodeUtf8(response));
		return body.get("token").asText();
	}

	private HttpResponse<byte[]> postLogin(String email, String password, String csrfToken)
			throws Exception {
		String form = "email=" + URLEncoder.encode(email, StandardCharsets.UTF_8)
				+ "&password=" + URLEncoder.encode(password, StandardCharsets.UTF_8);

		HttpRequest request = HttpRequest.newBuilder(uri("/api/auth/login"))
				.header("Content-Type", MediaType.APPLICATION_FORM_URLENCODED_VALUE)
				.header("X-CSRF-TOKEN", csrfToken)
				.POST(HttpRequest.BodyPublishers.ofString(form))
				.build();

		return http.send(request, HttpResponse.BodyHandlers.ofByteArray());
	}

	private HttpResponse<byte[]> get(String path) throws Exception {
		HttpRequest request = HttpRequest.newBuilder(uri(path)).GET().build();
		return http.send(request, HttpResponse.BodyHandlers.ofByteArray());
	}

	private URI uri(String path) {
		return URI.create("http://localhost:" + port + path);
	}

	private String contentType(HttpResponse<?> response) {
		return response.headers().firstValue("Content-Type").orElse("");
	}

	private String decodeUtf8(HttpResponse<byte[]> response) {
		return new String(response.body(), StandardCharsets.UTF_8);
	}

	private String sessionCookieValue() {
		return cookieManager.getCookieStore().getCookies().stream()
				.filter(cookie -> "SESSION".equals(cookie.getName()))
				.map(HttpCookie::getValue)
				.findFirst()
				.orElse("");
	}

}
