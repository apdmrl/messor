package io.github.apdmrl.messor.issue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import io.github.apdmrl.messor.identity.UserAccount;
import io.github.apdmrl.messor.identity.UserAccountRepository;
import io.github.apdmrl.messor.identity.UserRole;
import io.github.apdmrl.messor.support.PostgresIntegrationTestSupport;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterEach;
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

/**
 * Contract test for filtered project issue listing
 * ({@code GET /api/projects/{projectKey}/issues}).
 *
 * <p>Covers type/status/assignee/archive filters, the active/archived/all
 * archive contract, bounded pagination with a globally-unique final ordering
 * (no duplicates/missing when walking pages), strict sort validation, safe
 * nonmember 404 behavior, and safe handling of an assignee from another
 * project. Archived issues must be findable in the project workspace.</p>
 */
@AutoConfigureMockMvc
class IssueListFiltersIT extends PostgresIntegrationTestSupport {

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
	void cleanData() {
		cleanupAllRows();
	}

	@AfterEach
	void cleanDataAfter() {
		cleanupAllRows();
	}

	@Test
	void typeStatusAndAssigneeFiltersCombine() throws Exception {
		LoginSession admin = login("flt-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "FLT01", "Filter project");

		LoginSession assignee = login("flt-assignee@example.com", UserRole.USER);
		LoginSession other = login("flt-other@example.com", UserRole.USER);
		addMember(key, assignee.userId(), "MEMBER");
		addMember(key, other.userId(), "MEMBER");

		String aBugTodo = createIssue(admin, key, "BUG", "Bug todo", null, assignee.userId());
		createIssue(admin, key, "BUG", "Bug other", null, other.userId());
		createIssue(admin, key, "TASK", "Task todo", null, assignee.userId());
		createIssue(admin, key, "STORY", "Story todo", null, assignee.userId());
		setStatusAndRank(aBugTodo, "IN_PROGRESS");

		// type filter
		JsonNode byType = listAndExpect(admin, key, "type=BUG");
		assertThat(byType.get("totalItems").asLong()).isEqualTo(2L);
		for (JsonNode item : byType.get("items")) {
			assertThat(item.get("type").asText()).isEqualTo("BUG");
		}

		// status filter
		JsonNode byStatus = listAndExpect(admin, key, "status=IN_PROGRESS");
		assertThat(byStatus.get("totalItems").asLong()).isEqualTo(1L);
		assertThat(byStatus.get("items").get(0).get("issueKey").asText()).isEqualTo(aBugTodo);

		// assignee filter
		JsonNode byAssignee = listAndExpect(admin, key, "assignee=" + assignee.userId());
		assertThat(byAssignee.get("totalItems").asLong()).isEqualTo(3L);
		for (JsonNode item : byAssignee.get("items")) {
			assertThat(item.get("assigneeId").asText()).isEqualTo(assignee.userId().toString());
		}

		// combined type + assignee
		JsonNode combined = listAndExpect(admin, key,
				"type=BUG&assignee=" + assignee.userId());
		assertThat(combined.get("totalItems").asLong()).isEqualTo(1L);
		assertThat(combined.get("items").get(0).get("issueKey").asText()).isEqualTo(aBugTodo);
	}

	@Test
	void assigneeFromAnotherProjectYieldsEmptySafely() throws Exception {
		LoginSession admin = login("flt-cross-admin@example.com", UserRole.ORG_ADMIN);
		String keyA = createProject(admin, "FLT02", "Project A");
		String keyB = createProject(admin, "FLT03", "Project B");

		LoginSession aMember = login("flt-cross-a@example.com", UserRole.USER);
		LoginSession bMember = login("flt-cross-b@example.com", UserRole.USER);
		addMember(keyA, aMember.userId(), "MEMBER");
		addMember(keyB, bMember.userId(), "MEMBER");

		createIssue(admin, keyA, "TASK", "In A", null, aMember.userId());
		createIssue(admin, keyB, "TASK", "In B", null, bMember.userId());

		// Filtering project A by an assignee who belongs only to project B returns
		// an empty result, never an error and never a cross-project issue.
		JsonNode body = listAndExpect(admin, keyA, "assignee=" + bMember.userId());
		assertThat(body.get("totalItems").asLong()).isZero();
		assertThat(body.get("items").isEmpty()).isTrue();
	}

	@Test
	void archiveContractActiveArchivedAndAll() throws Exception {
		LoginSession admin = login("flt-arch-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "FLT04", "Archive project");

		LoginSession member = login("flt-arch-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		String active = createIssue(admin, key, "TASK", "Active", null, member.userId());
		String archived = createIssue(admin, key, "TASK", "Archived", null, member.userId());
		jdbcTemplate.update("UPDATE issue SET archived = TRUE, version = version + 1"
				+ " WHERE human_key = ?", archived);

		// Default: active only.
		JsonNode activeOnly = listAndExpect(admin, key, "");
		assertThat(activeOnly.get("totalItems").asLong()).isEqualTo(1L);
		assertThat(activeOnly.get("items").get(0).get("issueKey").asText()).isEqualTo(active);

		// archived-only.
		JsonNode archivedOnly = listAndExpect(admin, key, "archive=archived");
		assertThat(archivedOnly.get("totalItems").asLong()).isEqualTo(1L);
		assertThat(archivedOnly.get("items").get(0).get("issueKey").asText()).isEqualTo(archived);
		assertThat(archivedOnly.get("items").get(0).get("archived").asBoolean()).isTrue();

		// all.
		JsonNode all = listAndExpect(admin, key, "archive=all");
		assertThat(all.get("totalItems").asLong()).isEqualTo(2L);
		assertThat(textValues(all.get("items"), "issueKey")).containsExactlyInAnyOrder(active, archived);
	}

	@Test
	void paginationIsBoundedAndDeterministicAcrossPages() throws Exception {
		LoginSession admin = login("flt-page-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "FLT05", "Paging project");

		LoginSession member = login("flt-page-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		for (int i = 1; i <= 5; i++) {
			createIssue(admin, key, "TASK", "Task " + i, null, member.userId());
		}

		List<String> allKeys = new ArrayList<>();
		for (int page = 0; page < 3; page++) {
			JsonNode body = listAndExpect(admin, key, "page=" + page + "&size=2");
			allKeys.addAll(textValues(body.get("items"), "issueKey"));
		}
		// size=2 over 5 issues -> pages of 2,2,1 -> exactly 5 unique issues, no
		// duplicates, none missing.
		assertThat(allKeys).hasSize(5);
		assertThat(allKeys).doesNotHaveDuplicates();
	}

	@Test
	void hostileSortPageAndSizeAreRejected() throws Exception {
		LoginSession admin = login("flt-host-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "FLT06", "Hostile");

		LoginSession member = login("flt-host-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		expectValidationFailed(perform(admin, key, "sort=number;select"));
		expectValidationFailed(perform(admin, key, "sort=passwordHash,asc"));
		expectValidationFailed(perform(admin, key, "sort=title,up"));
		expectValidationFailed(perform(admin, key, "sort=number"));
		expectValidationFailed(perform(admin, key, "page=-1"));
		expectValidationFailed(perform(admin, key, "size=0"));
		expectValidationFailed(perform(admin, key, "size=101"));
		expectValidationFailed(perform(admin, key, "archive=everything"));
	}

	@Test
	void malformedAssigneeUuidIsRejected() throws Exception {
		LoginSession admin = login("flt-badassign-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "FLT07", "Bad assignee");

		expectValidationFailed(perform(admin, key, "assignee=not-a-uuid"));
	}

	@Test
	void nonmemberListReturns404() throws Exception {
		LoginSession admin = login("flt-nonmember-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "FLT08", "Hidden");

		LoginSession outsider = login("flt-nonmember@example.com", UserRole.USER);

		MvcResult result = mockMvc.perform(get("/api/projects/{key}/issues", key)
				.cookie(outsider.session()))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("PROJECT_NOT_FOUND"))
				.andExpect(jsonPath("$.detail").value("Proje bulunamadı."))
				.andReturn();
		assertNoInternalDetail(result);
	}

	@Test
	void archiveAllAllowsFindingArchivedIssueInWorkspace() throws Exception {
		LoginSession admin = login("flt-findarch-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "FLT09", "Find archived");

		LoginSession member = login("flt-findarch-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		String archived = createIssue(admin, key, "BUG", "Gone but findable",
				null, member.userId());
		jdbcTemplate.update("UPDATE issue SET archived = TRUE, version = version + 1"
				+ " WHERE human_key = ?", archived);

		JsonNode body = listAndExpect(admin, key, "archive=archived&type=BUG");
		assertThat(body.get("totalItems").asLong()).isEqualTo(1L);
		assertThat(body.get("items").get(0).get("issueKey").asText()).isEqualTo(archived);
		assertThat(body.get("items").get(0).get("archived").asBoolean()).isTrue();
	}

	// ------------------------------------------------------------------
	// Helpers
	// ------------------------------------------------------------------

	private JsonNode listAndExpect(LoginSession session, String projectKey, String query)
			throws Exception {
		String url = "/api/projects/{key}/issues".replace("{key}", projectKey);
		MvcResult result = mockMvc.perform(get(url + (query.isEmpty() ? "" : "?" + query))
				.cookie(session.session()))
				.andExpect(status().isOk())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andExpect(header().string("Cache-Control", containsString("no-store")))
				.andReturn();
		return objectMapper.readTree(result.getResponse().getContentAsString());
	}

	private org.springframework.test.web.servlet.ResultActions perform(
			LoginSession session, String projectKey, String query) throws Exception {
		String url = "/api/projects/{key}/issues".replace("{key}", projectKey);
		return mockMvc.perform(get(url + "?" + query).cookie(session.session()));
	}

	private void expectValidationFailed(
			org.springframework.test.web.servlet.ResultActions result) throws Exception {
		MvcResult mr = result
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andReturn();
		assertNoInternalDetail(mr);
	}

	private List<String> textValues(JsonNode items, String field) {
		List<String> values = new ArrayList<>();
		for (JsonNode item : items) {
			values.add(item.get(field).asText());
		}
		return values;
	}

	private void setStatusAndRank(String issueKey, String statusCode) {
		jdbcTemplate.update(
				"UPDATE issue SET workflow_status_id ="
						+ " (SELECT ws.id FROM workflow_status ws"
						+ "  JOIN project p ON p.id = ws.project_id"
						+ "  JOIN issue i ON i.project_id = p.id"
						+ "  WHERE i.human_key = ? AND ws.code = ?),"
						+ " version = version + 1"
						+ " WHERE human_key = ?",
				issueKey, statusCode, issueKey);
	}

	private void assertNoInternalDetail(MvcResult result) throws Exception {
		String raw = result.getResponse().getContentAsString().toLowerCase();
		assertThat(raw).doesNotContain("exception", "stacktrace", "trace", "sql",
				"constraint", "duplicate", "password", "token", "cookie", "session");
	}

	private void cleanupAllRows() {
		for (String table : List.of("issue_activity", "issue", "project_issue_counter",
				"workflow_status", "project_member", "project", "user_account")) {
			if (tableExists(table)) {
				jdbcTemplate.update("DELETE FROM " + table);
			}
		}
	}

	private boolean tableExists(String tableName) {
		Integer count = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM information_schema.tables"
						+ " WHERE table_schema = 'public' AND table_name = ?",
				Integer.class, tableName);
		return count != null && count == 1;
	}

	private String createProject(LoginSession session, String key, String name)
			throws Exception {
		MvcResult result = mockMvc.perform(post("/api/projects")
				.cookie(session.session())
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

	private String createIssue(LoginSession session, String projectKey, String type,
			String title, String description, UUID assigneeId) throws Exception {
		String descJson = description == null ? "null" : "\"" + description + "\"";
		String assigneeJson = assigneeId == null ? "null" : "\"" + assigneeId + "\"";
		MvcResult result = mockMvc.perform(post("/api/projects/{key}/issues", projectKey)
				.cookie(session.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(session.csrfHeader(), session.csrfToken())
				.content("""
						{"type":"%s","title":"%s","description":%s,"assigneeId":%s}
						""".formatted(type, title, descJson, assigneeJson)))
				.andExpect(status().isCreated())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		return body.get("issueKey").asText();
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
				email, passwordEncoder.encode(password), "Ada", "Lovelace", role);
		userAccountRepository.saveAndFlush(account);

		MvcResult csrf = mockMvc.perform(get("/api/auth/csrf"))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode csrfBody = objectMapper.readTree(csrf.getResponse().getContentAsString());
		Cookie preLoginSession = csrf.getResponse().getCookie("SESSION");

		MvcResult login = mockMvc.perform(post("/api/auth/login")
				.cookie(preLoginSession)
				.contentType(MediaType.APPLICATION_FORM_URLENCODED)
				.param("email", email)
				.param("password", password)
				.header(csrfBody.get("headerName").asText(), csrfBody.get("token").asText()))
				.andExpect(status().isOk())
				.andReturn();

		Cookie postLoginSession = login.getResponse().getCookie("SESSION");
		MvcResult csrfAfter = mockMvc.perform(get("/api/auth/csrf").cookie(postLoginSession))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode csrfAfterBody = objectMapper
				.readTree(csrfAfter.getResponse().getContentAsString());

		return new LoginSession(account.getId(), postLoginSession,
				csrfAfterBody.get("headerName").asText(), csrfAfterBody.get("token").asText());
	}

	private record LoginSession(UUID userId, Cookie session, String csrfHeader,
			String csrfToken) {
	}
}
