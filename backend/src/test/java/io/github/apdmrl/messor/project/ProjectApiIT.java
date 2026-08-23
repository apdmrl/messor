package io.github.apdmrl.messor.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import io.github.apdmrl.messor.identity.UserAccount;
import io.github.apdmrl.messor.identity.UserAccountRepository;
import io.github.apdmrl.messor.identity.UserRole;
import io.github.apdmrl.messor.support.PostgresIntegrationTestSupport;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@AutoConfigureMockMvc
class ProjectApiIT extends PostgresIntegrationTestSupport {

	private static final String PROBLEM_JSON = "application/problem+json";

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private ObjectMapper objectMapper;

	@Autowired
	private UserAccountRepository userAccountRepository;

	@Autowired
	private PasswordEncoder passwordEncoder;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@BeforeEach
	void cleanProjectData() {
		// Isolate each test by removing all project-owned rows. Users created by
		// the login helper are keyed by unique email and are left in place.
		jdbcTemplate.update("DELETE FROM workflow_status");
		jdbcTemplate.update("DELETE FROM project_member");
		jdbcTemplate.update("DELETE FROM project");
	}

	// --- Transactional creation ---

	@Test
	void createProjectNormalizesKeyAndDerivesCreatorFromPrincipal() throws Exception {
		LoginSession admin = login("create-admin@example.com", UserRole.ORG_ADMIN);

		MvcResult result = mockMvc.perform(post("/api/projects").cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"key":"  mes  ","name":"Messor","description":"A tracker"}
						"""))
				.andExpect(status().isCreated())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andExpect(header().string("Cache-Control", containsString("no-store")))
				.andReturn();

		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("key").asText()).isEqualTo("MES");
		assertThat(body.get("name").asText()).isEqualTo("Messor");
		assertThat(body.get("description").asText()).isEqualTo("A tracker");
		assertThat(body.get("currentUserRole").asText()).isEqualTo("PROJECT_LEAD");
		assertThat(body.get("version").asLong()).isEqualTo(0L);
		assertThat(body.get("id").asText()).isNotBlank();
		assertThat(body.get("createdAt").asText()).isNotBlank();
		assertThat(body.get("updatedAt").asText()).isNotBlank();

		// Exactly three statuses in order.
		JsonNode statuses = body.get("workflowStatuses");
		assertThat(statuses.size()).isEqualTo(3);
		assertThat(statuses.get(0).get("code").asText()).isEqualTo("TO_DO");
		assertThat(statuses.get(0).get("displayName").asText()).isEqualTo("Yapılacak");
		assertThat(statuses.get(0).get("position").asInt()).isEqualTo(0);
		assertThat(statuses.get(1).get("code").asText()).isEqualTo("IN_PROGRESS");
		assertThat(statuses.get(1).get("displayName").asText()).isEqualTo("Devam Ediyor");
		assertThat(statuses.get(1).get("position").asInt()).isEqualTo(1);
		assertThat(statuses.get(2).get("code").asText()).isEqualTo("DONE");
		assertThat(statuses.get(2).get("displayName").asText()).isEqualTo("Tamamlandı");
		assertThat(statuses.get(2).get("position").asInt()).isEqualTo(2);

		// Creator membership persisted as PROJECT_LEAD.
		Integer memberCount = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM project_member pm"
						+ " JOIN project p ON p.id = pm.project_id"
						+ " WHERE p.key = 'MES' AND pm.role = 'PROJECT_LEAD'",
				Integer.class);
		assertThat(memberCount).isEqualTo(1);

		// Safe response fields only.
		String raw = result.getResponse().getContentAsString();
		assertThat(raw).doesNotContain("passwordHash", "creatorId", "userAccount");
	}

	@Test
	void createProjectWithDuplicateKeyReturns409AndLeavesNoPartialRows() throws Exception {
		LoginSession admin = login("dup-admin@example.com", UserRole.ORG_ADMIN);

		mockMvc.perform(post("/api/projects").cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"key":"DUPKEY","name":"First"}
						"""))
				.andExpect(status().isCreated());

		MvcResult dup = mockMvc.perform(post("/api/projects").cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"key":"dupkey","name":"Second"}
						"""))
				.andExpect(status().isConflict())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andReturn();

		JsonNode body = problemBody(dup);
		assertThat(body.get("code").asText()).isEqualTo("PROJECT_KEY_ALREADY_EXISTS");
		assertThat(body.get("status").asInt()).isEqualTo(409);
		assertThat(body.get("instance").asText()).isEqualTo("/api/projects");

		// No partial project/member/status rows for the duplicate attempt.
		Integer projectCount = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM project WHERE key = 'DUPKEY'", Integer.class);
		assertThat(projectCount).isEqualTo(1);

		Integer memberCount = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM project_member pm"
						+ " JOIN project p ON p.id = pm.project_id WHERE p.key = 'DUPKEY'",
				Integer.class);
		assertThat(memberCount).isEqualTo(1);

		Integer statusCount = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM workflow_status ws"
						+ " JOIN project p ON p.id = ws.project_id WHERE p.key = 'DUPKEY'",
				Integer.class);
		assertThat(statusCount).isEqualTo(3);

		String raw = dup.getResponse().getContentAsString();
		assertThat(raw).doesNotContain("duplicate", "constraint", "SQL", "uq_project_key");
	}

	// --- Authorization matrix ---

	@Test
	void anonymousProjectListReturns401() throws Exception {
		mockMvc.perform(get("/api/projects"))
				.andExpect(status().isUnauthorized())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
	}

	@Test
	void anonymousProjectCreateReturns403MissingCsrf() throws Exception {
		// CSRF is enforced before authentication for state-changing requests, so
		// an anonymous POST without a token is rejected as a CSRF failure.
		mockMvc.perform(post("/api/projects")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"key":"ANON01","name":"Anon"}
						"""))
				.andExpect(status().isForbidden())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_CSRF_TOKEN"));
	}

	@Test
	void createProjectWithoutCsrfReturns403() throws Exception {
		LoginSession admin = login("csrf-admin@example.com", UserRole.ORG_ADMIN);

		mockMvc.perform(post("/api/projects").cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"key":"CSRF01","name":"No csrf"}
						"""))
				.andExpect(status().isForbidden())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_CSRF_TOKEN"));
	}

	@Test
	void patchProjectWithoutCsrfReturns403() throws Exception {
		LoginSession admin = login("csrf-patch@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CSRFP1", "Original");

		mockMvc.perform(patch("/api/projects/{key}", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"name":"Changed","expectedVersion":0}
						"""))
				.andExpect(status().isForbidden())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_CSRF_TOKEN"));
	}

	@Test
	void nonmemberCannotReadProjectReturns404() throws Exception {
		LoginSession admin = login("nonmember-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "NONMEM", "Hidden");

		LoginSession outsider = login("nonmember-user@example.com", UserRole.USER);

		mockMvc.perform(get("/api/projects/{key}", key).cookie(outsider.session(), outsider.csrfCookie()))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("PROJECT_NOT_FOUND"));
	}

	@Test
	void nonmemberCannotPatchProjectReturns404() throws Exception {
		LoginSession admin = login("nonmember-patch-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "NONMP1", "Hidden");

		LoginSession outsider = login("nonmember-patch-user@example.com", UserRole.USER);

		mockMvc.perform(patch("/api/projects/{key}", key).cookie(outsider.session(), outsider.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(outsider.csrfHeader(), outsider.csrfToken())
				.content("""
						{"name":"Hacked","expectedVersion":0}
						"""))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("PROJECT_NOT_FOUND"));
	}

	@Test
	void memberCanReadProject() throws Exception {
		LoginSession admin = login("member-read-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MEMBR1", "Readable");

		LoginSession member = login("member-read-user@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		mockMvc.perform(get("/api/projects/{key}", key).cookie(member.session(), member.csrfCookie()))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.key").value("MEMBR1"))
				.andExpect(jsonPath("$.currentUserRole").value("MEMBER"));
	}

	@Test
	void viewerCanReadProject() throws Exception {
		LoginSession admin = login("viewer-read-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "VIEWR1", "Readable");

		LoginSession viewer = login("viewer-read-user@example.com", UserRole.USER);
		addMember(key, viewer.userId(), "VIEWER");

		mockMvc.perform(get("/api/projects/{key}", key).cookie(viewer.session(), viewer.csrfCookie()))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.currentUserRole").value("VIEWER"));
	}

	@Test
	void memberCannotPatchProjectReturns403() throws Exception {
		LoginSession admin = login("member-patch-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MEMBP1", "Original");

		LoginSession member = login("member-patch-user@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		mockMvc.perform(patch("/api/projects/{key}", key).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"name":"Hacked","expectedVersion":0}
						"""))
				.andExpect(status().isForbidden())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("FORBIDDEN"));
	}

	@Test
	void viewerCannotPatchProjectReturns403() throws Exception {
		LoginSession admin = login("viewer-patch-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "VIEWP1", "Original");

		LoginSession viewer = login("viewer-patch-user@example.com", UserRole.USER);
		addMember(key, viewer.userId(), "VIEWER");

		mockMvc.perform(patch("/api/projects/{key}", key).cookie(viewer.session(), viewer.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(viewer.csrfHeader(), viewer.csrfToken())
				.content("""
						{"name":"Hacked","expectedVersion":0}
						"""))
				.andExpect(status().isForbidden())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("FORBIDDEN"));
	}

	@Test
	void projectLeadCanPatchProject() throws Exception {
		LoginSession admin = login("lead-patch-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LEADP1", "Original");

		LoginSession lead = login("lead-patch-user@example.com", UserRole.USER);
		addMember(key, lead.userId(), "PROJECT_LEAD");

		mockMvc.perform(patch("/api/projects/{key}", key).cookie(lead.session(), lead.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(lead.csrfHeader(), lead.csrfToken())
				.content("""
						{"name":"Updated","description":"New desc","expectedVersion":0}
						"""))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.name").value("Updated"))
				.andExpect(jsonPath("$.description").value("New desc"))
				.andExpect(jsonPath("$.version").value(1));
	}

	@Test
	void orgAdminCanListReadAndUpdateAnyProject() throws Exception {
		LoginSession admin = login("orgadmin-all@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "ORGAD1", "Admin project");

		mockMvc.perform(get("/api/projects/{key}", key).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.currentUserRole").value("PROJECT_LEAD"));

		mockMvc.perform(patch("/api/projects/{key}", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"name":"Admin updated","expectedVersion":0}
						"""))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.name").value("Admin updated"));
	}

	@Test
	void orgAdminListsAllProjectsWhileUserListsOnlyMemberships() throws Exception {
		LoginSession admin = login("list-admin@example.com", UserRole.ORG_ADMIN);
		createProject(admin, "LISTA1", "Admin one");
		createProject(admin, "LISTA2", "Admin two");

		LoginSession member = login("list-member@example.com", UserRole.USER);
		addMember("LISTA1", member.userId(), "MEMBER");

		MvcResult adminList = mockMvc.perform(get("/api/projects").cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode adminBody = objectMapper.readTree(adminList.getResponse().getContentAsString());
		assertThat(adminBody.get("totalItems").asInt()).isEqualTo(2);

		MvcResult memberList = mockMvc.perform(get("/api/projects").cookie(member.session(), member.csrfCookie()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode memberBody = objectMapper.readTree(memberList.getResponse().getContentAsString());
		assertThat(memberBody.get("totalItems").asInt()).isEqualTo(1);
		assertThat(memberBody.get("items").get(0).get("key").asText()).isEqualTo("LISTA1");
	}

	// --- Validation and errors ---

	@Test
	void createProjectWithInvalidKeyReturns400() throws Exception {
		LoginSession admin = login("invalid-key@example.com", UserRole.ORG_ADMIN);

		mockMvc.perform(post("/api/projects").cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"key":"1BAD","name":"Bad"}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
	}

	@Test
	void createProjectWithBlankNameReturns400() throws Exception {
		LoginSession admin = login("blank-name@example.com", UserRole.ORG_ADMIN);

		mockMvc.perform(post("/api/projects").cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"key":"BLANK1","name":"   "}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
	}

	@Test
	void createProjectWithTooLongKeyReturns400() throws Exception {
		LoginSession admin = login("long-key@example.com", UserRole.ORG_ADMIN);

		mockMvc.perform(post("/api/projects").cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"key":"ABCDEFGHIJK","name":"Bad"}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
	}

	@Test
	void patchProjectWithStaleVersionReturns409() throws Exception {
		LoginSession admin = login("stale-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "STALE1", "Original");

		mockMvc.perform(patch("/api/projects/{key}", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"name":"First update","expectedVersion":0}
						"""))
				.andExpect(status().isOk());

		MvcResult stale = mockMvc.perform(patch("/api/projects/{key}", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"name":"Stale update","expectedVersion":0}
						"""))
				.andExpect(status().isConflict())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andReturn();

		JsonNode body = problemBody(stale);
		assertThat(body.get("code").asText()).isEqualTo("VERSION_CONFLICT");
		assertThat(body.get("status").asInt()).isEqualTo(409);
	}

	@Test
	void patchProjectCannotChangeKey() throws Exception {
		LoginSession admin = login("immutable-key@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "IMMUT1", "Original");

		mockMvc.perform(patch("/api/projects/{key}", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"name":"Renamed","expectedVersion":0}
						"""))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.key").value("IMMUT1"));
	}

	@Test
	void patchProjectWithNegativeVersionReturns400() throws Exception {
		LoginSession admin = login("neg-version@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "NEGV01", "Original");

		mockMvc.perform(patch("/api/projects/{key}", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"name":"Bad","expectedVersion":-1}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
	}

	@Test
	void listProjectsRejectsInvalidPageSizeAndSort() throws Exception {
		LoginSession admin = login("list-bounds@example.com", UserRole.ORG_ADMIN);

		mockMvc.perform(get("/api/projects").cookie(admin.session(), admin.csrfCookie()).param("size", "0"))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

		mockMvc.perform(get("/api/projects").cookie(admin.session(), admin.csrfCookie()).param("size", "101"))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

		mockMvc.perform(get("/api/projects").cookie(admin.session(), admin.csrfCookie()).param("page", "-1"))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

		mockMvc.perform(get("/api/projects").cookie(admin.session(), admin.csrfCookie()).param("sort", "passwordHash"))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
	}

	@Test
	void listProjectsUsesBoundedPaginationAndStablePageResponse() throws Exception {
		LoginSession admin = login("list-pagination@example.com", UserRole.ORG_ADMIN);
		createProject(admin, "PAGE01", "One");
		createProject(admin, "PAGE02", "Two");
		createProject(admin, "PAGE03", "Three");

		MvcResult result = mockMvc.perform(get("/api/projects").cookie(admin.session(), admin.csrfCookie())
				.param("page", "0")
				.param("size", "2")
				.param("sort", "key,asc"))
				.andExpect(status().isOk())
				.andReturn();

		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("page").asInt()).isEqualTo(0);
		assertThat(body.get("size").asInt()).isEqualTo(2);
		assertThat(body.get("totalItems").asInt()).isEqualTo(3);
		assertThat(body.get("totalPages").asInt()).isEqualTo(2);
		assertThat(body.get("items").size()).isEqualTo(2);
		assertThat(body.get("items").get(0).get("key").asText()).isEqualTo("PAGE01");
		assertThat(body.get("items").get(1).get("key").asText()).isEqualTo("PAGE02");
	}

	@Test
	void errorResponsesNeverLeakInternalDetails() throws Exception {
		LoginSession admin = login("leak-admin@example.com", UserRole.ORG_ADMIN);

		MvcResult result = mockMvc.perform(post("/api/projects").cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"key":"1BAD","name":"Bad"}
						"""))
				.andExpect(status().isBadRequest())
				.andReturn();

		String raw = result.getResponse().getContentAsString();
		assertThat(raw).doesNotContain("exception", "stackTrace", "trace", "SQL", "constraint");
		assertThat(result.getResponse().getHeader("Cache-Control")).contains("no-store");
	}

	@Test
	void createProjectWithMalformedJsonReturns400ValidationFailed() throws Exception {
		LoginSession admin = login("malformed-json@example.com", UserRole.ORG_ADMIN);

		MvcResult result = mockMvc.perform(post("/api/projects").cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"key":"MALF01","name":
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andReturn();

		JsonNode body = problemBody(result);
		assertThat(body.get("code").asText()).isEqualTo("VALIDATION_FAILED");
		assertThat(body.get("status").asInt()).isEqualTo(400);

		String raw = result.getResponse().getContentAsString();
		assertThat(raw).doesNotContain("exception", "stackTrace", "trace", "SQL", "constraint");
	}

	@Test
	void listProjectsRejectsNonNumericPageReturns400() throws Exception {
		LoginSession admin = login("bad-page@example.com", UserRole.ORG_ADMIN);

		MvcResult result = mockMvc.perform(get("/api/projects").cookie(admin.session(), admin.csrfCookie())
				.param("page", "abc"))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andReturn();

		JsonNode body = problemBody(result);
		assertThat(body.get("code").asText()).isEqualTo("VALIDATION_FAILED");
		assertThat(body.get("status").asInt()).isEqualTo(400);
	}

	@Test
	void unsupportedProjectHttpMethodReturns405MethodNotAllowed() throws Exception {
		LoginSession admin = login("bad-method@example.com", UserRole.ORG_ADMIN);

		MvcResult result = mockMvc.perform(delete("/api/projects").cookie(admin.session(), admin.csrfCookie())
				.header(admin.csrfHeader(), admin.csrfToken()))
				.andExpect(status().isMethodNotAllowed())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andReturn();

		JsonNode body = problemBody(result);
		assertThat(body.get("code").asText()).isEqualTo("METHOD_NOT_ALLOWED");
		assertThat(body.get("status").asInt()).isEqualTo(405);
	}

	// --- Helpers ---

	private String createProject(LoginSession session, String key, String name) throws Exception {
		MvcResult result = mockMvc.perform(post("/api/projects").cookie(session.session(), session.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(session.csrfHeader(), session.csrfToken())
				.content("""
						{"key":"%s","name":"%s"}
						""".formatted(key, name)))
				.andExpect(status().isCreated())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		return body.get("key").asText();
	}

	private void addMember(String projectKey, UUID userId, String role) {
		jdbcTemplate.update(
				"""
				INSERT INTO project_member (id, project_id, user_account_id, role)
				SELECT gen_random_uuid(), p.id, ?, ?
				FROM project p WHERE p.key = ?
				""",
				userId, role, projectKey);
	}

	private LoginSession login(String email, UserRole role) throws Exception {
		String password = "correct horse battery staple";
		UserAccount account = UserAccount.create(
				email,
				passwordEncoder.encode(password),
				"Ada",
				"Lovelace",
				role);
		userAccountRepository.saveAndFlush(account);

		MvcResult csrf = mockMvc.perform(get("/api/private-probe")).andReturn();
		Cookie csrfBody = csrf.getResponse().getCookie("XSRF-TOKEN");


		MvcResult login = mockMvc.perform(post("/api/auth/login")
				.cookie(csrfBody)
				.contentType(MediaType.APPLICATION_FORM_URLENCODED)
				.param("email", email)
				.param("password", password)
				.header("X-XSRF-TOKEN", csrfBody.getValue()))
				.andExpect(status().isOk())
				.andReturn();

		Cookie postLoginSession = login.getResponse().getCookie("SESSION");
		MvcResult csrfAfter = mockMvc.perform(get("/api/private-probe").cookie(postLoginSession)).andReturn();
		Cookie csrfAfterBody = csrfAfter.getResponse().getCookie("XSRF-TOKEN");

		return new LoginSession(account.getId(), postLoginSession, csrfAfterBody, "X-XSRF-TOKEN", csrfAfterBody.getValue());
	}

	private JsonNode problemBody(MvcResult result) throws Exception {
		String contentType = result.getResponse().getContentType();
		assertThat(contentType).startsWith(PROBLEM_JSON);
		return objectMapper.readTree(result.getResponse().getContentAsString());
	}

	private record LoginSession(UUID userId, Cookie session, Cookie csrfCookie, String csrfHeader, String csrfToken) {}

}
