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
import java.util.List;
import java.util.Optional;

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
class LogoutIT extends PostgresIntegrationTestSupport {

	private static final String PROBLEM_JSON = "application/problem+json";

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
	void successfulLogoutInvalidatesServerSideSessionAndDeletesSessionCookie() throws Exception {
		String password = "correct horse battery staple";
		UserAccount account = UserAccount.create(
				"Logout@Demo.Messor.App",
				passwordEncoder.encode(password),
				"Çağrı",
				"Işık",
				UserRole.ORG_ADMIN);
		userAccountRepository.saveAndFlush(account);

		LoginSession login = login("logout@demo.messor.app", password);

		HttpResponse<byte[]> getLogout = get("/api/auth/logout");
		assertThat(getLogout.statusCode())
				.as("GET logout must not end the session")
				.isEqualTo(404);
		assertThat(get("/api/auth/me").statusCode())
				.as("authenticated session must survive GET logout")
				.isEqualTo(200);

		String replayedCookieValue = login.cookieValue();

		HttpResponse<byte[]> logout = postLogout(login.headerName(), login.token());
		assertThat(logout.statusCode())
				.as("logout must return 204 No Content")
				.isEqualTo(204);
		assertThat(logout.body())
				.as("logout response body must be empty")
				.isNullOrEmpty();
		assertThat(logout.headers().firstValue("Content-Type"))
				.as("logout must not produce a Content-Type")
				.isEmpty();
		assertThat(logout.headers().firstValue("Cache-Control").orElse(""))
				.as("logout response must be no-store")
				.contains("no-store");

		List<String> setCookies = logout.headers().allValues("Set-Cookie");
		List<String> sessionDeletions = setCookies.stream()
				.filter(header -> header.startsWith("SESSION="))
				.toList();
		assertThat(sessionDeletions)
				.as("logout must produce exactly one session cookie deletion header")
				.hasSize(1);

		String deletionHeader = sessionDeletions.get(0);
		assertThat(deletionHeader)
				.startsWith("SESSION=")
				.contains("Max-Age=0")
				.contains("Path=/")
				.doesNotContain("Domain=");

		assertThat(cookieManager.getCookieStore().getCookies())
				.as("logout must remove the session cookie from the cookie store")
				.extracting(HttpCookie::getName)
				.doesNotContain("SESSION");

		assertThat(get("/api/auth/me").statusCode())
				.as("cookieless request after logout must be unauthenticated")
				.isEqualTo(401);

		assertThat(replayOldCookie(replayedCookieValue).statusCode())
				.as("replayed pre-logout cookie must be rejected server-side")
				.isEqualTo(401);
	}

	@Test
	void logoutWithoutCsrfTokenIsRejectedAndAuthenticatedSessionSurvives() throws Exception {
		String password = "correct horse battery staple";
		UserAccount account = UserAccount.create(
				"Logout-Missing-Csrf@Demo.Messor.App",
				passwordEncoder.encode(password),
				"Ada",
				"Lovelace",
				UserRole.USER);
		userAccountRepository.saveAndFlush(account);

		LoginSession login = login("logout-missing-csrf@demo.messor.app", password);

		HttpResponse<byte[]> logout = postLogoutWithoutCsrf();

		assertThat(logout.statusCode())
				.as("logout without CSRF must be rejected")
				.isEqualTo(403);
		assertThat(contentType(logout))
				.startsWith(PROBLEM_JSON);
		assertThat(logout.headers().firstValue("Cache-Control").orElse(""))
				.contains("no-store");

		JsonNode body = objectMapper.readTree(decodeUtf8(logout));
		assertThat(body.get("type").asText()).isEqualTo("about:blank");
		assertThat(body.get("title").asText()).isEqualTo("Forbidden");
		assertThat(body.get("status").asInt()).isEqualTo(403);
		assertThat(body.get("detail").asText()).isEqualTo("CSRF doğrulaması başarısız.");
		assertThat(body.get("instance").asText()).isEqualTo("/api/auth/logout");
		assertThat(body.get("code").asText()).isEqualTo("INVALID_CSRF_TOKEN");

		assertThat(body.has("exception")).isFalse();
		assertThat(body.has("message")).isFalse();
		assertThat(body.has("stackTrace")).isFalse();
		assertThat(body.has("trace")).isFalse();

		assertThat(get("/api/auth/me").statusCode())
				.as("CSRF-rejected logout must not invalidate the authenticated session")
				.isEqualTo(200);
	}

	@Test
	void logoutWithInvalidCsrfTokenIsRejectedAndAuthenticatedSessionSurvives() throws Exception {
		String password = "correct horse battery staple";
		UserAccount account = UserAccount.create(
				"Logout-Invalid-Csrf@Demo.Messor.App",
				passwordEncoder.encode(password),
				"Ada",
				"Lovelace",
				UserRole.USER);
		userAccountRepository.saveAndFlush(account);

		LoginSession login = login("logout-invalid-csrf@demo.messor.app", password);
		String invalidToken = "not-a-valid-token";

		HttpResponse<byte[]> logout = postLogout(login.headerName(), invalidToken);

		assertThat(logout.statusCode())
				.as("logout with invalid CSRF must be rejected")
				.isEqualTo(403);
		assertThat(contentType(logout))
				.startsWith(PROBLEM_JSON);
		assertThat(logout.headers().firstValue("Cache-Control").orElse(""))
				.contains("no-store");

		JsonNode body = objectMapper.readTree(decodeUtf8(logout));
		assertThat(body.get("type").asText()).isEqualTo("about:blank");
		assertThat(body.get("title").asText()).isEqualTo("Forbidden");
		assertThat(body.get("status").asInt()).isEqualTo(403);
		assertThat(body.get("detail").asText()).isEqualTo("CSRF doğrulaması başarısız.");
		assertThat(body.get("instance").asText()).isEqualTo("/api/auth/logout");
		assertThat(body.get("code").asText()).isEqualTo("INVALID_CSRF_TOKEN");

		assertThat(body.has("exception")).isFalse();
		assertThat(body.has("message")).isFalse();
		assertThat(body.has("stackTrace")).isFalse();
		assertThat(body.has("trace")).isFalse();

		String raw = decodeUtf8(logout);
		assertThat(raw)
				.as("invalid raw CSRF token must not be reflected in the response")
				.doesNotContain(invalidToken);

		assertThat(get("/api/auth/me").statusCode())
				.as("CSRF-rejected logout must not invalidate the authenticated session")
				.isEqualTo(200);
	}

	private LoginSession login(String email, String password) throws Exception {
		// Bootstrap a CSRF token cookie before the state-changing login.
		get("/api/private-probe");
		String token = csrfCookieValue();

		String form = "email=" + URLEncoder.encode(email, StandardCharsets.UTF_8)
				+ "&password=" + URLEncoder.encode(password, StandardCharsets.UTF_8);

		HttpRequest request = HttpRequest.newBuilder(uri("/api/auth/login"))
				.header("Content-Type", MediaType.APPLICATION_FORM_URLENCODED_VALUE)
				.header("X-XSRF-TOKEN", token)
				.POST(HttpRequest.BodyPublishers.ofString(form))
				.build();

		HttpResponse<byte[]> loginResponse = http.send(request, HttpResponse.BodyHandlers.ofByteArray());
		assertThat(loginResponse.statusCode()).isEqualTo(200);

		Optional<HttpCookie> sessionCookie = sessionCookie();
		assertThat(sessionCookie)
				.as("login must establish an authenticated session cookie")
				.isPresent();

		String postLoginToken = ensureCsrfToken();

		return new LoginSession("X-XSRF-TOKEN", postLoginToken, sessionCookie.get().getValue());
	}

	private String csrfCookieValue() {
		return cookieManager.getCookieStore().getCookies().stream()
				.filter(cookie -> "XSRF-TOKEN".equals(cookie.getName()))
				.map(HttpCookie::getValue)
				.findFirst()
				.orElseThrow(() -> new AssertionError("XSRF-TOKEN cookie not issued"));
	}

	private String ensureCsrfToken() throws Exception {
		Optional<HttpCookie> existing = cookieManager.getCookieStore().getCookies().stream()
				.filter(cookie -> "XSRF-TOKEN".equals(cookie.getName()))
				.findFirst();
		if (existing.isEmpty() || existing.get().getValue().isEmpty()) {
			// Force a fresh token cookie after a reissued session.
			get("/api/private-probe");
		}
		return csrfCookieValue();
	}

	private HttpResponse<byte[]> postLogout(String headerName, String token) throws Exception {
		HttpRequest request = HttpRequest.newBuilder(uri("/api/auth/logout"))
				.header(headerName, token)
				.POST(HttpRequest.BodyPublishers.noBody())
				.build();

		return http.send(request, HttpResponse.BodyHandlers.ofByteArray());
	}

	private HttpResponse<byte[]> postLogoutWithoutCsrf() throws Exception {
		HttpRequest request = HttpRequest.newBuilder(uri("/api/auth/logout"))
				.POST(HttpRequest.BodyPublishers.noBody())
				.build();

		return http.send(request, HttpResponse.BodyHandlers.ofByteArray());
	}

	private HttpResponse<byte[]> get(String path) throws Exception {
		HttpRequest request = HttpRequest.newBuilder(uri(path)).GET().build();
		return http.send(request, HttpResponse.BodyHandlers.ofByteArray());
	}

	private HttpResponse<byte[]> replayOldCookie(String cookieValue) throws Exception {
		HttpClient replayClient = HttpClient.newHttpClient();
		HttpRequest request = HttpRequest.newBuilder(uri("/api/auth/me"))
				.header("Cookie", "SESSION=" + cookieValue)
				.GET()
				.build();

		return replayClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
	}

	private Optional<HttpCookie> sessionCookie() {
		return cookieManager.getCookieStore().getCookies().stream()
				.filter(cookie -> "SESSION".equals(cookie.getName()))
				.findFirst();
	}

	private URI uri(String path) {
		return URI.create("http://localhost:" + port + path);
	}

	private String decodeUtf8(HttpResponse<byte[]> response) {
		return new String(response.body(), StandardCharsets.UTF_8);
	}

	private String contentType(HttpResponse<?> response) {
		return response.headers().firstValue("Content-Type").orElse("");
	}

	private record LoginSession(String headerName, String token, String cookieValue) {
	}

}
