package io.github.apdmrl.messor.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.github.apdmrl.messor.support.PostgresIntegrationTestSupport;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.web.server.servlet.Session;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.web.server.autoconfigure.ServerProperties;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@AutoConfigureMockMvc
class CsrfEndpointIT extends PostgresIntegrationTestSupport {

	private static final String PROBLEM_JSON = "application/problem+json";

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private ObjectMapper objectMapper;

	@Autowired
	private ServerProperties serverProperties;

	@Test
	void csrfTokenCookieIsIssuedOnResponses() throws Exception {
		MvcResult result = mockMvc.perform(get("/api/private-probe")).andReturn();

		Cookie cookie = result.getResponse().getCookie("XSRF-TOKEN");
		assertThat(cookie).as("XSRF-TOKEN cookie must be issued").isNotNull();
		assertThat(cookie.getValue()).isNotBlank();
		assertThat(cookie.isHttpOnly())
				.as("XSRF-TOKEN cookie must be readable by the SPA")
				.isFalse();
		assertThat(cookie.getPath()).as("XSRF-TOKEN cookie path must be the app root").isEqualTo("/");
	}

	@Test
	void validCookieTokenPassesCsrfFilter() throws Exception {
		Cookie csrf = csrfCookie();
		String token = csrf.getValue();

		MvcResult login = mockMvc.perform(post("/api/auth/login")
				.cookie(csrf)
				.contentType(MediaType.APPLICATION_FORM_URLENCODED)
				.param("email", "admin@demo.messor.app")
				.param("password", "not-the-password")
				.header("X-XSRF-TOKEN", token))
				.andReturn();

		assertThat(login.getResponse().getStatus())
				.as("valid CSRF token must pass the filter (outcome is auth, not 403)")
				.isNotEqualTo(403);
	}

	@Test
	void missingCsrfTokenReturnsProblemDetails() throws Exception {
		MvcResult result = mockMvc.perform(post("/api/auth/login"))
				.andExpect(status().isForbidden())
				.andReturn();

		JsonNode body = problemBody(result);
		assertCsrfProblem(body, result);
	}

	@Test
	void invalidCsrfTokenReturnsProblemDetails() throws Exception {
		String invalidToken = "not-a-valid-token";

		MvcResult result = mockMvc.perform(post("/api/auth/login")
				.header("X-XSRF-TOKEN", invalidToken))
				.andExpect(status().isForbidden())
				.andReturn();

		JsonNode body = problemBody(result);
		assertCsrfProblem(body, result);

		String raw = result.getResponse().getContentAsString();
		assertThat(raw).doesNotContain(invalidToken);
	}

	@Test
	void tokenFromDifferentBrowserIsRejected() throws Exception {
		Cookie firstCookie = csrfCookie();
		String firstToken = firstCookie.getValue();

		Cookie secondCookie = csrfCookie();
		assertThat(secondCookie.getValue()).isNotEqualTo(firstToken);

		MvcResult result = mockMvc.perform(post("/api/auth/login")
				.cookie(secondCookie)
				.header("X-XSRF-TOKEN", firstToken))
				.andExpect(status().isForbidden())
				.andReturn();

		assertCsrfProblem(problemBody(result), result);
	}

	@Test
	void anonymousProtectedRequestReturnsUnauthorizedProblemDetails() throws Exception {
		MvcResult result = mockMvc.perform(get("/api/private-probe"))
				.andExpect(status().isUnauthorized())
				.andReturn();

		JsonNode body = problemBody(result);

		assertThat(body.get("status").asInt()).isEqualTo(401);
		assertThat(body.get("title").asText()).isEqualTo("Unauthorized");
		assertThat(body.get("code").asText()).isEqualTo("UNAUTHENTICATED");
		assertThat(body.get("detail").asText()).isEqualTo("Oturum açmanız gerekiyor.");
		assertThat(body.get("instance").asText()).isEqualTo("/api/private-probe");
		assertThat(result.getResponse().getHeader("Cache-Control")).contains("no-store");
		assertNoLeakedExceptionDetails(body, result);
	}

	@Test
	void sessionTrackingUsesCookieOnly() {
		assertThat(serverProperties.getServlet().getSession().getTrackingModes())
				.containsExactly(Session.SessionTrackingMode.COOKIE);
	}

	@Test
	void crossOriginRequestDoesNotReturnWildcardAllowOrigin() throws Exception {
		MvcResult result = mockMvc.perform(options("/api/private-probe")
				.header("Origin", "https://evil.example")
				.header("Access-Control-Request-Method", "GET"))
				.andReturn();

		assertThat(result.getResponse().getHeader("Access-Control-Allow-Origin")).isNull();
	}

	@Test
	void actuatorHealthIsPublic() throws Exception {
		mockMvc.perform(get("/actuator/health"))
				.andExpect(status().isOk());
	}

	@Test
	void loginWithoutTokenIsRejectedDespitePermitAll() throws Exception {
		mockMvc.perform(post("/api/auth/login"))
				.andExpect(status().isForbidden());
	}

	private void assertCsrfProblem(JsonNode body, MvcResult result) throws Exception {
		assertThat(body.get("status").asInt()).isEqualTo(403);
		assertThat(body.get("title").asText()).isEqualTo("Forbidden");
		assertThat(body.get("code").asText()).isEqualTo("INVALID_CSRF_TOKEN");
		assertThat(body.get("detail").asText()).isNotBlank();
		assertThat(body.get("instance").asText()).isEqualTo("/api/auth/login");
		assertThat(result.getResponse().getHeader("Cache-Control")).contains("no-store");
		assertNoLeakedExceptionDetails(body, result);
	}

	private void assertNoLeakedExceptionDetails(JsonNode body, MvcResult result) throws Exception {
		assertThat(body.has("exception")).isFalse();
		assertThat(body.has("message")).isFalse();
		assertThat(body.has("stackTrace")).isFalse();
		assertThat(body.has("trace")).isFalse();

		String raw = result.getResponse().getContentAsString();
		assertThat(raw).doesNotContain("MissingCsrfTokenException", "InvalidCsrfTokenException", "AccessDeniedException");
	}

	private JsonNode problemBody(MvcResult result) throws Exception {
		String contentType = result.getResponse().getContentType();
		assertThat(contentType).startsWith(PROBLEM_JSON);
		return objectMapper.readTree(result.getResponse().getContentAsString());
	}

	/**
	 * Bootstrap a CSRF token by hitting a request that flows through the CSRF
	 * filter. The anonymous protected probe returns 401 but still writes the
	 * {@code XSRF-TOKEN} cookie, which the SPA would read from the browser.
	 */
	private Cookie csrfCookie() throws Exception {
		MvcResult result = mockMvc.perform(get("/api/private-probe")).andReturn();
		Cookie cookie = result.getResponse().getCookie("XSRF-TOKEN");
		assertThat(cookie).isNotNull();
		return cookie;
	}

}
