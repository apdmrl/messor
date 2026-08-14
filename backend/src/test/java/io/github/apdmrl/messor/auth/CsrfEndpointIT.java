package io.github.apdmrl.messor.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
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
	void csrfEndpointReturnsExpectedContract() throws Exception {
		MvcResult result = mockMvc.perform(get("/api/auth/csrf"))
				.andExpect(status().isOk())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andExpect(header().string("Cache-Control", containsString("no-store")))
				.andReturn();

		JsonNode body = csrfBody(result);

		assertThat(body.size()).isEqualTo(3);
		assertThat(body.get("headerName").asText()).isEqualTo("X-CSRF-TOKEN");
		assertThat(body.get("parameterName").asText()).isEqualTo("_csrf");
		assertThat(body.get("token").asText()).isNotBlank();
	}

	@Test
	void csrfEndpointDoesNotWriteTokenCookie() throws Exception {
		MvcResult result = mockMvc.perform(get("/api/auth/csrf"))
				.andExpect(status().isOk())
				.andReturn();

		assertThat(result.getResponse().getCookie("XSRF-TOKEN")).isNull();
	}

	@Test
	void twoMaskedTokensDifferForSameSession() throws Exception {
		MvcResult first = fetchCsrfToken();
		Cookie session = sessionCookie(first);

		MvcResult second = mockMvc.perform(get("/api/auth/csrf").cookie(session))
				.andExpect(status().isOk())
				.andReturn();

		String firstToken = csrfBody(first).get("token").asText();
		String secondToken = csrfBody(second).get("token").asText();

		assertThat(firstToken).isNotEqualTo(secondToken);
	}

	@Test
	void validSameSessionTokenPassesCsrfFilter() throws Exception {
		MvcResult csrf = fetchCsrfToken();
		JsonNode body = csrfBody(csrf);
		Cookie session = sessionCookie(csrf);

		MvcResult login = mockMvc.perform(post("/api/auth/login")
				.cookie(session)
				.contentType(MediaType.APPLICATION_FORM_URLENCODED)
				.header(body.get("headerName").asText(), body.get("token").asText()))
				.andReturn();

		assertThat(login.getResponse().getStatus()).isNotEqualTo(403);
	}

	@Test
	void tokenIsSentUsingDynamicHeaderNameNotBodyOrUrl() throws Exception {
		MvcResult csrf = fetchCsrfToken();
		JsonNode body = csrfBody(csrf);
		Cookie session = sessionCookie(csrf);

		MvcResult login = mockMvc.perform(post("/api/auth/login")
				.cookie(session)
				.contentType(MediaType.APPLICATION_FORM_URLENCODED)
				.param("email", "admin@demo.messor.app")
				.header(body.get("headerName").asText(), body.get("token").asText()))
				.andReturn();

		assertThat(login.getResponse().getStatus()).isNotEqualTo(403);
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
				.header("X-CSRF-TOKEN", invalidToken))
				.andExpect(status().isForbidden())
				.andReturn();

		JsonNode body = problemBody(result);
		assertCsrfProblem(body, result);

		String raw = result.getResponse().getContentAsString();
		assertThat(raw).doesNotContain(invalidToken);
	}

	@Test
	void tokenFromSessionAUsedWithSessionBReturnsProblemDetails() throws Exception {
		MvcResult sessionA = fetchCsrfToken();
		JsonNode bodyA = csrfBody(sessionA);

		MvcResult sessionB = fetchCsrfToken();
		Cookie cookieB = sessionCookie(sessionB);

		MvcResult result = mockMvc.perform(post("/api/auth/login")
				.cookie(cookieB)
				.header(bodyA.get("headerName").asText(), bodyA.get("token").asText()))
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
	void csrfEndpointIsPublic() throws Exception {
		mockMvc.perform(get("/api/auth/csrf"))
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

	private MvcResult fetchCsrfToken() throws Exception {
		return mockMvc.perform(get("/api/auth/csrf"))
				.andExpect(status().isOk())
				.andReturn();
	}

	private JsonNode csrfBody(MvcResult result) throws Exception {
		return objectMapper.readTree(result.getResponse().getContentAsString());
	}

	private Cookie sessionCookie(MvcResult result) {
		return result.getResponse().getCookie("SESSION");
	}

}
