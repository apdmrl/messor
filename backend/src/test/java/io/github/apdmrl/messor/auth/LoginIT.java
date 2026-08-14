package io.github.apdmrl.messor.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.github.apdmrl.messor.identity.UserAccount;
import io.github.apdmrl.messor.identity.UserAccountRepository;
import io.github.apdmrl.messor.identity.UserRole;
import io.github.apdmrl.messor.support.PostgresIntegrationTestSupport;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@AutoConfigureMockMvc
class LoginIT extends PostgresIntegrationTestSupport {

	private static final String PROBLEM_JSON = "application/problem+json";

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private ObjectMapper objectMapper;

	@Autowired
	private UserAccountRepository userAccountRepository;

	@Autowired
	private PasswordEncoder passwordEncoder;

	@Test
	void successfulLoginReturnsSafeUserSummaryAndCreatesAuthenticatedSession() throws Exception {
		String password = "correct horse battery staple";
		UserAccount account = UserAccount.create(
				"Login@Demo.Messor.App",
				passwordEncoder.encode(password),
				"Ada",
				"Lovelace",
				UserRole.ORG_ADMIN);
		userAccountRepository.saveAndFlush(account);

		MvcResult csrf = fetchCsrfToken();
		JsonNode csrfBody = csrfBody(csrf);
		Cookie session = sessionCookie(csrf);

		MvcResult result = mockMvc.perform(post("/api/auth/login")
				.cookie(session)
				.contentType(MediaType.APPLICATION_FORM_URLENCODED)
				.param("email", "login@demo.messor.app")
				.param("password", password)
				.header(csrfBody.get("headerName").asText(), csrfBody.get("token").asText()))
				.andExpect(status().isOk())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andExpect(header().string("Cache-Control", containsString("no-store")))
				.andReturn();

		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());

		assertThat(body.size()).isEqualTo(5);
		assertThat(body.get("id").asText()).isEqualTo(account.getId().toString());
		assertThat(body.get("email").asText()).isEqualTo("login@demo.messor.app");
		assertThat(body.get("firstName").asText()).isEqualTo("Ada");
		assertThat(body.get("lastName").asText()).isEqualTo("Lovelace");
		assertThat(body.get("role").asText()).isEqualTo("ORG_ADMIN");

		assertThat(body.has("passwordHash")).isFalse();
		assertThat(body.has("status")).isFalse();
		assertThat(body.has("version")).isFalse();
		assertThat(body.has("createdAt")).isFalse();
		assertThat(body.has("updatedAt")).isFalse();

		String raw = result.getResponse().getContentAsString();
		assertThat(raw).doesNotContain(password, account.getPasswordHash());

		assertAuthenticatedSession(result);
	}

	@Test
	void unknownEmailReturnsIndistinguishableFailure() throws Exception {
		String password = "correct horse battery staple";
		MvcResult result = attemptLogin("missing@demo.messor.app", password);

		assertIndistinguishableFailure(result, "missing@demo.messor.app", password);
	}

	@Test
	void wrongPasswordReturnsIndistinguishableFailure() throws Exception {
		String wrongPassword = "wrong horse battery staple";
		UserAccount account = UserAccount.create(
				"wrong-password@demo.messor.app",
				passwordEncoder.encode("correct horse battery staple"),
				"Ada",
				"Lovelace",
				UserRole.USER);
		userAccountRepository.saveAndFlush(account);

		MvcResult result = attemptLogin("wrong-password@demo.messor.app", wrongPassword);

		assertIndistinguishableFailure(result, "wrong-password@demo.messor.app", wrongPassword);
	}

	@Test
	void disabledUserReturnsIndistinguishableFailure() throws Exception {
		String password = "correct horse battery staple";
		UserAccount account = UserAccount.create(
				"disabled-login@demo.messor.app",
				passwordEncoder.encode(password),
				"Ada",
				"Lovelace",
				UserRole.USER);
		account.disable();
		userAccountRepository.saveAndFlush(account);

		MvcResult result = attemptLogin("disabled-login@demo.messor.app", password);

		assertIndistinguishableFailure(result, "disabled-login@demo.messor.app", password);
	}

	@Test
	void successfulLoginRotatesSessionAndCsrfToken() throws Exception {
		String password = "correct horse battery staple";
		String email = "rotation@demo.messor.app";
		UserAccount account = UserAccount.create(
				email,
				passwordEncoder.encode(password),
				"Ada",
				"Lovelace",
				UserRole.USER);
		userAccountRepository.saveAndFlush(account);

		MvcResult csrfBefore = fetchCsrfToken();
		JsonNode csrfBeforeBody = csrfBody(csrfBefore);
		Cookie preLoginSession = sessionCookie(csrfBefore);
		String oldToken = csrfBeforeBody.get("token").asText();
		String headerName = csrfBeforeBody.get("headerName").asText();

		MvcResult login = mockMvc.perform(post("/api/auth/login")
				.cookie(preLoginSession)
				.contentType(MediaType.APPLICATION_FORM_URLENCODED)
				.param("email", email)
				.param("password", password)
				.header(headerName, oldToken))
				.andExpect(status().isOk())
				.andReturn();

		Cookie postLoginSession = sessionCookie(login);
		assertThat(postLoginSession).isNotNull();
		assertThat(preLoginSession.getValue().equals(postLoginSession.getValue()))
				.as("session identifier must rotate on successful login")
				.isFalse();

		MvcResult reuse = mockMvc.perform(post("/api/auth/login")
				.cookie(postLoginSession)
				.contentType(MediaType.APPLICATION_FORM_URLENCODED)
				.param("email", email)
				.param("password", password)
				.header(headerName, oldToken))
				.andExpect(status().isForbidden())
				.andReturn();

		JsonNode reuseBody = problemBody(reuse);
		assertThat(reuseBody.get("code").asText()).isEqualTo("INVALID_CSRF_TOKEN");

		MvcResult csrfAfter = mockMvc.perform(get("/api/auth/csrf").cookie(postLoginSession))
				.andExpect(status().isOk())
				.andReturn();

		JsonNode csrfAfterBody = csrfBody(csrfAfter);
		String newToken = csrfAfterBody.get("token").asText();
		assertThat(newToken.equals(oldToken))
				.as("csrf token must be reissued after login")
				.isFalse();

		mockMvc.perform(post("/api/auth/login")
				.cookie(postLoginSession)
				.contentType(MediaType.APPLICATION_FORM_URLENCODED)
				.param("email", email)
				.param("password", password)
				.header(headerName, newToken))
				.andExpect(status().isOk());
	}

	private MvcResult attemptLogin(String email, String password) throws Exception {
		MvcResult csrf = fetchCsrfToken();
		JsonNode csrfBody = csrfBody(csrf);
		Cookie session = sessionCookie(csrf);

		return mockMvc.perform(post("/api/auth/login")
				.cookie(session)
				.contentType(MediaType.APPLICATION_FORM_URLENCODED)
				.param("email", email)
				.param("password", password)
				.header(csrfBody.get("headerName").asText(), csrfBody.get("token").asText()))
				.andReturn();
	}

	private void assertIndistinguishableFailure(MvcResult result, String email, String password)
			throws Exception {
		assertThat(result.getResponse().getStatus()).isEqualTo(401);
		assertThat(result.getResponse().getContentType()).startsWith(PROBLEM_JSON);
		assertThat(result.getResponse().getHeader("Cache-Control")).contains("no-store");

		JsonNode body = problemBody(result);

		assertThat(body.get("status").asInt()).isEqualTo(401);
		assertThat(body.get("title").asText()).isEqualTo("Unauthorized");
		assertThat(body.get("type").asText()).isEqualTo("about:blank");
		assertThat(body.get("code").asText()).isEqualTo("AUTHENTICATION_FAILED");
		assertThat(body.get("detail").asText()).isEqualTo("E-posta veya parola hatalı.");
		assertThat(body.get("instance").asText()).isEqualTo("/api/auth/login");

		String raw = result.getResponse().getContentAsString();
		assertThat(raw).doesNotContain(email, password);
		assertThat(body.has("exception")).isFalse();
		assertThat(body.has("message")).isFalse();
		assertThat(body.has("stackTrace")).isFalse();
		assertThat(body.has("trace")).isFalse();
	}

	private void assertAuthenticatedSession(MvcResult loginResult) throws Exception {
		Cookie postLoginSession = sessionCookie(loginResult);
		assertThat(postLoginSession).isNotNull();

		MvcResult probe = mockMvc.perform(get("/api/private-probe").cookie(postLoginSession))
				.andReturn();

		assertThat(probe.getResponse().getStatus()).isNotEqualTo(401);
	}

	private MvcResult fetchCsrfToken() throws Exception {
		return mockMvc.perform(get("/api/auth/csrf"))
				.andExpect(status().isOk())
				.andReturn();
	}

	private JsonNode csrfBody(MvcResult result) throws Exception {
		String contentType = result.getResponse().getContentType();
		assertThat(contentType).startsWith("application/json");
		return objectMapper.readTree(result.getResponse().getContentAsString());
	}

	private JsonNode problemBody(MvcResult result) throws Exception {
		String contentType = result.getResponse().getContentType();
		assertThat(contentType).startsWith(PROBLEM_JSON);
		return objectMapper.readTree(result.getResponse().getContentAsString());
	}

	private Cookie sessionCookie(MvcResult result) {
		return result.getResponse().getCookie("SESSION");
	}

}
