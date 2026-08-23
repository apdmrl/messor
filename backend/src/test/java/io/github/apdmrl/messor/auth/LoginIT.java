package io.github.apdmrl.messor.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;

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
				"Çağrı",
				"Işık",
				UserRole.ORG_ADMIN);
		userAccountRepository.saveAndFlush(account);

		Cookie csrf = csrfCookie();

		MvcResult result = mockMvc.perform(post("/api/auth/login")
				.cookie(csrf)
				.contentType(MediaType.APPLICATION_FORM_URLENCODED)
				.param("email", "login@demo.messor.app")
				.param("password", password)
				.header("X-XSRF-TOKEN", csrf.getValue()))
				.andExpect(status().isOk())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andExpect(header().string("Cache-Control", containsString("no-store")))
				.andReturn();

		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());

		assertThat(body.size()).isEqualTo(5);
		assertThat(body.get("id").asText()).isEqualTo(account.getId().toString());
		assertThat(body.get("email").asText()).isEqualTo("login@demo.messor.app");
		assertThat(body.get("firstName").asText()).isEqualTo("Çağrı");
		assertThat(body.get("lastName").asText()).isEqualTo("Işık");
		assertThat(body.get("role").asText()).isEqualTo("ORG_ADMIN");

		String utf8 = decodeUtf8(result);
		assertThat(utf8).contains("\"firstName\":\"Çağrı\"", "\"lastName\":\"Işık\"");
		assertThat(utf8).doesNotContain("\uFFFD");

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
	void successfulLoginEstablishesSessionAndKeepsCsrfTokenUsable() throws Exception {
		String password = "correct horse battery staple";
		String email = "rotation@demo.messor.app";
		UserAccount account = UserAccount.create(
				email,
				passwordEncoder.encode(password),
				"Ada",
				"Lovelace",
				UserRole.USER);
		userAccountRepository.saveAndFlush(account);

		Cookie csrf = csrfCookie();
		String token = csrf.getValue();

		MvcResult login = mockMvc.perform(post("/api/auth/login")
				.cookie(csrf)
				.contentType(MediaType.APPLICATION_FORM_URLENCODED)
				.param("email", email)
				.param("password", password)
				.header("X-XSRF-TOKEN", token))
				.andExpect(status().isOk())
				.andReturn();

		Cookie postLoginSession = sessionCookie(login);
		assertThat(postLoginSession).as("login must establish a session").isNotNull();

		// Login clears the CSRF token, so a fresh one is issued on the next
		// flow-through request. Bootstrap it and reuse it against the new
		// session to prove the double-submit contract stays coherent.
		Cookie freshCsrf = csrfCookie();
		String newToken = freshCsrf.getValue();
		assertThat(newToken).as("csrf token must be reissued after login").isNotEqualTo(token);

		mockMvc.perform(post("/api/auth/login")
				.cookie(postLoginSession)
				.cookie(freshCsrf)
				.contentType(MediaType.APPLICATION_FORM_URLENCODED)
				.param("email", email)
				.param("password", password)
				.header("X-XSRF-TOKEN", newToken))
				.andExpect(status().isOk());
	}

	private MvcResult attemptLogin(String email, String password) throws Exception {
		Cookie csrf = csrfCookie();

		return mockMvc.perform(post("/api/auth/login")
				.cookie(csrf)
				.contentType(MediaType.APPLICATION_FORM_URLENCODED)
				.param("email", email)
				.param("password", password)
				.header("X-XSRF-TOKEN", csrf.getValue()))
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

		String utf8 = decodeUtf8(result);
		assertThat(utf8).contains("\"detail\":\"E-posta veya parola hatalı.\"");
		assertThat(utf8).doesNotContain("\uFFFD");

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

		assertThat(probe.getResponse().getStatus()).isEqualTo(404);
	}

	private String decodeUtf8(MvcResult result) {
		return new String(result.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
	}

	private Cookie csrfCookie() throws Exception {
		MvcResult result = mockMvc.perform(get("/api/private-probe")).andReturn();
		Cookie cookie = result.getResponse().getCookie("XSRF-TOKEN");
		assertThat(cookie).isNotNull();
		return cookie;
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
