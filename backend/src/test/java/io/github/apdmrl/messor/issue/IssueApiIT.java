package io.github.apdmrl.messor.issue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Map;
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
 * RED-phase API contract test for issue creation and lifecycle.
 *
 * <p>This test asserts the locked create contract for
 * {@code POST /api/projects/{projectKey}/issues} and the locked lifecycle
 * contract for {@code GET /api/issues/{issueKey}},
 * {@code PATCH /api/issues/{issueKey}}, {@code POST /api/issues/{issueKey}/archive}
 * and {@code GET /api/issues/{issueKey}/activity}. In the current RED phase the
 * lifecycle endpoints/domain production code does not exist, so every
 * endpoint-dependent lifecycle scenario is expected to fail with a 404/405 (or
 * a validation/authorization failure that proves the harness is sound) rather
 * than a broken fixture.</p>
 *
 * <p>No future production Issue classes are referenced. All fixtures use
 * synthetic UUIDs/titles and the existing project/identity production classes.
 * No passwords, tokens, cookies or secrets are logged or asserted.</p>
 */
@AutoConfigureMockMvc
class IssueApiIT extends PostgresIntegrationTestSupport {

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
	void cleanIssueData() {
		cleanupAllRows();
	}

	@AfterEach
	void cleanIssueDataAfter() {
		cleanupAllRows();
	}

	// ------------------------------------------------------------------
	// Successful creation
	// ------------------------------------------------------------------

	@Test
	void orgAdminCreateDerivesNumberKeyReporterStatusAndRank() throws Exception {
		LoginSession admin = login("issue-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "ISSUE01", "Admin project");

		MvcResult result = mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"type":"STORY","title":"First story","description":"A story","assigneeId":null}
						"""))
				.andExpect(status().isCreated())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andExpect(header().string("Cache-Control", containsString("no-store")))
				.andExpect(header().string("Location", containsString("/api/issues/ISSUE01-1")))
				.andReturn();

		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("id").asText()).isNotBlank();
		assertThat(body.get("issueKey").asText()).isEqualTo("ISSUE01-1");
		assertThat(body.get("projectKey").asText()).isEqualTo("ISSUE01");
		assertThat(body.get("number").asLong()).isEqualTo(1L);
		assertThat(body.get("type").asText()).isEqualTo("STORY");
		assertThat(body.get("title").asText()).isEqualTo("First story");
		assertThat(body.get("description").asText()).isEqualTo("A story");
		assertThat(body.get("statusCode").asText()).isEqualTo("TO_DO");
		assertThat(body.get("reporterId").asText()).isEqualTo(admin.userId().toString());
		assertThat(body.get("assigneeId").isNull()).isTrue();
		assertThat(body.get("rank").asLong()).isEqualTo(1024L);
		assertThat(body.get("archived").asBoolean()).isFalse();
		assertThat(body.get("version").asLong()).isEqualTo(0L);
		assertThat(body.get("createdAt").asText()).isNotBlank();
		assertThat(body.get("updatedAt").asText()).isNotBlank();

		// Persisted row matches the derived values.
		Map<String, Object> row = jdbcTemplate.queryForMap(
				"SELECT number, human_key, type, title, workflow_status_id, reporter_id,"
						+ " assignee_id, rank, archived, version"
						+ " FROM issue WHERE project_id = (SELECT id FROM project WHERE key = ?)",
				key);
		assertThat(row.get("number")).isEqualTo(1L);
		assertThat(row.get("human_key")).isEqualTo("ISSUE01-1");
		assertThat(row.get("type")).isEqualTo("STORY");
		assertThat(row.get("title")).isEqualTo("First story");
		assertThat(row.get("reporter_id")).isEqualTo(admin.userId());
		assertThat(row.get("assignee_id")).isNull();
		assertThat(row.get("rank")).isEqualTo(1024L);
		assertThat(row.get("archived")).isEqualTo(false);
		assertThat(row.get("version")).isEqualTo(0L);

		// The workflow status is the project's TO_DO status.
		Integer statusCount = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM issue i"
						+ " JOIN workflow_status ws ON ws.id = i.workflow_status_id"
						+ " JOIN project p ON p.id = i.project_id"
						+ " WHERE p.key = ? AND ws.code = 'TO_DO'",
				Integer.class, key);
		assertThat(statusCount).isEqualTo(1);

		// Counter advanced to 2.
		Long nextNumber = jdbcTemplate.queryForObject(
				"SELECT next_number FROM project_issue_counter"
						+ " WHERE project_id = (SELECT id FROM project WHERE key = ?)",
				Long.class, key);
		assertThat(nextNumber).isEqualTo(2L);

		// Safe DTO only: the exact allowed top-level field set, with the required
		// reporterId/assigneeId/statusCode present and no nested JPA entities or
		// sensitive identity fields.
		assertSafeIssueDto(body);
	}

	@Test
	void projectLeadCreateSucceeds() throws Exception {
		LoginSession admin = login("issue-lead-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "ISSUE02", "Lead project");

		LoginSession lead = login("issue-lead@example.com", UserRole.USER);
		addMember(key, lead.userId(), "PROJECT_LEAD");

		mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(lead.session(), lead.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(lead.csrfHeader(), lead.csrfToken())
				.content("""
						{"type":"TASK","title":"Lead task","description":null,"assigneeId":null}
						"""))
				.andExpect(status().isCreated())
				.andExpect(jsonPath("$.issueKey").value("ISSUE02-1"))
				.andExpect(jsonPath("$.reporterId").value(lead.userId().toString()));
	}

	@Test
	void memberCreateSucceeds() throws Exception {
		LoginSession admin = login("issue-member-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "ISSUE03", "Member project");

		LoginSession member = login("issue-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"type":"BUG","title":"Member bug","description":null,"assigneeId":null}
						"""))
				.andExpect(status().isCreated())
				.andExpect(jsonPath("$.issueKey").value("ISSUE03-1"))
				.andExpect(jsonPath("$.reporterId").value(member.userId().toString()));
	}

	@Test
	void nullAssigneeSucceeds() throws Exception {
		LoginSession admin = login("issue-nullassign-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "ISSUE04", "Null assignee");

		mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"type":"STORY","title":"Unassigned","description":null,"assigneeId":null}
						"""))
				.andExpect(status().isCreated())
				.andExpect(jsonPath("$.assigneeId").doesNotExist());
	}

	@Test
	void sameProjectViewerAssigneeSucceeds() throws Exception {
		LoginSession admin = login("issue-viewerassign-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "ISSUE05", "Viewer assignee");

		LoginSession viewer = login("issue-viewerassign@example.com", UserRole.USER);
		addMember(key, viewer.userId(), "VIEWER");

		mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"type":"TASK","title":"Assigned to viewer","description":null,
						 "assigneeId":"%s"}
						""".formatted(viewer.userId())))
				.andExpect(status().isCreated())
				.andExpect(jsonPath("$.assigneeId").value(viewer.userId().toString()));
	}

	@Test
	void twoSequentialCreatesProduceNumbersOneTwoAndRanks() throws Exception {
		LoginSession admin = login("issue-seq-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "ISSUE06", "Sequential");

		MvcResult first = mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"type":"STORY","title":"First","description":null,"assigneeId":null}
						"""))
				.andExpect(status().isCreated())
				.andReturn();
		JsonNode firstBody = objectMapper.readTree(first.getResponse().getContentAsString());
		assertThat(firstBody.get("number").asLong()).isEqualTo(1L);
		assertThat(firstBody.get("issueKey").asText()).isEqualTo("ISSUE06-1");
		assertThat(firstBody.get("rank").asLong()).isEqualTo(1024L);

		MvcResult second = mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"type":"TASK","title":"Second","description":null,"assigneeId":null}
						"""))
				.andExpect(status().isCreated())
				.andReturn();
		JsonNode secondBody = objectMapper.readTree(second.getResponse().getContentAsString());
		assertThat(secondBody.get("number").asLong()).isEqualTo(2L);
		assertThat(secondBody.get("issueKey").asText()).isEqualTo("ISSUE06-2");
		assertThat(secondBody.get("rank").asLong()).isEqualTo(2048L);
	}

	@Test
	void successfulCreateProducesExactlyOneCreatedActivityWithControlledSummary() throws Exception {
		LoginSession admin = login("issue-activity-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "ISSUE07", "Activity");

		LoginSession assignee = login("issue-activity-assignee@example.com", UserRole.USER);
		addMember(key, assignee.userId(), "MEMBER");

		mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"type":"BUG","title":"Activity bug","description":null,
						 "assigneeId":"%s"}
						""".formatted(assignee.userId())))
				.andExpect(status().isCreated());

		// Exactly one CREATED activity for the issue, by the authenticated actor.
		List<Map<String, Object>> activities = jdbcTemplate.queryForList(
				"SELECT ia.actor_id, ia.type, ia.summary"
						+ " FROM issue_activity ia"
						+ " JOIN issue i ON i.id = ia.issue_id"
						+ " JOIN project p ON p.id = i.project_id"
						+ " WHERE p.key = ?",
				key);
		assertThat(activities).hasSize(1);
		Map<String, Object> activity = activities.get(0);
		assertThat(activity.get("actor_id")).isEqualTo(admin.userId());
		assertThat(activity.get("type")).isEqualTo("CREATED");

		// Summary is controlled JSONB with an exact key set and typed values.
		// The request type is BUG, so the summary must record BUG, the initial
		// TO_DO status, and the assignee identifier. No title, description, email,
		// credentials, or arbitrary fields are permitted.
		JsonNode summary = objectMapper.readTree(String.valueOf(activity.get("summary")));
		assertThat(summary.isObject()).isTrue();
		assertThat(summary.size()).isEqualTo(3);
		assertThat(summary.propertyNames())
				.containsExactlyInAnyOrder("type", "statusCode", "assigneeId");
		assertThat(summary.get("type").asText()).isEqualTo("BUG");
		assertThat(summary.get("statusCode").asText()).isEqualTo("TO_DO");
		assertThat(summary.get("assigneeId").asText()).isEqualTo(assignee.userId().toString());

		String rawSummary = summary.toString();
		assertThat(rawSummary).doesNotContain("Activity bug", "description");
		assertThat(rawSummary).doesNotContain("issue-activity-admin@example.com");
		assertThat(rawSummary).doesNotContain("issue-activity-assignee@example.com");
		assertThat(rawSummary).doesNotContain("password", "token", "cookie", "session");
	}

	// ------------------------------------------------------------------
	// Authorization matrix
	// ------------------------------------------------------------------

	@Test
	void viewerCreateReturns403AndInsertsNothing() throws Exception {
		LoginSession admin = login("issue-viewer-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "ISSUE08", "Viewer project");

		LoginSession viewer = login("issue-viewer@example.com", UserRole.USER);
		addMember(key, viewer.userId(), "VIEWER");

		MvcResult result = mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(viewer.session(), viewer.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(viewer.csrfHeader(), viewer.csrfToken())
				.content("""
						{"type":"STORY","title":"Viewer attempt","description":null,"assigneeId":null}
						"""))
				.andExpect(status().isForbidden())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("FORBIDDEN"))
				.andExpect(jsonPath("$.detail").value("Bu işlem için yetkiniz yok."))
				.andReturn();

		assertNoIssueOrActivityOrCounter(key);
		assertNoInternalDetail(result);
	}

	@Test
	void nonmemberCreateReturns404AndInsertsNothing() throws Exception {
		LoginSession admin = login("issue-nonmember-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "ISSUE09", "Hidden project");

		LoginSession outsider = login("issue-nonmember@example.com", UserRole.USER);

		MvcResult result = mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(outsider.session(), outsider.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(outsider.csrfHeader(), outsider.csrfToken())
				.content("""
						{"type":"STORY","title":"Outsider attempt","description":null,"assigneeId":null}
						"""))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("PROJECT_NOT_FOUND"))
				.andExpect(jsonPath("$.detail").value("Proje bulunamadı."))
				.andReturn();

		assertNoIssueOrActivityOrCounter(key);
		assertNoInternalDetail(result);
	}

	@Test
	void anonymousCreateReturns401() throws Exception {
		// Obtain a CSRF token for the anonymous session (the csrf endpoint is
		// permitAll) so the request passes CSRF but fails authentication.
		MvcResult csrf = mockMvc.perform(get("/api/private-probe")).andReturn();
		Cookie csrfBody = csrf.getResponse().getCookie("XSRF-TOKEN");
		Cookie anonSession = csrf.getResponse().getCookie("SESSION");

		mockMvc.perform(post("/api/projects/ANY/issues").cookie(csrfBody)
				.contentType(MediaType.APPLICATION_JSON)
				.header("X-XSRF-TOKEN", csrfBody.getValue())
				.content("""
						{"type":"STORY","title":"Anon","description":null,"assigneeId":null}
						"""))
				.andExpect(status().isUnauthorized())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("UNAUTHENTICATED"))
				.andExpect(jsonPath("$.detail").value("Oturum açmanız gerekiyor."));
	}

	@Test
	void missingCsrfReturns403InvalidCsrfToken() throws Exception {
		LoginSession admin = login("issue-csrf-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "ISSUE10", "Csrf project");

		MvcResult result = mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"type":"STORY","title":"No csrf","description":null,"assigneeId":null}
						"""))
				.andExpect(status().isForbidden())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_CSRF_TOKEN"))
				.andExpect(jsonPath("$.detail").value("CSRF doğrulaması başarısız."))
				.andReturn();

		// A CSRF rejection must not create any issue, activity, or counter rows.
		// (assertNoInternalDetail is intentionally not applied here: the stable
		// INVALID_CSRF_TOKEN code legitimately contains the substring "token".)
		assertNoIssueOrActivityOrCounter(key);
	}

	// ------------------------------------------------------------------
	// Assignee validation
	// ------------------------------------------------------------------

	@Test
	void nonmemberOrUnknownAssigneeReturns400InvalidAssignee() throws Exception {
		LoginSession admin = login("issue-badassign-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "ISSUE11", "Bad assignee");

		// Unknown UUID that is not a user at all.
		MvcResult unknown = mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"type":"STORY","title":"Unknown assignee","description":null,
						 "assigneeId":"%s"}
						""".formatted(UUID.randomUUID())))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_ASSIGNEE"))
				.andReturn();
		assertNoInternalDetail(unknown);

		// A real user who is not a member of the project.
		LoginSession outsider = login("issue-badassign-outsider@example.com", UserRole.USER);
		MvcResult nonmember = mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"type":"STORY","title":"Nonmember assignee","description":null,
						 "assigneeId":"%s"}
						""".formatted(outsider.userId())))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_ASSIGNEE"))
				.andReturn();
		assertNoInternalDetail(nonmember);

		assertNoIssueOrActivityOrCounter(key);
	}

	@Test
	void disabledProjectMemberCannotBeAssignedAndDoesNotAdvanceCounter() throws Exception {
		LoginSession admin = login("issue-disabledassign-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "ISSUE21", "Disabled assignee");

		// A user whose account is DISABLED but who holds a valid membership in the
		// project. A disabled account must not be assignable even though the
		// membership row exists.
		UserAccount disabled = UserAccount.create(
				"issue-disabledassign@example.com",
				passwordEncoder.encode("correct horse battery staple"),
				"Ada",
				"Lovelace",
				UserRole.USER);
		disabled.disable();
		userAccountRepository.saveAndFlush(disabled);
		addMember(key, disabled.getId(), "MEMBER");

		MvcResult result = mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"type":"STORY","title":"Disabled assignee","description":null,
						 "assigneeId":"%s"}
						""".formatted(disabled.getId())))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_ASSIGNEE"))
				.andReturn();
		assertNoInternalDetail(result);

		// No issue, activity, or counter row may be created and the counter must
		// not advance for a rejected assignee.
		assertNoIssueOrActivityOrCounter(key);
	}

	// ------------------------------------------------------------------
	// Request validation
	// ------------------------------------------------------------------

	@Test
	void invalidTypeReturns400ValidationFailed() throws Exception {
		LoginSession admin = login("issue-type-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "ISSUE12", "Type validation");

		mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"type":"EPIC","title":"Bad type","description":null,"assigneeId":null}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andExpect(jsonPath("$.detail").value("İstek doğrulama kurallarını karşılamıyor."));

		mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"type":null,"title":"Null type","description":null,"assigneeId":null}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andExpect(jsonPath("$.detail").value("İstek doğrulama kurallarını karşılamıyor."));
	}

	@Test
	void blankTitleReturns400ValidationFailed() throws Exception {
		LoginSession admin = login("issue-title-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "ISSUE13", "Title validation");

		mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"type":"STORY","title":"   ","description":null,"assigneeId":null}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andExpect(jsonPath("$.detail").value("İstek doğrulama kurallarını karşılamıyor."));
	}

	@Test
	void titleOver200Returns400ValidationFailed() throws Exception {
		LoginSession admin = login("issue-longtitle-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "ISSUE14", "Long title");

		String longTitle = "x".repeat(201);
		mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"type":"STORY","title":"%s","description":null,"assigneeId":null}
						""".formatted(longTitle)))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andExpect(jsonPath("$.detail").value("İstek doğrulama kurallarını karşılamıyor."));
	}

	@Test
	void descriptionOver10000Returns400ValidationFailed() throws Exception {
		LoginSession admin = login("issue-longdesc-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "ISSUE15", "Long description");

		String longDescription = "y".repeat(10001);
		mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"type":"STORY","title":"Long desc","description":"%s","assigneeId":null}
						""".formatted(longDescription)))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andExpect(jsonPath("$.detail").value("İstek doğrulama kurallarını karşılamıyor."));
	}

	@Test
	void malformedAssigneeUuidReturns400ValidationFailed() throws Exception {
		LoginSession admin = login("issue-malformedassign-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "ISSUE16", "Malformed assignee");

		mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"type":"STORY","title":"Bad assignee","description":null,
						 "assigneeId":"not-a-uuid"}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andExpect(jsonPath("$.detail").value("İstek doğrulama kurallarını karşılamıyor."));
	}

	// ------------------------------------------------------------------
	// Derived-field tampering and atomicity
	// ------------------------------------------------------------------

	@Test
	void maliciousExtraDerivedFieldsCannotControlServerValues() throws Exception {
		LoginSession admin = login("issue-tamper-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "ISSUE17", "Tamper");

		MvcResult result = mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"type":"STORY","title":"Tampered","description":null,"assigneeId":null,
						 "reporterId":"%s","actorId":"%s","number":999,"issueKey":"HACK-999",
						 "statusCode":"DONE","rank":1,"archived":true,"version":99}
						""".formatted(UUID.randomUUID(), UUID.randomUUID())))
				.andExpect(status().isCreated())
				.andReturn();

		// The response reflects only server-derived values, never the tampered ones.
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("issueKey").asText()).isEqualTo("ISSUE17-1");
		assertThat(body.get("number").asLong()).isEqualTo(1L);
		assertThat(body.get("statusCode").asText()).isEqualTo("TO_DO");
		assertThat(body.get("rank").asLong()).isEqualTo(1024L);
		assertThat(body.get("archived").asBoolean()).isFalse();
		assertThat(body.get("version").asLong()).isEqualTo(0L);
		assertThat(body.get("reporterId").asText()).isEqualTo(admin.userId().toString());

		// The persisted issue row matches the server-derived values, with the
		// authenticated admin as reporter and the project's TO_DO workflow status.
		Map<String, Object> row = jdbcTemplate.queryForMap(
				"SELECT i.number, i.human_key, i.type, i.workflow_status_id, i.reporter_id,"
						+ " i.assignee_id, i.rank, i.archived, i.version, ws.code AS status_code"
						+ " FROM issue i"
						+ " JOIN project p ON p.id = i.project_id"
						+ " JOIN workflow_status ws ON ws.id = i.workflow_status_id"
						+ " WHERE p.key = ?",
				key);
		assertThat(row.get("number")).isEqualTo(1L);
		assertThat(row.get("human_key")).isEqualTo("ISSUE17-1");
		assertThat(row.get("type")).isEqualTo("STORY");
		assertThat(row.get("status_code")).isEqualTo("TO_DO");
		assertThat(row.get("reporter_id")).isEqualTo(admin.userId());
		assertThat(row.get("assignee_id")).isNull();
		assertThat(row.get("rank")).isEqualTo(1024L);
		assertThat(row.get("archived")).isEqualTo(false);
		assertThat(row.get("version")).isEqualTo(0L);

		// The counter advanced to 2, unaffected by the tampered number.
		Long nextNumber = jdbcTemplate.queryForObject(
				"SELECT next_number FROM project_issue_counter"
						+ " WHERE project_id = (SELECT id FROM project WHERE key = ?)",
				Long.class, key);
		assertThat(nextNumber).isEqualTo(2L);

		// Exactly one CREATED activity by the authenticated actor, with a controlled
		// summary recording the server-derived type/status and no assignee.
		List<Map<String, Object>> activities = jdbcTemplate.queryForList(
				"SELECT ia.actor_id, ia.type, ia.summary"
						+ " FROM issue_activity ia"
						+ " JOIN issue i ON i.id = ia.issue_id"
						+ " JOIN project p ON p.id = i.project_id"
						+ " WHERE p.key = ?",
				key);
		assertThat(activities).hasSize(1);
		Map<String, Object> activity = activities.get(0);
		assertThat(activity.get("actor_id")).isEqualTo(admin.userId());
		assertThat(activity.get("type")).isEqualTo("CREATED");
		JsonNode summary = objectMapper.readTree(String.valueOf(activity.get("summary")));
		assertThat(summary.isObject()).isTrue();
		assertThat(summary.size()).isEqualTo(3);
		assertThat(summary.propertyNames())
				.containsExactlyInAnyOrder("type", "statusCode", "assigneeId");
		assertThat(summary.get("type").asText()).isEqualTo("STORY");
		assertThat(summary.get("statusCode").asText()).isEqualTo("TO_DO");
		assertThat(summary.get("assigneeId").isNull()).isTrue();
	}

	@Test
	void failedCreateLeavesNoRowsAndDoesNotAdvanceCounter() throws Exception {
		LoginSession admin = login("issue-failed-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "ISSUE18", "Failed create");

		// A validation failure must not create rows or advance the counter.
		mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"type":"EPIC","title":"Bad","description":null,"assigneeId":null}
						"""))
				.andExpect(status().isBadRequest());

		assertNoIssueOrActivityOrCounter(key);

		// A forbidden attempt must not create rows or advance the counter either.
		LoginSession viewer = login("issue-failed-viewer@example.com", UserRole.USER);
		addMember(key, viewer.userId(), "VIEWER");
		mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(viewer.session(), viewer.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(viewer.csrfHeader(), viewer.csrfToken())
				.content("""
						{"type":"STORY","title":"Viewer","description":null,"assigneeId":null}
						"""))
				.andExpect(status().isForbidden());

		assertNoIssueOrActivityOrCounter(key);
	}

	@Test
	void responseContainsNoNestedJpaEntitiesOrSensitiveIdentityFields() throws Exception {
		LoginSession admin = login("issue-safe-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "ISSUE20", "Safe response");

		MvcResult result = mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"type":"STORY","title":"Safe","description":null,"assigneeId":null}
						"""))
				.andExpect(status().isCreated())
				.andReturn();

		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertSafeIssueDto(body);
	}

	// ------------------------------------------------------------------
	// GET /api/issues/{issueKey}
	// ------------------------------------------------------------------

	@Test
	void orgAdminCanGetSafeIssueDto() throws Exception {
		LoginSession admin = login("lifecycle-get-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE01", "Get project");
		String issueKey = createIssue(admin, key, "STORY", "Get me", null, null);

		MvcResult result = mockMvc.perform(get("/api/issues/{issueKey}", issueKey).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isOk())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andExpect(header().string("Cache-Control", containsString("no-store")))
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("issueKey").asText()).isEqualTo(issueKey);
		assertThat(body.get("projectKey").asText()).isEqualTo(key);
		assertThat(body.get("title").asText()).isEqualTo("Get me");
		assertSafeIssueDto(body);
	}

	@Test
	void projectLeadCanGetIssue() throws Exception {
		LoginSession admin = login("lifecycle-getlead-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE02", "Get lead");
		String issueKey = createIssue(admin, key, "STORY", "Lead get", null, null);

		LoginSession lead = login("lifecycle-getlead@example.com", UserRole.USER);
		addMember(key, lead.userId(), "PROJECT_LEAD");

		mockMvc.perform(get("/api/issues/{issueKey}", issueKey).cookie(lead.session(), lead.csrfCookie()))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.issueKey").value(issueKey));
	}

	@Test
	void memberCanGetIssue() throws Exception {
		LoginSession admin = login("lifecycle-getmember-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE03", "Get member");
		String issueKey = createIssue(admin, key, "STORY", "Member get", null, null);

		LoginSession member = login("lifecycle-getmember@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		mockMvc.perform(get("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie()))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.issueKey").value(issueKey));
	}

	@Test
	void viewerCanGetIssue() throws Exception {
		LoginSession admin = login("lifecycle-getviewer-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE04", "Get viewer");
		String issueKey = createIssue(admin, key, "STORY", "Viewer get", null, null);

		LoginSession viewer = login("lifecycle-getviewer@example.com", UserRole.USER);
		addMember(key, viewer.userId(), "VIEWER");

		mockMvc.perform(get("/api/issues/{issueKey}", issueKey).cookie(viewer.session(), viewer.csrfCookie()))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.issueKey").value(issueKey));
	}

	@Test
	void viewerCanReadIssueAndActivity() throws Exception {
		LoginSession admin = login("lifecycle-viewer-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE05", "Viewer read");
		String issueKey = createIssue(admin, key, "TASK", "Viewer readable", null, null);

		LoginSession viewer = login("lifecycle-viewer@example.com", UserRole.USER);
		addMember(key, viewer.userId(), "VIEWER");

		mockMvc.perform(get("/api/issues/{issueKey}", issueKey).cookie(viewer.session(), viewer.csrfCookie()))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.issueKey").value(issueKey));

		mockMvc.perform(get("/api/issues/{issueKey}/activity", issueKey).cookie(viewer.session(), viewer.csrfCookie()))
				.andExpect(status().isOk())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON));
	}

	@Test
	void nonmemberGetReturns404IssueNotFound() throws Exception {
		LoginSession admin = login("lifecycle-404-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE06", "Hidden");
		String issueKey = createIssue(admin, key, "STORY", "Hidden issue", null, null);

		LoginSession outsider = login("lifecycle-404-outsider@example.com", UserRole.USER);
		MvcResult result = mockMvc.perform(get("/api/issues/{issueKey}", issueKey).cookie(outsider.session(), outsider.csrfCookie()))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("ISSUE_NOT_FOUND"))
				.andExpect(jsonPath("$.detail").value("İş bulunamadı."))
				.andReturn();
		assertNoInternalDetail(result);
	}

	@Test
	void unknownIssueKeyGetReturns404IssueNotFound() throws Exception {
		LoginSession admin = login("lifecycle-404key-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE07", "Unknown key");
		createIssue(admin, key, "STORY", "Known", null, null);

		LoginSession member = login("lifecycle-404key-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		MvcResult result = mockMvc.perform(get("/api/issues/{issueKey}", "LIFE07-999").cookie(member.session(), member.csrfCookie()))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("ISSUE_NOT_FOUND"))
				.andExpect(jsonPath("$.detail").value("İş bulunamadı."))
				.andReturn();
		assertNoInternalDetail(result);
	}

	@Test
	void malformedIssueKeyGetReturns404IssueNotFound() throws Exception {
		LoginSession admin = login("lifecycle-404mal-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE08", "Malformed key");
		createIssue(admin, key, "STORY", "Known", null, null);

		LoginSession member = login("lifecycle-404mal-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		MvcResult result = mockMvc.perform(get("/api/issues/{issueKey}", "NOT-A-KEY").cookie(member.session(), member.csrfCookie()))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("ISSUE_NOT_FOUND"))
				.andExpect(jsonPath("$.detail").value("İş bulunamadı."))
				.andReturn();
		assertNoInternalDetail(result);
	}

	@Test
	void anonymousGetReturns401() throws Exception {
		mockMvc.perform(get("/api/issues/LIFE09-1"))
				.andExpect(status().isUnauthorized())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("UNAUTHENTICATED"))
				.andExpect(jsonPath("$.detail").value("Oturum açmanız gerekiyor."));
	}

	@Test
	void archivedIssueRemainsReadable() throws Exception {
		LoginSession admin = login("lifecycle-archread-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE10", "Archived read");
		String issueKey = createIssue(admin, key, "STORY", "Archived but readable", null, null);

		// Archive directly in the DB to simulate an archived issue without relying
		// on the (not yet implemented) archive endpoint.
		jdbcTemplate.update("UPDATE issue SET archived = TRUE, version = version + 1"
				+ " WHERE human_key = ?", issueKey);

		mockMvc.perform(get("/api/issues/{issueKey}", issueKey).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.issueKey").value(issueKey))
				.andExpect(jsonPath("$.archived").value(true));
	}

	// ------------------------------------------------------------------
	// PATCH /api/issues/{issueKey}
	// ------------------------------------------------------------------

	@Test
	void orgAdminPatchSucceedsAndIncrementsVersionOnce() throws Exception {
		LoginSession admin = login("lifecycle-patchadmin-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE11", "Patch admin");
		LoginSession assignee = login("lifecycle-patchadmin-assignee@example.com", UserRole.USER);
		addMember(key, assignee.userId(), "MEMBER");
		String issueKey = createIssue(admin, key, "STORY", "Original title", "Original desc",
				null);

		Long counterBefore = counterNextNumber(key);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"title":"Updated title","description":"Updated desc",
						 "assigneeId":"%s","expectedVersion":0}
						""".formatted(assignee.userId())))
				.andExpect(status().isOk())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andReturn();

		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("title").asText()).isEqualTo("Updated title");
		assertThat(body.get("description").asText()).isEqualTo("Updated desc");
		assertThat(body.get("assigneeId").asText()).isEqualTo(assignee.userId().toString());
		assertThat(body.get("version").asLong()).isEqualTo(1L);
		assertThat(body.get("type").asText()).isEqualTo("STORY");
		assertThat(body.get("issueKey").asText()).isEqualTo(issueKey);
		assertThat(body.get("projectKey").asText()).isEqualTo(key);
		assertThat(body.get("number").asLong()).isEqualTo(1L);
		assertThat(body.get("statusCode").asText()).isEqualTo("TO_DO");
		assertThat(body.get("archived").asBoolean()).isFalse();
		assertSafeIssueDto(body);

		// Version incremented exactly once in the DB.
		Map<String, Object> row = jdbcTemplate.queryForMap(
				"SELECT title, description, assignee_id, version, type, human_key, number,"
						+ " archived FROM issue WHERE human_key = ?",
				issueKey);
		assertThat(row.get("title")).isEqualTo("Updated title");
		assertThat(row.get("description")).isEqualTo("Updated desc");
		assertThat(row.get("assignee_id")).isEqualTo(assignee.userId());
		assertThat(row.get("version")).isEqualTo(1L);
		assertThat(row.get("type")).isEqualTo("STORY");
		assertThat(row.get("human_key")).isEqualTo(issueKey);
		assertThat(row.get("number")).isEqualTo(1L);
		assertThat(row.get("archived")).isEqualTo(false);

		// PATCH must never allocate an issue number.
		assertCounterUnchanged(counterBefore, key);
	}

	@Test
	void projectLeadPatchSucceeds() throws Exception {
		LoginSession admin = login("lifecycle-patchlead-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE12", "Patch lead");
		String issueKey = createIssue(admin, key, "STORY", "Lead title", "desc", null);

		LoginSession lead = login("lifecycle-patchlead@example.com", UserRole.USER);
		addMember(key, lead.userId(), "PROJECT_LEAD");

		Long counterBefore = counterNextNumber(key);

		mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(lead.session(), lead.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(lead.csrfHeader(), lead.csrfToken())
				.content("""
						{"title":"Lead updated","description":"desc","assigneeId":null,
						 "expectedVersion":0}
						"""))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.title").value("Lead updated"))
				.andExpect(jsonPath("$.version").value(1));

		assertCounterUnchanged(counterBefore, key);
	}

	@Test
	void memberPatchSucceedsAndIncrementsVersionOnce() throws Exception {
		LoginSession admin = login("lifecycle-patchmember-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE13", "Patch member");
		LoginSession assignee = login("lifecycle-patchmember-assignee@example.com", UserRole.USER);
		addMember(key, assignee.userId(), "MEMBER");
		String issueKey = createIssue(admin, key, "STORY", "Member title", "desc", null);

		LoginSession member = login("lifecycle-patchmember@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		Long counterBefore = counterNextNumber(key);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"Member updated","description":"desc","assigneeId":"%s",
						 "expectedVersion":0}
						""".formatted(assignee.userId())))
				.andExpect(status().isOk())
				.andReturn();

		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("title").asText()).isEqualTo("Member updated");
		assertThat(body.get("assigneeId").asText()).isEqualTo(assignee.userId().toString());
		assertThat(body.get("version").asLong()).isEqualTo(1L);
		assertSafeIssueDto(body);

		Map<String, Object> row = jdbcTemplate.queryForMap(
				"SELECT title, assignee_id, version FROM issue WHERE human_key = ?", issueKey);
		assertThat(row.get("title")).isEqualTo("Member updated");
		assertThat(row.get("assignee_id")).isEqualTo(assignee.userId());
		assertThat(row.get("version")).isEqualTo(1L);

		assertCounterUnchanged(counterBefore, key);
	}

	@Test
	void updateCanClearNullableDescriptionAndAssignee() throws Exception {
		LoginSession admin = login("lifecycle-clear-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE14", "Clear project");
		LoginSession assignee = login("lifecycle-clear-assignee@example.com", UserRole.USER);
		addMember(key, assignee.userId(), "MEMBER");
		String issueKey = createIssue(admin, key, "TASK", "Has values", "Some desc",
				assignee.userId());

		LoginSession member = login("lifecycle-clear-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		Long counterBefore = counterNextNumber(key);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"Has values","description":null,"assigneeId":null,
						 "expectedVersion":0}
						"""))
				.andExpect(status().isOk())
				.andReturn();

		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("description").isNull()).isTrue();
		assertThat(body.get("assigneeId").isNull()).isTrue();
		assertThat(body.get("version").asLong()).isEqualTo(1L);

		Map<String, Object> row = jdbcTemplate.queryForMap(
				"SELECT description, assignee_id, version FROM issue WHERE human_key = ?",
				issueKey);
		assertThat(row.get("description")).isNull();
		assertThat(row.get("assignee_id")).isNull();
		assertThat(row.get("version")).isEqualTo(1L);

		assertCounterUnchanged(counterBefore, key);
	}

	@Test
	void typeAndDerivedFieldsCannotBeChangedByExtraJsonProperties() throws Exception {
		LoginSession admin = login("lifecycle-tamper-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE15", "Tamper patch");
		String issueKey = createIssue(admin, key, "STORY", "Stable", "desc", null);

		LoginSession member = login("lifecycle-tamper-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		Long counterBefore = counterNextNumber(key);

		// Snapshot the immutable persisted fields before the hostile PATCH.
		Map<String, Object> before = issueSnapshot(issueKey);

		// The hostile reporter UUID must never surface in the response or activity.
		UUID hostileReporterId = UUID.randomUUID();

		// Effective update: title changes to "Stable updated" while description and
		// assignee stay unchanged. The hostile derived properties must be ignored.
		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"Stable updated","description":"desc","assigneeId":null,
						 "expectedVersion":0,"type":"BUG","issueKey":"HACK-999","number":999,
						 "statusCode":"DONE","rank":1,"archived":true,"version":99,
						 "reporterId":"%s"}
						""".formatted(hostileReporterId)))
				.andExpect(status().isOk())
				.andReturn();

		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("title").asText()).isEqualTo("Stable updated");
		assertThat(body.get("type").asText()).isEqualTo("STORY");
		assertThat(body.get("issueKey").asText()).isEqualTo(issueKey);
		assertThat(body.get("number").asLong()).isEqualTo(1L);
		assertThat(body.get("statusCode").asText()).isEqualTo("TO_DO");
		assertThat(body.get("rank").asLong()).isEqualTo(1024L);
		assertThat(body.get("archived").asBoolean()).isFalse();
		assertThat(body.get("version").asLong()).isEqualTo(1L);
		assertThat(body.get("reporterId").asText()).isEqualTo(admin.userId().toString());

		// The persisted snapshot must prove the hostile derived fields were ignored:
		// project, reporter, workflow status, rank, number, key, type, created_at,
		// archived, description and assignee are all unchanged; only title and
		// version changed (title to "Stable updated", version to 1).
		Map<String, Object> after = issueSnapshot(issueKey);
		assertThat(after.get("project_id")).isEqualTo(before.get("project_id"));
		assertThat(after.get("reporter_id")).isEqualTo(before.get("reporter_id"));
		assertThat(after.get("workflow_status_id")).isEqualTo(before.get("workflow_status_id"));
		assertThat(after.get("rank")).isEqualTo(before.get("rank"));
		assertThat(after.get("number")).isEqualTo(before.get("number"));
		assertThat(after.get("human_key")).isEqualTo(before.get("human_key"));
		assertThat(after.get("type")).isEqualTo(before.get("type"));
		assertThat(after.get("created_at")).isEqualTo(before.get("created_at"));
		assertThat(after.get("archived")).isEqualTo(before.get("archived"));
		assertThat(after.get("description")).isEqualTo(before.get("description"));
		assertThat(after.get("assignee_id")).isEqualTo(before.get("assignee_id"));
		assertThat(after.get("title")).isEqualTo("Stable updated");
		assertThat(after.get("version")).isEqualTo(1L);

		// workflow_status_id still references the project's TO_DO row.
		assertWorkflowStatusIsProjectTodo(issueKey);

		// Exactly one UPDATED activity with changedFields ["title"] and no hostile
		// fields or values in the summary.
		List<Map<String, Object>> activities = jdbcTemplate.queryForList(
				"SELECT ia.type, ia.summary"
						+ " FROM issue_activity ia JOIN issue i ON i.id = ia.issue_id"
						+ " WHERE i.human_key = ? ORDER BY ia.created_at, ia.id",
				issueKey);
		assertThat(activities).hasSize(2);
		assertThat(activities.get(0).get("type")).isEqualTo("CREATED");
		assertThat(activities.get(1).get("type")).isEqualTo("UPDATED");
		JsonNode updated = objectMapper.readTree(String.valueOf(activities.get(1).get("summary")));
		assertThat(updated.isObject()).isTrue();
		assertThat(updated.size()).isEqualTo(2);
		assertThat(updated.propertyNames())
				.containsExactlyInAnyOrder("changedFields", "assigneeId");
		assertThat(updated.get("changedFields").isArray()).isTrue();
		assertThat(updated.get("changedFields").size()).isEqualTo(1);
		assertThat(updated.get("changedFields").get(0).asText()).isEqualTo("title");
		assertThat(updated.get("assigneeId").isNull()).isTrue();
		String raw = updated.toString();
		assertThat(raw).doesNotContain("HACK-999", "DONE", "BUG");
		assertThat(raw).doesNotContain(hostileReporterId.toString());
		assertThat(raw).doesNotContain("password", "token", "cookie", "session");

		assertCounterUnchanged(counterBefore, key);
	}

	@Test
	void noOpUpdateLeavesVersionAndActivityCountUnchanged() throws Exception {
		LoginSession admin = login("lifecycle-noop-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE16", "No-op patch");
		String issueKey = createIssue(admin, key, "STORY", "Same", "desc", null);

		LoginSession member = login("lifecycle-noop-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"Same","description":"desc","assigneeId":null,
						 "expectedVersion":0}
						"""))
				.andExpect(status().isOk())
				.andReturn();

		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("version").asLong()).isEqualTo(0L);

		// A genuine no-op must not change the issue row, the ordered activity rows,
		// or the project counter.
		assertLifecycleUnchanged(before, issueKey, key);
	}

	@Test
	void staleExpectedVersionReturns409VersionConflictWithNoWrites() throws Exception {
		LoginSession admin = login("lifecycle-stale-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE17", "Stale patch");
		String issueKey = createIssue(admin, key, "STORY", "Stale", "desc", null);

		LoginSession member = login("lifecycle-stale-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"Changed","description":"desc","assigneeId":null,
						 "expectedVersion":5}
						"""))
				.andExpect(status().isConflict())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VERSION_CONFLICT"))
				.andExpect(jsonPath("$.detail").value("Kayıt başka bir işlem tarafından güncellendi."))
				.andReturn();
		assertNoInternalDetail(result);

		// A stale update must not change the issue row, the ordered activity rows,
		// or the project counter.
		assertLifecycleUnchanged(before, issueKey, key);
	}

	@Test
	void patchWithUnknownAssigneeReturns400InvalidAssignee() throws Exception {
		LoginSession admin = login("lifecycle-badassign-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE18", "Bad assignee patch");
		String issueKey = createIssue(admin, key, "STORY", "Assignee", "desc", null);

		LoginSession member = login("lifecycle-badassign-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"Assignee","description":"desc","assigneeId":"%s",
						 "expectedVersion":0}
						""".formatted(UUID.randomUUID())))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_ASSIGNEE"))
				.andExpect(jsonPath("$.detail").value("Atanan kullanıcı bu projenin üyesi değil."))
				.andReturn();
		assertNoInternalDetail(result);

		assertLifecycleUnchanged(before, issueKey, key);
	}

	@Test
	void patchWithSameOrganizationNonmemberAssigneeReturns400InvalidAssignee() throws Exception {
		LoginSession admin = login("lifecycle-badassign2-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE19", "Bad assignee 2");
		String issueKey = createIssue(admin, key, "STORY", "Assignee", "desc", null);

		LoginSession member = login("lifecycle-badassign2-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		// A real user who is not a member of this project.
		LoginSession outsider = login("lifecycle-badassign2-outsider@example.com", UserRole.USER);

		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"Assignee","description":"desc","assigneeId":"%s",
						 "expectedVersion":0}
						""".formatted(outsider.userId())))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_ASSIGNEE"))
				.andExpect(jsonPath("$.detail").value("Atanan kullanıcı bu projenin üyesi değil."))
				.andReturn();
		assertNoInternalDetail(result);

		assertLifecycleUnchanged(before, issueKey, key);
	}

	@Test
	void patchWithCrossProjectMemberAssigneeReturns400InvalidAssignee() throws Exception {
		LoginSession admin = login("lifecycle-badassign3-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE20", "Bad assignee 3");
		String issueKey = createIssue(admin, key, "STORY", "Assignee", "desc", null);

		LoginSession member = login("lifecycle-badassign3-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		// A member of a different project.
		String otherKey = createProject(admin, "LIFE21", "Other project");
		LoginSession otherMember = login("lifecycle-badassign3-other@example.com", UserRole.USER);
		addMember(otherKey, otherMember.userId(), "MEMBER");

		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"Assignee","description":"desc","assigneeId":"%s",
						 "expectedVersion":0}
						""".formatted(otherMember.userId())))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_ASSIGNEE"))
				.andExpect(jsonPath("$.detail").value("Atanan kullanıcı bu projenin üyesi değil."))
				.andReturn();
		assertNoInternalDetail(result);

		assertLifecycleUnchanged(before, issueKey, key);
	}

	@Test
	void patchWithDisabledSameProjectMemberAssigneeReturns400InvalidAssignee() throws Exception {
		LoginSession admin = login("lifecycle-badassign4-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE22", "Bad assignee 4");
		String issueKey = createIssue(admin, key, "STORY", "Assignee", "desc", null);

		LoginSession member = login("lifecycle-badassign4-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		// A disabled account that still holds a valid membership in this project.
		UserAccount disabled = UserAccount.create(
				"lifecycle-badassign4-disabled@example.com",
				passwordEncoder.encode("correct horse battery staple"),
				"Ada", "Lovelace", UserRole.USER);
		disabled.disable();
		userAccountRepository.saveAndFlush(disabled);
		addMember(key, disabled.getId(), "MEMBER");

		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"Assignee","description":"desc","assigneeId":"%s",
						 "expectedVersion":0}
						""".formatted(disabled.getId())))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_ASSIGNEE"))
				.andExpect(jsonPath("$.detail").value("Atanan kullanıcı bu projenin üyesi değil."))
				.andReturn();
		assertNoInternalDetail(result);

		assertLifecycleUnchanged(before, issueKey, key);
	}

	@Test
	void patchBlankTitleReturns400ValidationFailed() throws Exception {
		LoginSession admin = login("lifecycle-valid-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE23", "Validation patch");
		String issueKey = createIssue(admin, key, "STORY", "Valid", "desc", null);

		LoginSession member = login("lifecycle-valid-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"   ","description":"desc","assigneeId":null,"expectedVersion":0}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andExpect(jsonPath("$.detail").value("İstek doğrulama kurallarını karşılamıyor."))
				.andReturn();
		assertNoInternalDetail(result);

		assertLifecycleUnchanged(before, issueKey, key);
	}

	@Test
	void patchTitleOver200Returns400ValidationFailed() throws Exception {
		LoginSession admin = login("lifecycle-valid2-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE24", "Validation patch 2");
		String issueKey = createIssue(admin, key, "STORY", "Valid", "desc", null);

		LoginSession member = login("lifecycle-valid2-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"%s","description":"desc","assigneeId":null,"expectedVersion":0}
						""".formatted("x".repeat(201))))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andExpect(jsonPath("$.detail").value("İstek doğrulama kurallarını karşılamıyor."))
				.andReturn();
		assertNoInternalDetail(result);

		assertLifecycleUnchanged(before, issueKey, key);
	}

	@Test
	void patchDescriptionOver10000Returns400ValidationFailed() throws Exception {
		LoginSession admin = login("lifecycle-valid3-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE25", "Validation patch 3");
		String issueKey = createIssue(admin, key, "STORY", "Valid", "desc", null);

		LoginSession member = login("lifecycle-valid3-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"Valid","description":"%s","assigneeId":null,"expectedVersion":0}
						""".formatted("y".repeat(10001))))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andExpect(jsonPath("$.detail").value("İstek doğrulama kurallarını karşılamıyor."))
				.andReturn();
		assertNoInternalDetail(result);

		assertLifecycleUnchanged(before, issueKey, key);
	}

	@Test
	void patchMalformedAssigneeUuidReturns400ValidationFailed() throws Exception {
		LoginSession admin = login("lifecycle-valid4-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE26", "Validation patch 4");
		String issueKey = createIssue(admin, key, "STORY", "Valid", "desc", null);

		LoginSession member = login("lifecycle-valid4-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"Valid","description":"desc","assigneeId":"not-a-uuid",
						 "expectedVersion":0}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andExpect(jsonPath("$.detail").value("İstek doğrulama kurallarını karşılamıyor."))
				.andReturn();
		assertNoInternalDetail(result);

		assertLifecycleUnchanged(before, issueKey, key);
	}

	@Test
	void patchMissingExpectedVersionReturns400ValidationFailed() throws Exception {
		LoginSession admin = login("lifecycle-valid5-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE27", "Validation patch 5");
		String issueKey = createIssue(admin, key, "STORY", "Valid", "desc", null);

		LoginSession member = login("lifecycle-valid5-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"Valid","description":"desc","assigneeId":null}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andExpect(jsonPath("$.detail").value("İstek doğrulama kurallarını karşılamıyor."))
				.andReturn();
		assertNoInternalDetail(result);

		assertLifecycleUnchanged(before, issueKey, key);
	}

	@Test
	void patchNegativeExpectedVersionReturns400ValidationFailed() throws Exception {
		LoginSession admin = login("lifecycle-valid6-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE28", "Validation patch 6");
		String issueKey = createIssue(admin, key, "STORY", "Valid", "desc", null);

		LoginSession member = login("lifecycle-valid6-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"Valid","description":"desc","assigneeId":null,"expectedVersion":-1}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andExpect(jsonPath("$.detail").value("İstek doğrulama kurallarını karşılamıyor."))
				.andReturn();
		assertNoInternalDetail(result);

		assertLifecycleUnchanged(before, issueKey, key);
	}

	@Test
	void viewerPatchReturns403WithNoWrites() throws Exception {
		LoginSession admin = login("lifecycle-viewerpatch-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE29", "Viewer patch");
		String issueKey = createIssue(admin, key, "STORY", "Viewer blocked", "desc", null);

		LoginSession viewer = login("lifecycle-viewerpatch@example.com", UserRole.USER);
		addMember(key, viewer.userId(), "VIEWER");

		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(viewer.session(), viewer.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(viewer.csrfHeader(), viewer.csrfToken())
				.content("""
						{"title":"Hacked","description":"desc","assigneeId":null,"expectedVersion":0}
						"""))
				.andExpect(status().isForbidden())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("FORBIDDEN"))
				.andExpect(jsonPath("$.detail").value("Bu işlem için yetkiniz yok."))
				.andReturn();
		assertNoInternalDetail(result);

		assertLifecycleUnchanged(before, issueKey, key);
	}

	@Test
	void nonmemberPatchReturns404IssueNotFoundWithNoWrites() throws Exception {
		LoginSession admin = login("lifecycle-nonmemberpatch-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE30", "Nonmember patch");
		String issueKey = createIssue(admin, key, "STORY", "Hidden patch", "desc", null);

		LoginSession outsider = login("lifecycle-nonmemberpatch@example.com", UserRole.USER);

		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(outsider.session(), outsider.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(outsider.csrfHeader(), outsider.csrfToken())
				.content("""
						{"title":"Hacked","description":"desc","assigneeId":null,"expectedVersion":0}
						"""))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("ISSUE_NOT_FOUND"))
				.andExpect(jsonPath("$.detail").value("İş bulunamadı."))
				.andReturn();
		assertNoInternalDetail(result);

		assertLifecycleUnchanged(before, issueKey, key);
	}

	@Test
	void unknownIssueKeyPatchReturns404IssueNotFoundWithNoWrites() throws Exception {
		LoginSession admin = login("lifecycle-unknownpatch-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE31", "Unknown patch");
		createIssue(admin, key, "STORY", "Known", "desc", null);

		LoginSession member = login("lifecycle-unknownpatch-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		// The unknown issue key does not exist, so the snapshot captures the empty
		// issue/activity state and the project counter.
		LifecycleSnapshot before = lifecycleSnapshot("LIFE31-999", key);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}", "LIFE31-999").cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"Hacked","description":"desc","assigneeId":null,"expectedVersion":0}
						"""))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("ISSUE_NOT_FOUND"))
				.andExpect(jsonPath("$.detail").value("İş bulunamadı."))
				.andReturn();
		assertNoInternalDetail(result);

		assertLifecycleUnchanged(before, "LIFE31-999", key);
	}

	@Test
	void anonymousPatchReturns401() throws Exception {
		MvcResult csrf = mockMvc.perform(get("/api/private-probe")).andReturn();
		Cookie csrfBody = csrf.getResponse().getCookie("XSRF-TOKEN");
		Cookie anonSession = csrf.getResponse().getCookie("SESSION");

		mockMvc.perform(patch("/api/issues/LIFE32-1").cookie(csrfBody)
				.contentType(MediaType.APPLICATION_JSON)
				.header("X-XSRF-TOKEN", csrfBody.getValue())
				.content("""
						{"title":"Hacked","description":"desc","assigneeId":null,"expectedVersion":0}
						"""))
				.andExpect(status().isUnauthorized())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("UNAUTHENTICATED"))
				.andExpect(jsonPath("$.detail").value("Oturum açmanız gerekiyor."));
	}

	@Test
	void missingCsrfPatchReturnsInvalidCsrfTokenWithNoWrites() throws Exception {
		LoginSession admin = login("lifecycle-csrfpatch-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE33", "Csrf patch");
		String issueKey = createIssue(admin, key, "STORY", "Csrf blocked", "desc", null);

		LoginSession member = login("lifecycle-csrfpatch-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"title":"Hacked","description":"desc","assigneeId":null,"expectedVersion":0}
						"""))
				.andExpect(status().isForbidden())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_CSRF_TOKEN"))
				.andExpect(jsonPath("$.detail").value("CSRF doğrulaması başarısız."));

		// A CSRF rejection must not change the issue row, the ordered activity rows,
		// or the project counter.
		assertLifecycleUnchanged(before, issueKey, key);
	}

	// ------------------------------------------------------------------
	// POST /api/issues/{issueKey}/archive
	// ------------------------------------------------------------------

	@Test
	void orgAdminArchiveSucceedsIncrementsVersionOnceAndChangesOnlyArchived() throws Exception {
		LoginSession admin = login("lifecycle-archadmin-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE34", "Archive admin");
		LoginSession assignee = login("lifecycle-archadmin-assignee@example.com", UserRole.USER);
		addMember(key, assignee.userId(), "MEMBER");
		String issueKey = createIssue(admin, key, "BUG", "Archive me", "desc", assignee.userId());

		Long counterBefore = counterNextNumber(key);
		Map<String, Object> before = issueSnapshot(issueKey);

		MvcResult result = mockMvc.perform(post("/api/issues/{issueKey}/archive", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"expectedVersion":0}
						"""))
				.andExpect(status().isOk())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andReturn();

		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("archived").asBoolean()).isTrue();
		assertThat(body.get("version").asLong()).isEqualTo(1L);
		assertThat(body.get("issueKey").asText()).isEqualTo(issueKey);
		assertThat(body.get("number").asLong()).isEqualTo(1L);
		assertThat(body.get("type").asText()).isEqualTo("BUG");
		assertThat(body.get("title").asText()).isEqualTo("Archive me");
		assertThat(body.get("description").asText()).isEqualTo("desc");
		assertThat(body.get("statusCode").asText()).isEqualTo("TO_DO");
		assertThat(body.get("reporterId").asText()).isEqualTo(admin.userId().toString());
		assertThat(body.get("assigneeId").asText()).isEqualTo(assignee.userId().toString());
		assertThat(body.get("rank").asLong()).isEqualTo(1024L);
		assertSafeIssueDto(body);

		// Only archived and version changed in the DB; every other persisted field
		// (project, reporter, workflow status, rank, number, key, type, assignee,
		// title, description, created_at) is unchanged.
		Map<String, Object> after = issueSnapshot(issueKey);
		assertThat(after.get("archived")).isEqualTo(true);
		assertThat(after.get("version")).isEqualTo(1L);
		assertThat(after.get("project_id")).isEqualTo(before.get("project_id"));
		assertThat(after.get("reporter_id")).isEqualTo(before.get("reporter_id"));
		assertThat(after.get("workflow_status_id")).isEqualTo(before.get("workflow_status_id"));
		assertThat(after.get("rank")).isEqualTo(before.get("rank"));
		assertThat(after.get("number")).isEqualTo(before.get("number"));
		assertThat(after.get("human_key")).isEqualTo(before.get("human_key"));
		assertThat(after.get("type")).isEqualTo(before.get("type"));
		assertThat(after.get("assignee_id")).isEqualTo(before.get("assignee_id"));
		assertThat(after.get("title")).isEqualTo(before.get("title"));
		assertThat(after.get("description")).isEqualTo(before.get("description"));
		assertThat(after.get("created_at")).isEqualTo(before.get("created_at"));

		assertCounterUnchanged(counterBefore, key);
	}

	@Test
	void projectLeadArchiveSucceeds() throws Exception {
		LoginSession admin = login("lifecycle-archlead-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE35", "Archive lead");
		String issueKey = createIssue(admin, key, "STORY", "Lead archive", "desc", null);

		LoginSession lead = login("lifecycle-archlead@example.com", UserRole.USER);
		addMember(key, lead.userId(), "PROJECT_LEAD");

		Long counterBefore = counterNextNumber(key);

		mockMvc.perform(post("/api/issues/{issueKey}/archive", issueKey).cookie(lead.session(), lead.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(lead.csrfHeader(), lead.csrfToken())
				.content("""
						{"expectedVersion":0}
						"""))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.archived").value(true))
				.andExpect(jsonPath("$.version").value(1));

		assertCounterUnchanged(counterBefore, key);
	}

	@Test
	void memberArchiveSucceedsIncrementsVersionOnceAndChangesOnlyArchived() throws Exception {
		LoginSession admin = login("lifecycle-archmember-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE36", "Archive member");
		LoginSession assignee = login("lifecycle-archmember-assignee@example.com", UserRole.USER);
		addMember(key, assignee.userId(), "MEMBER");
		String issueKey = createIssue(admin, key, "BUG", "Archive me", "desc", assignee.userId());

		LoginSession member = login("lifecycle-archmember@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		Long counterBefore = counterNextNumber(key);
		Map<String, Object> before = issueSnapshot(issueKey);

		MvcResult result = mockMvc.perform(post("/api/issues/{issueKey}/archive", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"expectedVersion":0}
						"""))
				.andExpect(status().isOk())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andReturn();

		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("archived").asBoolean()).isTrue();
		assertThat(body.get("version").asLong()).isEqualTo(1L);
		assertThat(body.get("issueKey").asText()).isEqualTo(issueKey);
		assertThat(body.get("number").asLong()).isEqualTo(1L);
		assertThat(body.get("type").asText()).isEqualTo("BUG");
		assertThat(body.get("title").asText()).isEqualTo("Archive me");
		assertThat(body.get("description").asText()).isEqualTo("desc");
		assertThat(body.get("statusCode").asText()).isEqualTo("TO_DO");
		assertThat(body.get("reporterId").asText()).isEqualTo(admin.userId().toString());
		assertThat(body.get("assigneeId").asText()).isEqualTo(assignee.userId().toString());
		assertThat(body.get("rank").asLong()).isEqualTo(1024L);
		assertSafeIssueDto(body);

		// Only archived and version changed in the DB.
		Map<String, Object> after = issueSnapshot(issueKey);
		assertThat(after.get("archived")).isEqualTo(true);
		assertThat(after.get("version")).isEqualTo(1L);
		assertThat(after.get("project_id")).isEqualTo(before.get("project_id"));
		assertThat(after.get("reporter_id")).isEqualTo(before.get("reporter_id"));
		assertThat(after.get("workflow_status_id")).isEqualTo(before.get("workflow_status_id"));
		assertThat(after.get("rank")).isEqualTo(before.get("rank"));
		assertThat(after.get("number")).isEqualTo(before.get("number"));
		assertThat(after.get("human_key")).isEqualTo(before.get("human_key"));
		assertThat(after.get("type")).isEqualTo(before.get("type"));
		assertThat(after.get("assignee_id")).isEqualTo(before.get("assignee_id"));
		assertThat(after.get("title")).isEqualTo(before.get("title"));
		assertThat(after.get("description")).isEqualTo(before.get("description"));
		assertThat(after.get("created_at")).isEqualTo(before.get("created_at"));

		assertCounterUnchanged(counterBefore, key);
	}

	@Test
	void archiveProducesExactlyOneControlledArchivedActivity() throws Exception {
		LoginSession admin = login("lifecycle-archact-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE37", "Archive activity");
		String issueKey = createIssue(admin, key, "TASK", "Archive activity", "desc", null);

		LoginSession member = login("lifecycle-archact-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		mockMvc.perform(post("/api/issues/{issueKey}/archive", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"expectedVersion":0}
						"""))
				.andExpect(status().isOk());

		// Exactly two activities: CREATED then ARCHIVED.
		List<Map<String, Object>> activities = jdbcTemplate.queryForList(
				"SELECT ia.type, ia.actor_id, ia.summary"
						+ " FROM issue_activity ia JOIN issue i ON i.id = ia.issue_id"
						+ " WHERE i.human_key = ? ORDER BY ia.created_at, ia.id",
				issueKey);
		assertThat(activities).hasSize(2);
		assertThat(activities.get(0).get("type")).isEqualTo("CREATED");
		assertThat(activities.get(0).get("actor_id")).isEqualTo(admin.userId());
		assertThat(activities.get(1).get("type")).isEqualTo("ARCHIVED");
		assertThat(activities.get(1).get("actor_id")).isEqualTo(member.userId());

		// ARCHIVED summary is exactly {"statusCode":"TO_DO"}.
		JsonNode summary = objectMapper.readTree(String.valueOf(activities.get(1).get("summary")));
		assertThat(summary.isObject()).isTrue();
		assertThat(summary.size()).isEqualTo(1);
		assertThat(summary.propertyNames()).containsExactly("statusCode");
		assertThat(summary.get("statusCode").asText()).isEqualTo("TO_DO");
		String raw = summary.toString();
		assertThat(raw).doesNotContain("Archive activity", "desc");
		assertThat(raw).doesNotContain("lifecycle-archact-admin@example.com");
		assertThat(raw).doesNotContain("lifecycle-archact-member@example.com");
		assertThat(raw).doesNotContain("password", "token", "cookie", "session");
	}

	@Test
	void staleArchiveReturnsVersionConflictWithNoWrites() throws Exception {
		LoginSession admin = login("lifecycle-stalearch-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE38", "Stale archive");
		String issueKey = createIssue(admin, key, "STORY", "Stale archive", "desc", null);

		LoginSession member = login("lifecycle-stalearch-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		MvcResult result = mockMvc.perform(post("/api/issues/{issueKey}/archive", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"expectedVersion":9}
						"""))
				.andExpect(status().isConflict())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VERSION_CONFLICT"))
				.andExpect(jsonPath("$.detail").value("Kayıt başka bir işlem tarafından güncellendi."))
				.andReturn();
		assertNoInternalDetail(result);

		// A stale archive must not change the issue row, the ordered activity rows,
		// or the project counter.
		assertLifecycleUnchanged(before, issueKey, key);
	}

	@Test
	void viewerArchiveGets403WithNoWrites() throws Exception {
		LoginSession admin = login("lifecycle-viewerarch-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE39", "Viewer archive");
		String issueKey = createIssue(admin, key, "STORY", "Viewer archive", "desc", null);

		LoginSession viewer = login("lifecycle-viewerarch@example.com", UserRole.USER);
		addMember(key, viewer.userId(), "VIEWER");

		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		MvcResult result = mockMvc.perform(post("/api/issues/{issueKey}/archive", issueKey).cookie(viewer.session(), viewer.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(viewer.csrfHeader(), viewer.csrfToken())
				.content("""
						{"expectedVersion":0}
						"""))
				.andExpect(status().isForbidden())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("FORBIDDEN"))
				.andExpect(jsonPath("$.detail").value("Bu işlem için yetkiniz yok."))
				.andReturn();
		assertNoInternalDetail(result);

		assertLifecycleUnchanged(before, issueKey, key);
	}

	@Test
	void nonmemberArchiveGetsIssueNotFoundWithNoWrites() throws Exception {
		LoginSession admin = login("lifecycle-nonmemberarch-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE40", "Nonmember archive");
		String issueKey = createIssue(admin, key, "STORY", "Hidden archive", "desc", null);

		LoginSession outsider = login("lifecycle-nonmemberarch@example.com", UserRole.USER);

		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		MvcResult result = mockMvc.perform(post("/api/issues/{issueKey}/archive", issueKey).cookie(outsider.session(), outsider.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(outsider.csrfHeader(), outsider.csrfToken())
				.content("""
						{"expectedVersion":0}
						"""))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("ISSUE_NOT_FOUND"))
				.andExpect(jsonPath("$.detail").value("İş bulunamadı."))
				.andReturn();
		assertNoInternalDetail(result);

		assertLifecycleUnchanged(before, issueKey, key);
	}

	@Test
	void unknownIssueArchiveGetsIssueNotFoundWithNoWrites() throws Exception {
		LoginSession admin = login("lifecycle-unknownarch-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE41", "Unknown archive");
		createIssue(admin, key, "STORY", "Known", "desc", null);

		LoginSession member = login("lifecycle-unknownarch-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		// The unknown issue key does not exist, so the snapshot captures the empty
		// issue/activity state and the project counter.
		LifecycleSnapshot before = lifecycleSnapshot("LIFE41-999", key);

		MvcResult result = mockMvc.perform(post("/api/issues/{issueKey}/archive", "LIFE41-999").cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"expectedVersion":0}
						"""))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("ISSUE_NOT_FOUND"))
				.andExpect(jsonPath("$.detail").value("İş bulunamadı."))
				.andReturn();
		assertNoInternalDetail(result);

		assertLifecycleUnchanged(before, "LIFE41-999", key);
	}

	@Test
	void anonymousArchiveReturns401() throws Exception {
		MvcResult csrf = mockMvc.perform(get("/api/private-probe")).andReturn();
		Cookie csrfBody = csrf.getResponse().getCookie("XSRF-TOKEN");
		Cookie anonSession = csrf.getResponse().getCookie("SESSION");

		mockMvc.perform(post("/api/issues/LIFE42-1/archive").cookie(csrfBody)
				.contentType(MediaType.APPLICATION_JSON)
				.header("X-XSRF-TOKEN", csrfBody.getValue())
				.content("""
						{"expectedVersion":0}
						"""))
				.andExpect(status().isUnauthorized())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("UNAUTHENTICATED"))
				.andExpect(jsonPath("$.detail").value("Oturum açmanız gerekiyor."));
	}

	@Test
	void archiveMissingExpectedVersionIsValidationFailed() throws Exception {
		LoginSession admin = login("lifecycle-archvalid-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE43", "Archive validation");
		String issueKey = createIssue(admin, key, "STORY", "Archive validation", "desc", null);

		LoginSession member = login("lifecycle-archvalid-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		MvcResult result = mockMvc.perform(post("/api/issues/{issueKey}/archive", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andExpect(jsonPath("$.detail").value("İstek doğrulama kurallarını karşılamıyor."))
				.andReturn();
		assertNoInternalDetail(result);

		assertLifecycleUnchanged(before, issueKey, key);
	}

	@Test
	void archiveNegativeExpectedVersionIsValidationFailed() throws Exception {
		LoginSession admin = login("lifecycle-archvalid2-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE44", "Archive validation 2");
		String issueKey = createIssue(admin, key, "STORY", "Archive validation", "desc", null);

		LoginSession member = login("lifecycle-archvalid2-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		MvcResult result = mockMvc.perform(post("/api/issues/{issueKey}/archive", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"expectedVersion":-1}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andExpect(jsonPath("$.detail").value("İstek doğrulama kurallarını karşılamıyor."))
				.andReturn();
		assertNoInternalDetail(result);

		assertLifecycleUnchanged(before, issueKey, key);
	}

	@Test
	void missingCsrfArchiveReturnsInvalidCsrfTokenWithNoWrites() throws Exception {
		LoginSession admin = login("lifecycle-csrfarch-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE45", "Csrf archive");
		String issueKey = createIssue(admin, key, "STORY", "Csrf archive", "desc", null);

		LoginSession member = login("lifecycle-csrfarch-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		mockMvc.perform(post("/api/issues/{issueKey}/archive", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"expectedVersion":0}
						"""))
				.andExpect(status().isForbidden())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_CSRF_TOKEN"))
				.andExpect(jsonPath("$.detail").value("CSRF doğrulaması başarısız."));

		// A CSRF rejection must not change the issue row, the ordered activity rows,
		// or the project counter.
		assertLifecycleUnchanged(before, issueKey, key);
	}

	@Test
	void patchAndRepeatedArchiveOnArchivedIssueReturnIssueArchivedWithNoChanges() throws Exception {
		LoginSession admin = login("lifecycle-rearch-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE46", "Re-archive");
		String issueKey = createIssue(admin, key, "STORY", "Already archived", "desc", null);

		LoginSession member = login("lifecycle-rearch-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		// Archive once successfully.
		mockMvc.perform(post("/api/issues/{issueKey}/archive", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"expectedVersion":0}
						"""))
				.andExpect(status().isOk());

		// Snapshot after the successful archive, before the rejected mutations.
		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		// PATCH on archived issue -> 409 ISSUE_ARCHIVED.
		MvcResult patchResult = mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"Changed","description":"desc","assigneeId":null,
						 "expectedVersion":1}
						"""))
				.andExpect(status().isConflict())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("ISSUE_ARCHIVED"))
				.andExpect(jsonPath("$.detail").value("Arşivlenmiş iş değiştirilemez."))
				.andReturn();
		assertNoInternalDetail(patchResult);

		// Re-archive -> 409 ISSUE_ARCHIVED.
		MvcResult rearchResult = mockMvc.perform(post("/api/issues/{issueKey}/archive", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"expectedVersion":1}
						"""))
				.andExpect(status().isConflict())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("ISSUE_ARCHIVED"))
				.andExpect(jsonPath("$.detail").value("Arşivlenmiş iş değiştirilemez."))
				.andReturn();
		assertNoInternalDetail(rearchResult);

		// Neither the PATCH nor the re-archive may change the issue row, the ordered
		// activity rows, or the project counter.
		assertLifecycleUnchanged(before, issueKey, key);
	}

	// ------------------------------------------------------------------
	// GET /api/issues/{issueKey}/activity
	// ------------------------------------------------------------------

	@Test
	void createUpdateArchiveYieldsExactCreatedUpdatedArchivedOrder() throws Exception {
		LoginSession admin = login("lifecycle-actseq-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE47", "Activity sequence");
		LoginSession assignee = login("lifecycle-actseq-assignee@example.com", UserRole.USER);
		addMember(key, assignee.userId(), "MEMBER");
		String issueKey = createIssue(admin, key, "STORY", "Sequence", "desc", null);

		LoginSession member = login("lifecycle-actseq-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		// Effective update: title and assignee change, description stays "desc".
		mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"Sequence updated","description":"desc","assigneeId":"%s",
						 "expectedVersion":0}
						""".formatted(assignee.userId())))
				.andExpect(status().isOk());

		// Archive.
		mockMvc.perform(post("/api/issues/{issueKey}/archive", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"expectedVersion":1}
						"""))
				.andExpect(status().isOk());

		// Activity endpoint returns CREATED, UPDATED, ARCHIVED in deterministic order.
		MvcResult result = mockMvc.perform(get("/api/issues/{issueKey}/activity", issueKey).cookie(member.session(), member.csrfCookie()))
				.andExpect(status().isOk())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andReturn();

		JsonNode array = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(array.isArray()).isTrue();
		assertThat(array.size()).isEqualTo(3);
		assertThat(array.get(0).get("type").asText()).isEqualTo("CREATED");
		assertThat(array.get(1).get("type").asText()).isEqualTo("UPDATED");
		assertThat(array.get(2).get("type").asText()).isEqualTo("ARCHIVED");

		// actorId is the authenticated actor for each operation.
		assertThat(array.get(0).get("actorId").asText()).isEqualTo(admin.userId().toString());
		assertThat(array.get(1).get("actorId").asText()).isEqualTo(member.userId().toString());
		assertThat(array.get(2).get("actorId").asText()).isEqualTo(member.userId().toString());

		// CREATED retains its exact controlled summary.
		JsonNode createdSummary = array.get(0).get("summary");
		assertThat(createdSummary.isObject()).isTrue();
		assertThat(createdSummary.size()).isEqualTo(3);
		assertThat(createdSummary.propertyNames())
				.containsExactlyInAnyOrder("type", "statusCode", "assigneeId");
		assertThat(createdSummary.get("type").asText()).isEqualTo("STORY");
		assertThat(createdSummary.get("statusCode").asText()).isEqualTo("TO_DO");
		assertThat(createdSummary.get("assigneeId").isNull()).isTrue();

		// UPDATED uses the exact locked summary schema. Only title and assigneeId
		// actually changed (description stayed "desc"), so changedFields is
		// ["title", "assigneeId"] in deterministic order.
		JsonNode updatedSummary = array.get(1).get("summary");
		assertThat(updatedSummary.isObject()).isTrue();
		assertThat(updatedSummary.size()).isEqualTo(2);
		assertThat(updatedSummary.propertyNames())
				.containsExactlyInAnyOrder("changedFields", "assigneeId");
		assertThat(updatedSummary.get("changedFields").isArray()).isTrue();
		assertThat(updatedSummary.get("changedFields").size()).isEqualTo(2);
		assertThat(updatedSummary.get("changedFields").get(0).asText()).isEqualTo("title");
		assertThat(updatedSummary.get("changedFields").get(1).asText()).isEqualTo("assigneeId");
		assertThat(updatedSummary.get("assigneeId").asText())
				.isEqualTo(assignee.userId().toString());

		// ARCHIVED uses the exact locked summary schema.
		JsonNode archivedSummary = array.get(2).get("summary");
		assertThat(archivedSummary.isObject()).isTrue();
		assertThat(archivedSummary.size()).isEqualTo(1);
		assertThat(archivedSummary.propertyNames()).containsExactly("statusCode");
		assertThat(archivedSummary.get("statusCode").asText()).isEqualTo("TO_DO");
	}

	@Test
	void activityDtoHasExactSafeFieldSet() throws Exception {
		LoginSession admin = login("lifecycle-actdto-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE48", "Activity DTO");
		String issueKey = createIssue(admin, key, "TASK", "DTO", "desc", null);

		MvcResult result = mockMvc.perform(get("/api/issues/{issueKey}/activity", issueKey).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isOk())
				.andReturn();

		JsonNode array = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(array.isArray()).isTrue();
		assertThat(array.size()).isEqualTo(1);
		JsonNode dto = array.get(0);
		assertThat(dto.isObject()).isTrue();
		assertThat(dto.size()).isEqualTo(5);
		assertThat(dto.propertyNames())
				.containsExactlyInAnyOrder("id", "type", "actorId", "summary", "createdAt");
		assertThat(dto.get("id").asText()).isNotBlank();
		assertThat(dto.get("type").asText()).isEqualTo("CREATED");
		assertThat(dto.get("actorId").asText()).isEqualTo(admin.userId().toString());
		assertThat(dto.get("createdAt").asText()).isNotBlank();
		// No nested actor/user/entity data, email, names, role, or sensitive fields.
		assertThat(dto.has("actor")).isFalse();
		assertThat(dto.has("user")).isFalse();
		assertThat(dto.has("email")).isFalse();
		assertThat(dto.has("firstName")).isFalse();
		assertThat(dto.has("lastName")).isFalse();
		assertThat(dto.has("organizationRole")).isFalse();
		assertThat(dto.has("passwordHash")).isFalse();
		assertThat(dto.has("issue")).isFalse();
		assertThat(dto.has("title")).isFalse();
		assertThat(dto.has("description")).isFalse();
	}

	@Test
	void activitySummariesAreParsedJsonWithExactKeySetsAndTypedValues() throws Exception {
		LoginSession admin = login("lifecycle-actjson-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE49", "Activity JSON");
		LoginSession assignee = login("lifecycle-actjson-assignee@example.com", UserRole.USER);
		addMember(key, assignee.userId(), "MEMBER");
		String issueKey = createIssue(admin, key, "BUG", "JSON", "desc", null);

		LoginSession member = login("lifecycle-actjson-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		// Effective update: title and assignee change, description stays "desc".
		mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"JSON updated","description":"desc","assigneeId":"%s",
						 "expectedVersion":0}
						""".formatted(assignee.userId())))
				.andExpect(status().isOk());

		MvcResult result = mockMvc.perform(get("/api/issues/{issueKey}/activity", issueKey).cookie(member.session(), member.csrfCookie()))
				.andExpect(status().isOk())
				.andReturn();

		JsonNode array = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(array.size()).isEqualTo(2);

		// CREATED summary: exact key set and typed values.
		JsonNode created = array.get(0).get("summary");
		assertThat(created.isObject()).isTrue();
		assertThat(created.size()).isEqualTo(3);
		assertThat(created.propertyNames())
				.containsExactlyInAnyOrder("type", "statusCode", "assigneeId");
		assertThat(created.get("type").isTextual()).isTrue();
		assertThat(created.get("type").asText()).isEqualTo("BUG");
		assertThat(created.get("statusCode").isTextual()).isTrue();
		assertThat(created.get("statusCode").asText()).isEqualTo("TO_DO");
		assertThat(created.get("assigneeId").isNull()).isTrue();

		// UPDATED summary: exact key set and typed values. Only title and
		// assigneeId changed, so changedFields is ["title", "assigneeId"].
		JsonNode updated = array.get(1).get("summary");
		assertThat(updated.isObject()).isTrue();
		assertThat(updated.size()).isEqualTo(2);
		assertThat(updated.propertyNames())
				.containsExactlyInAnyOrder("changedFields", "assigneeId");
		assertThat(updated.get("changedFields").isArray()).isTrue();
		assertThat(updated.get("changedFields").size()).isEqualTo(2);
		assertThat(updated.get("changedFields").get(0).asText()).isEqualTo("title");
		assertThat(updated.get("changedFields").get(1).asText()).isEqualTo("assigneeId");
		assertThat(updated.get("assigneeId").asText()).isEqualTo(assignee.userId().toString());
	}

	@Test
	void hostileExtraRequestFieldsAndInternalDetailsNeverAppear() throws Exception {
		LoginSession admin = login("lifecycle-hostile-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE50", "Hostile");
		String issueKey = createIssue(admin, key, "STORY", "Hostile", "desc", null);

		LoginSession member = login("lifecycle-hostile-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		// The attacker-supplied actor UUID must never surface anywhere.
		UUID hostileActorId = UUID.randomUUID();

		// Hostile PATCH with extra fields and internal-looking keys. Only the title
		// actually changes (description stays "desc", assignee stays null), so the
		// UPDATED summary must record changedFields = ["title"].
		mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"Hostile updated","description":"desc","assigneeId":null,
						 "expectedVersion":0,"passwordHash":"hunter2","email":"x@y.z",
						 "actorId":"%s","summary":{"secret":"leak"}}
						""".formatted(hostileActorId)))
				.andExpect(status().isOk());

		MvcResult result = mockMvc.perform(get("/api/issues/{issueKey}/activity", issueKey).cookie(member.session(), member.csrfCookie()))
				.andExpect(status().isOk())
				.andReturn();

		String raw = result.getResponse().getContentAsString();
		// The hostile values and internal-looking keys must never appear.
		assertThat(raw).doesNotContain("hunter2", "x@y.z", "secret", "leak");
		assertThat(raw).doesNotContain("passwordHash", "email");
		assertThat(raw).doesNotContain(hostileActorId.toString());
		assertThat(raw).doesNotContain("lifecycle-hostile-admin@example.com");
		assertThat(raw).doesNotContain("lifecycle-hostile-member@example.com");
		assertThat(raw).doesNotContain("password", "token", "cookie", "session");

		JsonNode array = objectMapper.readTree(raw);
		assertThat(array.size()).isEqualTo(2);

		// Every activity DTO top-level actorId equals the authenticated, server-derived
		// actor for that operation (CREATED by admin, UPDATED by member). The hostile
		// actorId must never be reflected as a top-level actorId.
		assertThat(array.get(0).get("actorId").asText()).isEqualTo(admin.userId().toString());
		assertThat(array.get(1).get("actorId").asText()).isEqualTo(member.userId().toString());

		// The summary must not carry an actorId property (actor identity is a
		// top-level DTO field, never a summary field).
		assertThat(array.get(0).get("summary").has("actorId")).isFalse();
		assertThat(array.get(1).get("summary").has("actorId")).isFalse();

		// UPDATED summary: exact key set. Only title changed.
		JsonNode updated = array.get(1).get("summary");
		assertThat(updated.size()).isEqualTo(2);
		assertThat(updated.propertyNames())
				.containsExactlyInAnyOrder("changedFields", "assigneeId");
		assertThat(updated.get("changedFields").size()).isEqualTo(1);
		assertThat(updated.get("changedFields").get(0).asText()).isEqualTo("title");
		assertThat(updated.get("assigneeId").isNull()).isTrue();

		// The persisted issue_activity.summary JSONB must have the exact controlled
		// key/value structure. API projection must not be able to hide unsafe
		// persisted JSON, so assert the stored JSONB directly.
		List<Map<String, Object>> stored = jdbcTemplate.queryForList(
				"SELECT ia.type, ia.summary"
						+ " FROM issue_activity ia JOIN issue i ON i.id = ia.issue_id"
						+ " WHERE i.human_key = ? ORDER BY ia.created_at, ia.id",
				issueKey);
		assertThat(stored).hasSize(2);

		JsonNode storedCreated = objectMapper.readTree(String.valueOf(stored.get(0).get("summary")));
		assertThat(storedCreated.isObject()).isTrue();
		assertThat(storedCreated.size()).isEqualTo(3);
		assertThat(storedCreated.propertyNames())
				.containsExactlyInAnyOrder("type", "statusCode", "assigneeId");
		assertThat(storedCreated.get("type").asText()).isEqualTo("STORY");
		assertThat(storedCreated.get("statusCode").asText()).isEqualTo("TO_DO");
		assertThat(storedCreated.get("assigneeId").isNull()).isTrue();
		assertThat(storedCreated.has("actorId")).isFalse();
		assertThat(storedCreated.has("secret")).isFalse();
		assertThat(storedCreated.has("passwordHash")).isFalse();
		assertThat(storedCreated.has("email")).isFalse();

		JsonNode storedUpdated = objectMapper.readTree(String.valueOf(stored.get(1).get("summary")));
		assertThat(storedUpdated.isObject()).isTrue();
		assertThat(storedUpdated.size()).isEqualTo(2);
		assertThat(storedUpdated.propertyNames())
				.containsExactlyInAnyOrder("changedFields", "assigneeId");
		assertThat(storedUpdated.get("changedFields").isArray()).isTrue();
		assertThat(storedUpdated.get("changedFields").size()).isEqualTo(1);
		assertThat(storedUpdated.get("changedFields").get(0).asText()).isEqualTo("title");
		assertThat(storedUpdated.get("assigneeId").isNull()).isTrue();
		assertThat(storedUpdated.has("actorId")).isFalse();
		assertThat(storedUpdated.has("secret")).isFalse();
		assertThat(storedUpdated.has("passwordHash")).isFalse();
		assertThat(storedUpdated.has("email")).isFalse();
	}

	@Test
	void updateTitleOnlyRecordsChangedFieldsTitle() throws Exception {
		LoginSession admin = login("lifecycle-chgtitle-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE51", "Change title");
		String issueKey = createIssue(admin, key, "STORY", "Old title", "desc", null);

		LoginSession member = login("lifecycle-chgtitle-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"New title","description":"desc","assigneeId":null,
						 "expectedVersion":0}
						"""))
				.andExpect(status().isOk());

		JsonNode updated = updatedSummary(issueKey);
		assertThat(updated.get("changedFields").size()).isEqualTo(1);
		assertThat(updated.get("changedFields").get(0).asText()).isEqualTo("title");
		assertThat(updated.get("assigneeId").isNull()).isTrue();
	}

	@Test
	void updateDescriptionOnlyRecordsChangedFieldsDescription() throws Exception {
		LoginSession admin = login("lifecycle-chgdesc-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE52", "Change description");
		String issueKey = createIssue(admin, key, "STORY", "Same title", "old desc", null);

		LoginSession member = login("lifecycle-chgdesc-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"Same title","description":"new desc","assigneeId":null,
						 "expectedVersion":0}
						"""))
				.andExpect(status().isOk());

		JsonNode updated = updatedSummary(issueKey);
		assertThat(updated.get("changedFields").size()).isEqualTo(1);
		assertThat(updated.get("changedFields").get(0).asText()).isEqualTo("description");
		assertThat(updated.get("assigneeId").isNull()).isTrue();
	}

	@Test
	void updateAssigneeOnlyRecordsChangedFieldsAssigneeId() throws Exception {
		LoginSession admin = login("lifecycle-chgassign-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE53", "Change assignee");
		String issueKey = createIssue(admin, key, "STORY", "Same title", "desc", null);

		LoginSession assignee = login("lifecycle-chgassign-assignee@example.com", UserRole.USER);
		addMember(key, assignee.userId(), "MEMBER");

		LoginSession member = login("lifecycle-chgassign-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"Same title","description":"desc","assigneeId":"%s",
						 "expectedVersion":0}
						""".formatted(assignee.userId())))
				.andExpect(status().isOk());

		JsonNode updated = updatedSummary(issueKey);
		assertThat(updated.get("changedFields").size()).isEqualTo(1);
		assertThat(updated.get("changedFields").get(0).asText()).isEqualTo("assigneeId");
		assertThat(updated.get("assigneeId").asText()).isEqualTo(assignee.userId().toString());
	}

	@Test
	void updateClearingDescriptionAndAssigneeRecordsBothChangedFields() throws Exception {
		LoginSession admin = login("lifecycle-chgclear-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE54", "Clear changed");
		LoginSession assignee = login("lifecycle-chgclear-assignee@example.com", UserRole.USER);
		addMember(key, assignee.userId(), "MEMBER");
		String issueKey = createIssue(admin, key, "STORY", "Same title", "some desc",
				assignee.userId());

		LoginSession member = login("lifecycle-chgclear-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"Same title","description":null,"assigneeId":null,
						 "expectedVersion":0}
						"""))
				.andExpect(status().isOk());

		JsonNode updated = updatedSummary(issueKey);
		assertThat(updated.get("changedFields").size()).isEqualTo(2);
		assertThat(updated.get("changedFields").get(0).asText()).isEqualTo("description");
		assertThat(updated.get("changedFields").get(1).asText()).isEqualTo("assigneeId");
		assertThat(updated.get("assigneeId").isNull()).isTrue();
	}

	@Test
	void genuineNoOpUpdateRecordsNoChangedFields() throws Exception {
		LoginSession admin = login("lifecycle-chgnoop-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE55", "No-op changed");
		String issueKey = createIssue(admin, key, "STORY", "Same", "desc", null);

		LoginSession member = login("lifecycle-chgnoop-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		LifecycleSnapshot before = lifecycleSnapshot(issueKey, key);

		mockMvc.perform(patch("/api/issues/{issueKey}", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"title":"Same","description":"desc","assigneeId":null,
						 "expectedVersion":0}
						"""))
				.andExpect(status().isOk());

		// A genuine no-op must not create an UPDATED activity at all; the complete
		// lifecycle state (issue row, ordered activities, counter) is unchanged.
		assertLifecycleUnchanged(before, issueKey, key);
	}

	@Test
	void nonmemberActivityReturns404IssueNotFound() throws Exception {
		LoginSession admin = login("lifecycle-act404-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE56", "Activity 404");
		String issueKey = createIssue(admin, key, "STORY", "Hidden activity", "desc", null);

		// A nonmember cannot read activity; the issue is hidden.
		LoginSession outsider = login("lifecycle-act404-outsider@example.com", UserRole.USER);
		MvcResult result = mockMvc.perform(get("/api/issues/{issueKey}/activity", issueKey).cookie(outsider.session(), outsider.csrfCookie()))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("ISSUE_NOT_FOUND"))
				.andExpect(jsonPath("$.detail").value("İş bulunamadı."))
				.andReturn();
		assertNoInternalDetail(result);
	}

	@Test
	void unknownIssueActivityReturns404IssueNotFound() throws Exception {
		LoginSession admin = login("lifecycle-act404key-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIFE57", "Activity unknown");
		createIssue(admin, key, "STORY", "Known", "desc", null);

		LoginSession member = login("lifecycle-act404key-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		// An unknown issue key is not found even for a project member.
		MvcResult result = mockMvc.perform(get("/api/issues/{issueKey}/activity", "LIFE57-999").cookie(member.session(), member.csrfCookie()))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("ISSUE_NOT_FOUND"))
				.andExpect(jsonPath("$.detail").value("İş bulunamadı."))
				.andReturn();
		assertNoInternalDetail(result);
	}

	@Test
	void anonymousActivityReturns401Unauthenticated() throws Exception {
		// Anonymous cannot read activity; the security layer rejects before any
		// endpoint-dependent logic runs.
		mockMvc.perform(get("/api/issues/LIFE58-1/activity"))
				.andExpect(status().isUnauthorized())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("UNAUTHENTICATED"))
				.andExpect(jsonPath("$.detail").value("Oturum açmanız gerekiyor."));
	}

	// ------------------------------------------------------------------
	// PATCH /api/issues/{issueKey}/move
	// ------------------------------------------------------------------

	// --- Happy paths ---------------------------------------------------

	@Test
	void orgAdminMovesToEmptyDestination() throws Exception {
		LoginSession admin = login("move-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE01", "Move admin");
		String issueKey = createIssue(admin, key, "STORY", "Move me", "desc", null);
		long version = issueVersion(issueKey);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"IN_PROGRESS","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(version)))
				.andExpect(status().isOk())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andReturn();

		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("issueKey").asText()).isEqualTo(issueKey);
		assertThat(body.get("statusCode").asText()).isEqualTo("IN_PROGRESS");
		assertThat(body.get("rank").asLong()).isEqualTo(1024L);
		assertThat(body.get("version").asLong()).isEqualTo(version + 1);
		assertSafeIssueDto(body);
	}

	@Test
	void projectLeadMovesSuccessfully() throws Exception {
		LoginSession admin = login("move-lead-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE02", "Move lead");
		String issueKey = createIssue(admin, key, "TASK", "Lead move", "desc", null);

		LoginSession lead = login("move-lead@example.com", UserRole.USER);
		addMember(key, lead.userId(), "PROJECT_LEAD");

		long version = issueVersion(issueKey);
		mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(lead.session(), lead.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(lead.csrfHeader(), lead.csrfToken())
				.content("""
						{"targetStatusCode":"DONE","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(version)))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.issueKey").value(issueKey))
				.andExpect(jsonPath("$.statusCode").value("DONE"))
				.andExpect(jsonPath("$.rank").value(1024));
	}

	@Test
	void memberMovesSuccessfully() throws Exception {
		LoginSession admin = login("move-member-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE03", "Move member");
		String issueKey = createIssue(admin, key, "BUG", "Member move", "desc", null);

		LoginSession member = login("move-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		long version = issueVersion(issueKey);
		mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"targetStatusCode":"IN_PROGRESS","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(version)))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.issueKey").value(issueKey))
				.andExpect(jsonPath("$.statusCode").value("IN_PROGRESS"));
	}

	@Test
	void crossStatusAppendToNonEmptyDestination() throws Exception {
		LoginSession admin = login("move-append-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE04", "Move append");
		String destA = createIssue(admin, key, "STORY", "Dest A", "desc", null);
		String destB = createIssue(admin, key, "TASK", "Dest B", "desc", null);
		String moving = createIssue(admin, key, "BUG", "Moving", "desc", null);

		// Place destA and destB into IN_PROGRESS directly (fixture only).
		setIssueStatusAndRank(destA, "IN_PROGRESS", 1024L);
		setIssueStatusAndRank(destB, "IN_PROGRESS", 2048L);

		// Snapshot every destination issue before the move.
		Map<String, IssueState> destBefore = statusState(key, "IN_PROGRESS");
		long version = issueVersion(moving);
		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", moving).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"IN_PROGRESS","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(version)))
				.andExpect(status().isOk())
				.andReturn();

		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("statusCode").asText()).isEqualTo("IN_PROGRESS");
		assertThat(body.get("rank").asLong()).isEqualTo(3072L);
		assertThat(body.get("version").asLong()).isEqualTo(version + 1);

		// Destination active order is exactly A, B, moving with ranks 1024, 2048, 3072.
		assertActiveOrder(key, "IN_PROGRESS", List.of(destA, destB, moving));

		// Append must not rewrite/version-bump existing correctly ranked destination
		// issues: destA and destB keep their ranks and versions; only the moving
		// issue increments once.
		Map<String, IssueState> destAfter = statusState(key, "IN_PROGRESS");
		assertMoveVersioning(destBefore, destAfter, version, issueVersion(moving));
	}

	@Test
	void crossStatusInsertBeforeNeighbor() throws Exception {
		LoginSession admin = login("move-before-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE05", "Move before");
		String destA = createIssue(admin, key, "STORY", "Dest A", "desc", null);
		String destB = createIssue(admin, key, "TASK", "Dest B", "desc", null);
		String moving = createIssue(admin, key, "BUG", "Moving", "desc", null);

		setIssueStatusAndRank(destA, "IN_PROGRESS", 1024L);
		setIssueStatusAndRank(destB, "IN_PROGRESS", 2048L);

		// Snapshot every destination issue before the move.
		Map<String, IssueState> destBefore = statusState(key, "IN_PROGRESS");
		long version = issueVersion(moving);
		mockMvc.perform(patch("/api/issues/{issueKey}/move", moving).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"IN_PROGRESS","beforeIssueKey":"%s",
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(destA, version)))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.statusCode").value("IN_PROGRESS"))
				.andExpect(jsonPath("$.rank").value(1024));

		// moving is placed immediately before destA.
		assertActiveOrder(key, "IN_PROGRESS", List.of(moving, destA, destB));

		// Inserting before destA rewrites destA (1024->2048) and destB (2048->3072),
		// so both neighbors increment once; the moving issue increments once.
		Map<String, IssueState> destAfter = statusState(key, "IN_PROGRESS");
		assertMoveVersioning(destBefore, destAfter, version, issueVersion(moving));
	}

	@Test
	void crossStatusInsertAfterNeighbor() throws Exception {
		LoginSession admin = login("move-after-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE06", "Move after");
		String destA = createIssue(admin, key, "STORY", "Dest A", "desc", null);
		String destB = createIssue(admin, key, "TASK", "Dest B", "desc", null);
		String moving = createIssue(admin, key, "BUG", "Moving", "desc", null);

		setIssueStatusAndRank(destA, "IN_PROGRESS", 1024L);
		setIssueStatusAndRank(destB, "IN_PROGRESS", 2048L);

		// Snapshot every destination issue before the move.
		Map<String, IssueState> destBefore = statusState(key, "IN_PROGRESS");
		long version = issueVersion(moving);
		mockMvc.perform(patch("/api/issues/{issueKey}/move", moving).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"IN_PROGRESS","beforeIssueKey":null,
						 "afterIssueKey":"%s","expectedVersion":%d}
						""".formatted(destA, version)))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.statusCode").value("IN_PROGRESS"))
				.andExpect(jsonPath("$.rank").value(2048));

		// moving is placed immediately after destA.
		assertActiveOrder(key, "IN_PROGRESS", List.of(destA, moving, destB));

		// Inserting after destA rewrites destB (2048->3072) so it increments once;
		// destA keeps its rank/version; the moving issue increments once.
		Map<String, IssueState> destAfter = statusState(key, "IN_PROGRESS");
		assertMoveVersioning(destBefore, destAfter, version, issueVersion(moving));
	}

	@Test
	void sameStatusReorderBefore() throws Exception {
		LoginSession admin = login("move-samebefore-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE07", "Same before");
		String a = createIssue(admin, key, "STORY", "A", "desc", null);
		String b = createIssue(admin, key, "TASK", "B", "desc", null);
		String c = createIssue(admin, key, "BUG", "C", "desc", null);

		// All three are in TO_DO with ranks 1024, 2048, 3072. Move C before A.
		Map<String, IssueState> before = statusState(key, "TO_DO");
		long version = issueVersion(c);
		mockMvc.perform(patch("/api/issues/{issueKey}/move", c).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"TO_DO","beforeIssueKey":"%s",
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(a, version)))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.statusCode").value("TO_DO"))
				.andExpect(jsonPath("$.rank").value(1024));

		assertActiveOrder(key, "TO_DO", List.of(c, a, b));

		// Same-status compaction: c moves to 1024, a rewrites to 2048, b to 3072.
		// a and b increment once (rank changed); c increments once.
		Map<String, IssueState> after = statusState(key, "TO_DO");
		assertMoveVersioning(before, after, version, issueVersion(c));
	}

	@Test
	void sameStatusReorderAfter() throws Exception {
		LoginSession admin = login("move-sameafter-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE08", "Same after");
		String a = createIssue(admin, key, "STORY", "A", "desc", null);
		String b = createIssue(admin, key, "TASK", "B", "desc", null);
		String c = createIssue(admin, key, "BUG", "C", "desc", null);

		// Move A after B.
		Map<String, IssueState> before = statusState(key, "TO_DO");
		long version = issueVersion(a);
		mockMvc.perform(patch("/api/issues/{issueKey}/move", a).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"TO_DO","beforeIssueKey":null,
						 "afterIssueKey":"%s","expectedVersion":%d}
						""".formatted(b, version)))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.statusCode").value("TO_DO"))
				.andExpect(jsonPath("$.rank").value(2048));

		assertActiveOrder(key, "TO_DO", List.of(b, a, c));

		// Same-status compaction: b rewrites to 1024 (rank changed, increments once);
		// c keeps its rank/version; a increments once.
		Map<String, IssueState> after = statusState(key, "TO_DO");
		assertMoveVersioning(before, after, version, issueVersion(a));
	}

	@Test
	void sameStatusBothNullMovesToEnd() throws Exception {
		LoginSession admin = login("move-sameend-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE09", "Same end");
		String a = createIssue(admin, key, "STORY", "A", "desc", null);
		String b = createIssue(admin, key, "TASK", "B", "desc", null);
		String c = createIssue(admin, key, "BUG", "C", "desc", null);

		// Move A to the end of TO_DO.
		Map<String, IssueState> before = statusState(key, "TO_DO");
		long version = issueVersion(a);
		mockMvc.perform(patch("/api/issues/{issueKey}/move", a).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"TO_DO","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(version)))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.statusCode").value("TO_DO"))
				.andExpect(jsonPath("$.rank").value(3072));

		assertActiveOrder(key, "TO_DO", List.of(b, c, a));

		// Same-status compaction: b rewrites to 1024 and c to 2048 (both increment
		// once); a increments once.
		Map<String, IssueState> after = statusState(key, "TO_DO");
		assertMoveVersioning(before, after, version, issueVersion(a));
	}

	@Test
	void moveResponseHasExactSafeIssueResponseFields() throws Exception {
		LoginSession admin = login("move-safe-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE10", "Move safe");
		String issueKey = createIssue(admin, key, "STORY", "Safe move", "desc", null);

		long version = issueVersion(issueKey);
		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"DONE","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(version)))
				.andExpect(status().isOk())
				.andReturn();

		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertSafeIssueDto(body);
	}

	@Test
	void moveChangesOnlyStatusRankUpdatedAtVersion() throws Exception {
		LoginSession admin = login("move-only-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE11", "Move only");
		String issueKey = createIssue(admin, key, "STORY", "Only fields", "desc", null);

		Map<String, Object> before = issueSnapshot(issueKey);
		long version = issueVersion(issueKey);

		mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"IN_PROGRESS","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(version)))
				.andExpect(status().isOk());

		Map<String, Object> after = issueSnapshot(issueKey);
		// Immutable fields unchanged.
		assertThat(after.get("project_id")).isEqualTo(before.get("project_id"));
		assertThat(after.get("reporter_id")).isEqualTo(before.get("reporter_id"));
		assertThat(after.get("number")).isEqualTo(before.get("number"));
		assertThat(after.get("human_key")).isEqualTo(before.get("human_key"));
		assertThat(after.get("type")).isEqualTo(before.get("type"));
		assertThat(after.get("title")).isEqualTo(before.get("title"));
		assertThat(after.get("description")).isEqualTo(before.get("description"));
		assertThat(after.get("assignee_id")).isEqualTo(before.get("assignee_id"));
		assertThat(after.get("archived")).isEqualTo(before.get("archived"));
		assertThat(after.get("created_at")).isEqualTo(before.get("created_at"));
		// Status, rank, version changed; updated_at changed.
		assertThat(after.get("workflow_status_id")).isNotEqualTo(before.get("workflow_status_id"));
		assertThat(after.get("rank")).isEqualTo(1024L);
		assertThat(after.get("version")).isEqualTo(version + 1);
		assertThat(after.get("updated_at")).isNotEqualTo(before.get("updated_at"));
	}

	@Test
	void moveProducesExactMovedActivityDtoActorOrderingAndSummary() throws Exception {
		LoginSession admin = login("move-act-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE12", "Move activity");
		String issueKey = createIssue(admin, key, "STORY", "Move activity", "desc", null);

		LoginSession member = login("move-act-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		long version = issueVersion(issueKey);
		mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"targetStatusCode":"IN_PROGRESS","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(version)))
				.andExpect(status().isOk());

		// Exactly two activities: CREATED then MOVED, by the correct actors.
		List<Map<String, Object>> activities = jdbcTemplate.queryForList(
				"SELECT ia.type, ia.actor_id, ia.summary"
						+ " FROM issue_activity ia JOIN issue i ON i.id = ia.issue_id"
						+ " WHERE i.human_key = ? ORDER BY ia.created_at, ia.id",
				issueKey);
		assertThat(activities).hasSize(2);
		assertThat(activities.get(0).get("type")).isEqualTo("CREATED");
		assertThat(activities.get(0).get("actor_id")).isEqualTo(admin.userId());
		assertThat(activities.get(1).get("type")).isEqualTo("MOVED");
		assertThat(activities.get(1).get("actor_id")).isEqualTo(member.userId());

		// MOVED summary is exactly {"fromStatusCode":"TO_DO","toStatusCode":"IN_PROGRESS"}.
		JsonNode summary = objectMapper.readTree(String.valueOf(activities.get(1).get("summary")));
		assertThat(summary.isObject()).isTrue();
		assertThat(summary.size()).isEqualTo(2);
		assertThat(summary.propertyNames())
				.containsExactlyInAnyOrder("fromStatusCode", "toStatusCode");
		assertThat(summary.get("fromStatusCode").asText()).isEqualTo("TO_DO");
		assertThat(summary.get("toStatusCode").asText()).isEqualTo("IN_PROGRESS");
		String raw = summary.toString();
		assertThat(raw).doesNotContain("Move activity", "desc");
		assertThat(raw).doesNotContain("move-act-admin@example.com");
		assertThat(raw).doesNotContain("move-act-member@example.com");
		assertThat(raw).doesNotContain("password", "token", "cookie", "session");
	}

	@Test
	void destinationRanksAreExactlySpacedAndOrdered() throws Exception {
		LoginSession admin = login("move-ranks-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE13", "Move ranks");
		String a = createIssue(admin, key, "STORY", "A", "desc", null);
		String b = createIssue(admin, key, "TASK", "B", "desc", null);
		String c = createIssue(admin, key, "BUG", "C", "desc", null);
		String d = createIssue(admin, key, "STORY", "D", "desc", null);

		// Move A, B, C into IN_PROGRESS, then move D before B.
		setIssueStatusAndRank(a, "IN_PROGRESS", 1024L);
		setIssueStatusAndRank(b, "IN_PROGRESS", 2048L);
		setIssueStatusAndRank(c, "IN_PROGRESS", 3072L);

		// Snapshot every destination issue before the move.
		Map<String, IssueState> destBefore = statusState(key, "IN_PROGRESS");
		long version = issueVersion(d);
		mockMvc.perform(patch("/api/issues/{issueKey}/move", d).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"IN_PROGRESS","beforeIssueKey":"%s",
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(b, version)))
				.andExpect(status().isOk());

		// Final active order A, D, B, C with exact ranks 1024, 2048, 3072, 4096.
		List<Map<String, Object>> rows = jdbcTemplate.queryForList(
				"SELECT i.human_key, i.rank FROM issue i"
						+ " JOIN workflow_status ws ON ws.id = i.workflow_status_id"
						+ " JOIN project p ON p.id = i.project_id"
						+ " WHERE p.key = ? AND ws.code = 'IN_PROGRESS' AND i.archived = FALSE"
						+ " ORDER BY i.rank",
				key);
		assertThat(rows).hasSize(4);
		assertThat(rows.get(0).get("human_key")).isEqualTo(a);
		assertThat(rows.get(0).get("rank")).isEqualTo(1024L);
		assertThat(rows.get(1).get("human_key")).isEqualTo(d);
		assertThat(rows.get(1).get("rank")).isEqualTo(2048L);
		assertThat(rows.get(2).get("human_key")).isEqualTo(b);
		assertThat(rows.get(2).get("rank")).isEqualTo(3072L);
		assertThat(rows.get(3).get("human_key")).isEqualTo(c);
		assertThat(rows.get(3).get("rank")).isEqualTo(4096L);

		// Inserting D before B rewrites B (2048->3072) and C (3072->4096), so both
		// increment once; A keeps its rank/version; D increments once.
		Map<String, IssueState> destAfter = statusState(key, "IN_PROGRESS");
		assertMoveVersioning(destBefore, destAfter, version, issueVersion(d));
	}

	@Test
	void movePreservesSourceProjectStatusKeyNumberTypeReporterAssignee() throws Exception {
		LoginSession admin = login("move-preserve-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE14", "Move preserve");
		LoginSession assignee = login("move-preserve-assignee@example.com", UserRole.USER);
		addMember(key, assignee.userId(), "MEMBER");
		String issueKey = createIssue(admin, key, "BUG", "Preserve", "desc", assignee.userId());

		Map<String, Object> before = issueSnapshot(issueKey);
		long version = issueVersion(issueKey);

		mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"DONE","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(version)))
				.andExpect(status().isOk());

		Map<String, Object> after = issueSnapshot(issueKey);
		assertThat(after.get("project_id")).isEqualTo(before.get("project_id"));
		assertThat(after.get("number")).isEqualTo(before.get("number"));
		assertThat(after.get("human_key")).isEqualTo(before.get("human_key"));
		assertThat(after.get("type")).isEqualTo(before.get("type"));
		assertThat(after.get("reporter_id")).isEqualTo(before.get("reporter_id"));
		assertThat(after.get("assignee_id")).isEqualTo(before.get("assignee_id"));
	}

	// --- No-op ---------------------------------------------------------

	@Test
	void alreadyLastSameStatusAppendIsGenuineNoOp() throws Exception {
		LoginSession admin = login("move-noopend-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE15", "No-op end");
		String a = createIssue(admin, key, "STORY", "A", "desc", null);
		String b = createIssue(admin, key, "TASK", "B", "desc", null);

		// B is already last in TO_DO; appending it again is a genuine no-op.
		MoveSnapshot before = moveSnapshot(b, key, "TO_DO", "TO_DO");
		long version = issueVersion(b);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", b).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"TO_DO","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(version)))
				.andExpect(status().isOk())
				.andReturn();

		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("version").asLong()).isEqualTo(version);

		assertMoveUnchanged(before, b, key, "TO_DO", "TO_DO");
	}

	@Test
	void alreadyImmediatelyBeforeOrAfterNeighborIsNoOp() throws Exception {
		LoginSession admin = login("move-noopneighbor-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE16", "No-op neighbor");
		String a = createIssue(admin, key, "STORY", "A", "desc", null);
		String b = createIssue(admin, key, "TASK", "B", "desc", null);
		String c = createIssue(admin, key, "BUG", "C", "desc", null);

		// B is already immediately after A; moving B after A is a no-op.
		MoveSnapshot before = moveSnapshot(b, key, "TO_DO", "TO_DO");
		long version = issueVersion(b);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", b).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"TO_DO","beforeIssueKey":null,
						 "afterIssueKey":"%s","expectedVersion":%d}
						""".formatted(a, version)))
				.andExpect(status().isOk())
				.andReturn();

		// Response 200 unchanged: version and updatedAt unchanged.
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("version").asLong()).isEqualTo(version);

		// Complete moving/project-order/activity/counter snapshot unchanged; no MOVED
		// activity; no neighbor version/rank changes.
		assertMoveUnchanged(before, b, key, "TO_DO", "TO_DO");
	}

	@Test
	void alreadyImmediatelyBeforeNeighborIsNoOp() throws Exception {
		LoginSession admin = login("move-noopbefore-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE16B", "No-op before neighbor");
		String a = createIssue(admin, key, "STORY", "A", "desc", null);
		String b = createIssue(admin, key, "TASK", "B", "desc", null);
		String c = createIssue(admin, key, "BUG", "C", "desc", null);

		// B is already immediately before C; moving B before C is a no-op.
		MoveSnapshot before = moveSnapshot(b, key, "TO_DO", "TO_DO");
		long version = issueVersion(b);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", b).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"TO_DO","beforeIssueKey":"%s",
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(c, version)))
				.andExpect(status().isOk())
				.andReturn();

		// Response 200 unchanged: version and updatedAt unchanged.
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("version").asLong()).isEqualTo(version);

		// Complete moving/project-order/activity/counter snapshot unchanged; no MOVED
		// activity; no neighbor version/rank changes.
		assertMoveUnchanged(before, b, key, "TO_DO", "TO_DO");
	}

	@Test
	void noOpPreservesCompleteIssueActivityCounterSnapshots() throws Exception {
		LoginSession admin = login("move-noopsnap-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE17", "No-op snapshot");
		String a = createIssue(admin, key, "STORY", "A", "desc", null);
		String b = createIssue(admin, key, "TASK", "B", "desc", null);

		// B is already last; appending is a no-op. Snapshot the complete lifecycle
		// plus every active issue row in the affected status.
		MoveSnapshot before = moveSnapshot(b, key, "TO_DO", "TO_DO");
		long version = issueVersion(b);

		mockMvc.perform(patch("/api/issues/{issueKey}/move", b).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"TO_DO","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(version)))
				.andExpect(status().isOk());

		assertMoveUnchanged(before, b, key, "TO_DO", "TO_DO");
	}

	// --- Validation / semantic failures --------------------------------

	@Test
	void moveToUnknownTargetStatusReturnsInvalidWorkflowStatus() throws Exception {
		LoginSession admin = login("move-unknownstatus-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE18", "Unknown status");
		String issueKey = createIssue(admin, key, "STORY", "Unknown status", "desc", null);

		MoveSnapshot before = moveSnapshot(issueKey, key, "TO_DO", "UNKNOWN");
		long version = issueVersion(issueKey);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"UNKNOWN","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(version)))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_WORKFLOW_STATUS"))
				.andExpect(jsonPath("$.detail").value("Geçersiz iş akışı durumu."))
				.andReturn();
		assertNoInternalDetail(result);

		assertMoveUnchanged(before, issueKey, key, "TO_DO", "UNKNOWN");
	}

	@Test
	void moveToStatusFromAnotherProjectReturnsInvalidWorkflowStatus() throws Exception {
		LoginSession admin = login("move-crossstatus-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE19", "Cross status");
		createProject(admin, "MOVE20", "Other status project");
		String issueKey = createIssue(admin, key, "STORY", "Cross status", "desc", null);

		// Remove the IN_PROGRESS status from the moving issue's project so the
		// target status is not project-owned (it exists only in the other project).
		jdbcTemplate.update(
				"DELETE FROM workflow_status ws WHERE ws.project_id ="
						+ " (SELECT id FROM project WHERE key = ?) AND ws.code = 'IN_PROGRESS'",
				key);

		MoveSnapshot before = moveSnapshot(issueKey, key, "TO_DO", "IN_PROGRESS");
		long version = issueVersion(issueKey);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"IN_PROGRESS","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(version)))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_WORKFLOW_STATUS"))
				.andExpect(jsonPath("$.detail").value("Geçersiz iş akışı durumu."))
				.andReturn();
		assertNoInternalDetail(result);

		assertMoveUnchanged(before, issueKey, key, "TO_DO", "IN_PROGRESS");
	}

	@Test
	void moveWithBothBeforeAndAfterReturnsValidationFailed() throws Exception {
		LoginSession admin = login("move-both-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE21", "Both neighbors");
		String a = createIssue(admin, key, "STORY", "A", "desc", null);
		String b = createIssue(admin, key, "TASK", "B", "desc", null);
		String moving = createIssue(admin, key, "BUG", "Moving", "desc", null);

		MoveSnapshot before = moveSnapshot(moving, key, "TO_DO", "TO_DO");
		long version = issueVersion(moving);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", moving).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"TO_DO","beforeIssueKey":"%s",
						 "afterIssueKey":"%s","expectedVersion":%d}
						""".formatted(a, b, version)))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andExpect(jsonPath("$.detail").value("İstek doğrulama kurallarını karşılamıyor."))
				.andReturn();
		assertNoInternalDetail(result);

		assertMoveUnchanged(before, moving, key, "TO_DO", "TO_DO");
	}

	@Test
	void moveWithBlankTargetStatusCodeReturnsValidationFailed() throws Exception {
		LoginSession admin = login("move-blanktarget-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE22", "Blank target");
		String issueKey = createIssue(admin, key, "STORY", "Blank target", "desc", null);

		MoveSnapshot before = moveSnapshot(issueKey, key, "TO_DO", "TO_DO");
		long version = issueVersion(issueKey);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"   ","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(version)))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andExpect(jsonPath("$.detail").value("İstek doğrulama kurallarını karşılamıyor."))
				.andReturn();
		assertNoInternalDetail(result);

		assertMoveUnchanged(before, issueKey, key, "TO_DO", "TO_DO");
	}

	@Test
	void moveWithOversizedTargetStatusCodeReturnsValidationFailed() throws Exception {
		LoginSession admin = login("move-oversizetarget-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE22B", "Oversized target");
		String issueKey = createIssue(admin, key, "STORY", "Oversized target", "desc", null);

		MoveSnapshot before = moveSnapshot(issueKey, key, "TO_DO", "TO_DO");
		long version = issueVersion(issueKey);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"%s","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted("X".repeat(33), version)))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andReturn();
		assertNoInternalDetail(result);

		assertMoveUnchanged(before, issueKey, key, "TO_DO", "TO_DO");
	}

	@Test
	void moveWithBlankBeforeIssueKeyReturnsValidationFailed() throws Exception {
		LoginSession admin = login("move-blankbefore-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE22C", "Blank before");
		String issueKey = createIssue(admin, key, "STORY", "Blank before", "desc", null);

		MoveSnapshot before = moveSnapshot(issueKey, key, "TO_DO", "TO_DO");
		long version = issueVersion(issueKey);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"TO_DO","beforeIssueKey":"   ",
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(version)))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andReturn();
		assertNoInternalDetail(result);

		assertMoveUnchanged(before, issueKey, key, "TO_DO", "TO_DO");
	}

	@Test
	void moveWithOversizedBeforeIssueKeyReturnsValidationFailed() throws Exception {
		LoginSession admin = login("move-oversizebefore-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE22D", "Oversized before");
		String issueKey = createIssue(admin, key, "STORY", "Oversized before", "desc", null);

		MoveSnapshot before = moveSnapshot(issueKey, key, "TO_DO", "TO_DO");
		long version = issueVersion(issueKey);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"TO_DO","beforeIssueKey":"%s",
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted("X".repeat(33), version)))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andReturn();
		assertNoInternalDetail(result);

		assertMoveUnchanged(before, issueKey, key, "TO_DO", "TO_DO");
	}

	@Test
	void moveWithBlankAfterIssueKeyReturnsValidationFailed() throws Exception {
		LoginSession admin = login("move-blankafter-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE22E", "Blank after");
		String issueKey = createIssue(admin, key, "STORY", "Blank after", "desc", null);

		MoveSnapshot before = moveSnapshot(issueKey, key, "TO_DO", "TO_DO");
		long version = issueVersion(issueKey);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"TO_DO","beforeIssueKey":null,
						 "afterIssueKey":"   ","expectedVersion":%d}
						""".formatted(version)))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andReturn();
		assertNoInternalDetail(result);

		assertMoveUnchanged(before, issueKey, key, "TO_DO", "TO_DO");
	}

	@Test
	void moveWithOversizedAfterIssueKeyReturnsValidationFailed() throws Exception {
		LoginSession admin = login("move-oversizeafter-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE22F", "Oversized after");
		String issueKey = createIssue(admin, key, "STORY", "Oversized after", "desc", null);

		MoveSnapshot before = moveSnapshot(issueKey, key, "TO_DO", "TO_DO");
		long version = issueVersion(issueKey);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"TO_DO","beforeIssueKey":null,
						 "afterIssueKey":"%s","expectedVersion":%d}
						""".formatted("Y".repeat(33), version)))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andReturn();
		assertNoInternalDetail(result);

		assertMoveUnchanged(before, issueKey, key, "TO_DO", "TO_DO");
	}

	@Test
	void moveWithMissingExpectedVersionReturnsValidationFailed() throws Exception {
		LoginSession admin = login("move-missingversion-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE23", "Missing version");
		String issueKey = createIssue(admin, key, "STORY", "Missing version", "desc", null);

		MoveSnapshot before = moveSnapshot(issueKey, key, "TO_DO", "TO_DO");

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"TO_DO","beforeIssueKey":null,"afterIssueKey":null}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andExpect(jsonPath("$.detail").value("İstek doğrulama kurallarını karşılamıyor."))
				.andReturn();
		assertNoInternalDetail(result);

		assertMoveUnchanged(before, issueKey, key, "TO_DO", "TO_DO");
	}

	@Test
	void moveWithNegativeExpectedVersionReturnsValidationFailed() throws Exception {
		LoginSession admin = login("move-negativeversion-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE23B", "Negative version");
		String issueKey = createIssue(admin, key, "STORY", "Negative version", "desc", null);

		MoveSnapshot before = moveSnapshot(issueKey, key, "TO_DO", "TO_DO");

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"TO_DO","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":-1}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andReturn();
		assertNoInternalDetail(result);

		assertMoveUnchanged(before, issueKey, key, "TO_DO", "TO_DO");
	}

	@Test
	void moveWithSelfAsNeighborReturnsInvalidIssuePosition() throws Exception {
		LoginSession admin = login("move-self-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE24", "Self neighbor");
		String issueKey = createIssue(admin, key, "STORY", "Self", "desc", null);

		MoveSnapshot before = moveSnapshot(issueKey, key, "TO_DO", "TO_DO");
		long version = issueVersion(issueKey);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"TO_DO","beforeIssueKey":"%s",
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(issueKey, version)))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_ISSUE_POSITION"))
				.andExpect(jsonPath("$.detail").value("Geçersiz iş konumu."))
				.andReturn();
		assertNoInternalDetail(result);

		assertMoveUnchanged(before, issueKey, key, "TO_DO", "TO_DO");
	}

	@Test
	void moveWithUnknownNeighborReturnsInvalidIssuePosition() throws Exception {
		LoginSession admin = login("move-unknownneighbor-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE25", "Unknown neighbor");
		String issueKey = createIssue(admin, key, "STORY", "Unknown neighbor", "desc", null);

		MoveSnapshot before = moveSnapshot(issueKey, key, "TO_DO", "TO_DO");
		long version = issueVersion(issueKey);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"TO_DO","beforeIssueKey":"MOVE25-999",
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(version)))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_ISSUE_POSITION"))
				.andExpect(jsonPath("$.detail").value("Geçersiz iş konumu."))
				.andReturn();
		assertNoInternalDetail(result);

		assertMoveUnchanged(before, issueKey, key, "TO_DO", "TO_DO");
	}

	@Test
	void moveWithNeighborFromAnotherProjectReturnsInvalidIssuePosition() throws Exception {
		LoginSession admin = login("move-crossneighbor-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE26", "Cross neighbor");
		String otherKey = createProject(admin, "MOVE27", "Other neighbor project");
		String issueKey = createIssue(admin, key, "STORY", "Cross neighbor", "desc", null);
		String otherIssue = createIssue(admin, otherKey, "TASK", "Other", "desc", null);

		MoveSnapshot before = moveSnapshot(issueKey, key, "TO_DO", "TO_DO");
		// The cross-project neighbor falls outside the moving-project snapshot, so
		// capture its own complete state (full issue row, activities, its project
		// counter) directly.
		LifecycleSnapshot neighborBefore = lifecycleSnapshot(otherIssue, otherKey);
		long version = issueVersion(issueKey);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"TO_DO","beforeIssueKey":"%s",
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(otherIssue, version)))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_ISSUE_POSITION"))
				.andExpect(jsonPath("$.detail").value("Geçersiz iş konumu."))
				.andReturn();
		assertNoInternalDetail(result);

		assertMoveUnchanged(before, issueKey, key, "TO_DO", "TO_DO");
		// The cross-project neighbor's own state is unchanged.
		assertLifecycleUnchanged(neighborBefore, otherIssue, otherKey);
	}

	@Test
	void moveWithNeighborInWrongTargetStatusReturnsInvalidIssuePosition() throws Exception {
		LoginSession admin = login("move-wrongstatus-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE28", "Wrong status neighbor");
		String issueKey = createIssue(admin, key, "STORY", "Wrong status", "desc", null);
		String neighbor = createIssue(admin, key, "TASK", "Neighbor", "desc", null);
		setIssueStatusAndRank(neighbor, "DONE", 1024L);

		MoveSnapshot before = moveSnapshot(issueKey, key, "TO_DO", "IN_PROGRESS");
		// The neighbor lives in DONE, outside the TO_DO/IN_PROGRESS snapshot, so
		// capture its own complete state (full issue row, activities, counter).
		LifecycleSnapshot neighborBefore = lifecycleSnapshot(neighbor, key);
		long version = issueVersion(issueKey);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"IN_PROGRESS","beforeIssueKey":"%s",
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(neighbor, version)))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_ISSUE_POSITION"))
				.andExpect(jsonPath("$.detail").value("Geçersiz iş konumu."))
				.andReturn();
		assertNoInternalDetail(result);

		assertMoveUnchanged(before, issueKey, key, "TO_DO", "IN_PROGRESS");
		// The wrong-target-status neighbor's own state is unchanged.
		assertLifecycleUnchanged(neighborBefore, neighbor, key);
	}

	@Test
	void moveWithArchivedNeighborReturnsInvalidIssuePosition() throws Exception {
		LoginSession admin = login("move-archneighbor-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE29", "Archived neighbor");
		String issueKey = createIssue(admin, key, "STORY", "Archived neighbor", "desc", null);
		String neighbor = createIssue(admin, key, "TASK", "Neighbor", "desc", null);
		jdbcTemplate.update("UPDATE issue SET archived = TRUE, version = version + 1"
				+ " WHERE human_key = ?", neighbor);

		MoveSnapshot before = moveSnapshot(issueKey, key, "TO_DO", "TO_DO");
		// The archived neighbor is excluded from the active-issue snapshot, so
		// capture its own complete state (full issue row including archived/status/
		// rank/updatedAt/version, activities, counter) directly.
		LifecycleSnapshot neighborBefore = lifecycleSnapshot(neighbor, key);
		long version = issueVersion(issueKey);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"TO_DO","beforeIssueKey":"%s",
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(neighbor, version)))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_ISSUE_POSITION"))
				.andExpect(jsonPath("$.detail").value("Geçersiz iş konumu."))
				.andReturn();
		assertNoInternalDetail(result);

		assertMoveUnchanged(before, issueKey, key, "TO_DO", "TO_DO");
		// The archived neighbor's own state is unchanged.
		assertLifecycleUnchanged(neighborBefore, neighbor, key);
	}

	@Test
	void moveWithStaleExpectedVersionReturnsVersionConflict() throws Exception {
		LoginSession admin = login("move-stale-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE30", "Stale move");
		String issueKey = createIssue(admin, key, "STORY", "Stale", "desc", null);

		MoveSnapshot before = moveSnapshot(issueKey, key, "TO_DO", "TO_DO");

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"TO_DO","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":5}
						"""))
				.andExpect(status().isConflict())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VERSION_CONFLICT"))
				.andExpect(jsonPath("$.detail").value("Kayıt başka bir işlem tarafından güncellendi."))
				.andReturn();
		assertNoInternalDetail(result);

		assertMoveUnchanged(before, issueKey, key, "TO_DO", "TO_DO");
	}

	@Test
	void moveArchivedIssueReturnsIssueArchived() throws Exception {
		LoginSession admin = login("move-archived-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE31", "Archived move");
		String issueKey = createIssue(admin, key, "STORY", "Archived", "desc", null);
		jdbcTemplate.update("UPDATE issue SET archived = TRUE, version = version + 1"
				+ " WHERE human_key = ?", issueKey);

		MoveSnapshot before = moveSnapshot(issueKey, key, "TO_DO", "TO_DO");
		long version = issueVersion(issueKey);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"targetStatusCode":"IN_PROGRESS","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(version)))
				.andExpect(status().isConflict())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("ISSUE_ARCHIVED"))
				.andExpect(jsonPath("$.detail").value("Arşivlenmiş iş değiştirilemez."))
				.andReturn();
		assertNoInternalDetail(result);

		assertMoveUnchanged(before, issueKey, key, "TO_DO", "TO_DO");
	}

	// --- Authorization / security --------------------------------------

	@Test
	void viewerMoveReturnsForbiddenWithNoWrites() throws Exception {
		LoginSession admin = login("move-viewer-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE32", "Viewer move");
		String issueKey = createIssue(admin, key, "STORY", "Viewer move", "desc", null);

		LoginSession viewer = login("move-viewer@example.com", UserRole.USER);
		addMember(key, viewer.userId(), "VIEWER");

		MoveSnapshot before = moveSnapshot(issueKey, key, "TO_DO", "TO_DO");
		long version = issueVersion(issueKey);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(viewer.session(), viewer.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(viewer.csrfHeader(), viewer.csrfToken())
				.content("""
						{"targetStatusCode":"IN_PROGRESS","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(version)))
				.andExpect(status().isForbidden())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("FORBIDDEN"))
				.andExpect(jsonPath("$.detail").value("Bu işlem için yetkiniz yok."))
				.andReturn();
		assertNoInternalDetail(result);

		assertMoveUnchanged(before, issueKey, key, "TO_DO", "TO_DO");
	}

	@Test
	void nonmemberMoveReturnsIssueNotFoundWithNoWrites() throws Exception {
		LoginSession admin = login("move-nonmember-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE33", "Nonmember move");
		String issueKey = createIssue(admin, key, "STORY", "Hidden move", "desc", null);

		LoginSession outsider = login("move-nonmember@example.com", UserRole.USER);

		MoveSnapshot before = moveSnapshot(issueKey, key, "TO_DO", "TO_DO");
		long version = issueVersion(issueKey);

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(outsider.session(), outsider.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(outsider.csrfHeader(), outsider.csrfToken())
				.content("""
						{"targetStatusCode":"IN_PROGRESS","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":%d}
						""".formatted(version)))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("ISSUE_NOT_FOUND"))
				.andExpect(jsonPath("$.detail").value("İş bulunamadı."))
				.andReturn();
		assertNoInternalDetail(result);

		assertMoveUnchanged(before, issueKey, key, "TO_DO", "TO_DO");
	}

	@Test
	void unknownIssueMoveReturnsIssueNotFound() throws Exception {
		LoginSession admin = login("move-unknown-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE34", "Unknown move");
		createIssue(admin, key, "STORY", "Known", "desc", null);

		LoginSession member = login("move-unknown-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		MoveSnapshot before = moveSnapshot("MOVE34-999", key, "TO_DO", "TO_DO");

		MvcResult result = mockMvc.perform(patch("/api/issues/{issueKey}/move", "MOVE34-999").cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"targetStatusCode":"IN_PROGRESS","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":0}
						"""))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("ISSUE_NOT_FOUND"))
				.andExpect(jsonPath("$.detail").value("İş bulunamadı."))
				.andReturn();
		assertNoInternalDetail(result);

		assertMoveUnchanged(before, "MOVE34-999", key, "TO_DO", "TO_DO");
	}

	@Test
	void anonymousMoveReturnsUnauthenticated() throws Exception {
		MvcResult csrf = mockMvc.perform(get("/api/private-probe")).andReturn();
		Cookie csrfBody = csrf.getResponse().getCookie("XSRF-TOKEN");
		Cookie anonSession = csrf.getResponse().getCookie("SESSION");

		mockMvc.perform(patch("/api/issues/MOVE35-1/move").cookie(csrfBody)
				.contentType(MediaType.APPLICATION_JSON)
				.header("X-XSRF-TOKEN", csrfBody.getValue())
				.content("""
						{"targetStatusCode":"IN_PROGRESS","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":0}
						"""))
				.andExpect(status().isUnauthorized())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("UNAUTHENTICATED"))
				.andExpect(jsonPath("$.detail").value("Oturum açmanız gerekiyor."));
	}

	@Test
	void missingCsrfMoveReturnsInvalidCsrfTokenWithNoWrites() throws Exception {
		LoginSession admin = login("move-csrf-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MOVE36", "Csrf move");
		String issueKey = createIssue(admin, key, "STORY", "Csrf move", "desc", null);

		LoginSession member = login("move-csrf-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		MoveSnapshot before = moveSnapshot(issueKey, key, "TO_DO", "TO_DO");

		mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"targetStatusCode":"IN_PROGRESS","beforeIssueKey":null,
						 "afterIssueKey":null,"expectedVersion":0}
						"""))
				.andExpect(status().isForbidden())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_CSRF_TOKEN"))
				.andExpect(jsonPath("$.detail").value("CSRF doğrulaması başarısız."));

		// A CSRF rejection must not change the issue row, the ordered activity rows,
		// the active issue rows in the affected statuses, or the project counter.
		assertMoveUnchanged(before, issueKey, key, "TO_DO", "TO_DO");
	}

	// ------------------------------------------------------------------
	// GET /api/projects/{projectKey}/issues
	// ------------------------------------------------------------------

	@Test
	void eachReadableRoleCanListIssues() throws Exception {
		LoginSession admin = login("list-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIST01", "List roles");
		createIssue(admin, key, "STORY", "Admin issue", null, null);

		listAndExpectOk(admin, key);

		LoginSession lead = login("list-lead@example.com", UserRole.USER);
		addMember(key, lead.userId(), "PROJECT_LEAD");
		listAndExpectOk(lead, key);

		LoginSession member = login("list-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");
		listAndExpectOk(member, key);

		LoginSession viewer = login("list-viewer@example.com", UserRole.USER);
		addMember(key, viewer.userId(), "VIEWER");
		listAndExpectOk(viewer, key);
	}

	@Test
	void nonmemberAndUnknownProjectListReturn404ProjectNotFound() throws Exception {
		LoginSession admin = login("list-privacy-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIST02", "Privacy");
		createIssue(admin, key, "STORY", "Hidden", null, null);

		// A nonmember of the project cannot list; the project is hidden.
		LoginSession outsider = login("list-privacy-outsider@example.com", UserRole.USER);
		mockMvc.perform(get("/api/projects/{key}/issues", key).cookie(outsider.session(), outsider.csrfCookie()))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("PROJECT_NOT_FOUND"))
				.andExpect(jsonPath("$.detail").value("Proje bulunamadı."));

		// An unknown project key is not found even for a member of another project.
		LoginSession member = login("list-privacy-member@example.com", UserRole.USER);
		String otherKey = createProject(admin, "LIST03", "Other");
		addMember(otherKey, member.userId(), "MEMBER");
		mockMvc.perform(get("/api/projects/{key}/issues", "UNKNOWN").cookie(member.session(), member.csrfCookie()))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("PROJECT_NOT_FOUND"))
				.andExpect(jsonPath("$.detail").value("Proje bulunamadı."));
	}

	@Test
	void anonymousListReturns401() throws Exception {
		mockMvc.perform(get("/api/projects/ANY/issues"))
				.andExpect(status().isUnauthorized())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("UNAUTHENTICATED"))
				.andExpect(jsonPath("$.detail").value("Oturum açmanız gerekiyor."));
	}

	@Test
	void emptyProjectListReturnsEmptyPage() throws Exception {
		LoginSession admin = login("list-empty-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIST04", "Empty");

		MvcResult result = mockMvc.perform(get("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isOk())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andExpect(header().string("Cache-Control", containsString("no-store")))
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("items").isArray()).isTrue();
		assertThat(body.get("items").size()).isZero();
		assertThat(body.get("page").asInt()).isEqualTo(0);
		assertThat(body.get("size").asInt()).isEqualTo(20);
		assertThat(body.get("totalItems").asLong()).isEqualTo(0L);
		assertThat(body.get("totalPages").asInt()).isEqualTo(0);
	}

	@Test
	void listIncludesActiveAndExcludesArchived() throws Exception {
		LoginSession admin = login("list-active-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIST05", "Active");
		String active = createIssue(admin, key, "STORY", "Active", null, null);
		String archived = createIssue(admin, key, "TASK", "Archived", null, null);
		jdbcTemplate.update("UPDATE issue SET archived = TRUE, version = version + 1"
				+ " WHERE human_key = ?", archived);

		MvcResult result = mockMvc.perform(get("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("items").size()).isEqualTo(1);
		assertThat(body.get("items").get(0).get("issueKey").asText()).isEqualTo(active);
		assertThat(body.get("items").get(0).get("archived").asBoolean()).isFalse();
		assertThat(body.get("totalItems").asLong()).isEqualTo(1L);
	}

	@Test
	void listPageAndItemsHaveExactSafeFieldSets() throws Exception {
		LoginSession admin = login("list-safe-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIST06", "Safe");
		createIssue(admin, key, "STORY", "Safe issue", null, null);

		MvcResult result = mockMvc.perform(get("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.isObject()).isTrue();
		assertThat(body.size()).isEqualTo(5);
		assertThat(body.propertyNames())
				.containsExactlyInAnyOrder("items", "page", "size", "totalItems", "totalPages");
		assertThat(body.get("items").size()).isEqualTo(1);
		assertSafeIssueDto(body.get("items").get(0));
		assertThat(body.get("items").get(0).has("workflowStatus")).isFalse();
		assertThat(body.get("items").get(0).has("project")).isFalse();
	}

	@Test
	void listUsesDefaultPageSizeAndSort() throws Exception {
		LoginSession admin = login("list-default-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIST07", "Defaults");
		String one = createIssue(admin, key, "STORY", "One", null, null);
		String two = createIssue(admin, key, "TASK", "Two", null, null);
		String three = createIssue(admin, key, "BUG", "Three", null, null);

		MvcResult result = mockMvc.perform(get("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("page").asInt()).isEqualTo(0);
		assertThat(body.get("size").asInt()).isEqualTo(20);
		assertThat(body.get("items").size()).isEqualTo(3);
		assertThat(body.get("items").get(0).get("issueKey").asText()).isEqualTo(one);
		assertThat(body.get("items").get(1).get("issueKey").asText()).isEqualTo(two);
		assertThat(body.get("items").get(2).get("issueKey").asText()).isEqualTo(three);
	}

	@Test
	void pageZeroAndMaxPageAccepted() throws Exception {
		LoginSession admin = login("list-pagerange-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIST08", "Page range");
		createIssue(admin, key, "STORY", "Only", null, null);

		mockMvc.perform(get("/api/projects/{key}/issues?page=0", key).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isOk());
		mockMvc.perform(get("/api/projects/{key}/issues?page=10000", key).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isOk());
	}

	@Test
	void pageOutOfRangeReturnsValidationFailed() throws Exception {
		LoginSession admin = login("list-pagebad-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIST09", "Bad page");
		createIssue(admin, key, "STORY", "Only", null, null);

		for (String page : List.of("-1", "10001")) {
			mockMvc.perform(get("/api/projects/{key}/issues?page=" + page, key).cookie(admin.session(), admin.csrfCookie()))
					.andExpect(status().isBadRequest())
					.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
					.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
					.andExpect(jsonPath("$.detail")
							.value("İstek doğrulama kurallarını karşılamıyor."));
		}
	}

	@Test
	void sizeOneAndMaxAccepted() throws Exception {
		LoginSession admin = login("list-sizeok-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIST10", "Size ok");
		createIssue(admin, key, "STORY", "A", null, null);
		createIssue(admin, key, "TASK", "B", null, null);

		mockMvc.perform(get("/api/projects/{key}/issues?size=1", key).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isOk());
		mockMvc.perform(get("/api/projects/{key}/issues?size=100", key).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isOk());
	}

	@Test
	void sizeOutOfRangeReturnsValidationFailed() throws Exception {
		LoginSession admin = login("list-sizebad-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIST11", "Bad size");
		createIssue(admin, key, "STORY", "Only", null, null);

		for (String size : List.of("0", "101")) {
			mockMvc.perform(get("/api/projects/{key}/issues?size=" + size, key).cookie(admin.session(), admin.csrfCookie()))
					.andExpect(status().isBadRequest())
					.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
					.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
					.andExpect(jsonPath("$.detail")
							.value("İstek doğrulama kurallarını karşılamıyor."));
		}
	}

	@Test
	void allAllowedSortFieldsWorkInBothDirections() throws Exception {
		LoginSession admin = login("list-sortfields-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIST12", "Sort fields");
		String a = createIssue(admin, key, "STORY", "zebra", null, null);
		String b = createIssue(admin, key, "TASK", "apple", null, null);
		String c = createIssue(admin, key, "BUG", "mango", null, null);

		// Control createdAt/updatedAt so each is distinct and deterministic.
		jdbcTemplate.update("UPDATE issue SET created_at = now() - interval '1 hour',"
				+ " updated_at = now() - interval '30 minute' WHERE human_key = ?", a);
		jdbcTemplate.update("UPDATE issue SET created_at = now() - interval '2 hour',"
				+ " updated_at = now() - interval '40 minute' WHERE human_key = ?", b);
		jdbcTemplate.update("UPDATE issue SET created_at = now() - interval '3 hour',"
				+ " updated_at = now() - interval '50 minute' WHERE human_key = ?", c);

		assertListOrder(key, admin, "title,asc", List.of(b, c, a));
		assertListOrder(key, admin, "title,desc", List.of(a, c, b));
		assertListOrder(key, admin, "number,asc", List.of(a, b, c));
		assertListOrder(key, admin, "number,desc", List.of(c, b, a));
		assertListOrder(key, admin, "createdAt,asc", List.of(c, b, a));
		assertListOrder(key, admin, "createdAt,desc", List.of(a, b, c));
		assertListOrder(key, admin, "updatedAt,asc", List.of(c, b, a));
		assertListOrder(key, admin, "updatedAt,desc", List.of(a, b, c));
	}

	@Test
	void numberIsDeterministicTieBreaker() throws Exception {
		LoginSession admin = login("list-tie-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIST13", "Tie break");
		String a = createIssue(admin, key, "STORY", "Same", null, null);
		String b = createIssue(admin, key, "TASK", "Other", null, null);
		String c = createIssue(admin, key, "BUG", "Same", null, null);

		// title asc: Other, then the two "Same" ties ordered by number ASC (a, c).
		assertListOrder(key, admin, "title,asc", List.of(b, a, c));
	}

	@Test
	void malformedUnknownOrRepeatedSortReturnsValidationFailed() throws Exception {
		LoginSession admin = login("list-sortbad-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIST14", "Bad sort");
		createIssue(admin, key, "STORY", "Only", null, null);

		// Unknown field.
		mockMvc.perform(get("/api/projects/{key}/issues?sort=rank,asc", key).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
		// Unknown direction.
		mockMvc.perform(get("/api/projects/{key}/issues?sort=number,up", key).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
		// Single segment (missing direction).
		mockMvc.perform(get("/api/projects/{key}/issues?sort=number", key).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
		// Extra segment.
		mockMvc.perform(get("/api/projects/{key}/issues?sort=number,asc,extra", key).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
		// Repeated sort parameter.
		mockMvc.perform(get("/api/projects/{key}/issues?sort=number,asc&sort=title,desc", key).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
	}

	@Test
	void leadingMinusSortReturnsValidationFailed() throws Exception {
		LoginSession admin = login("list-minus-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIST15", "Minus sort");
		createIssue(admin, key, "STORY", "Only", null, null);

		mockMvc.perform(get("/api/projects/{key}/issues?sort=-number,asc", key).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
		mockMvc.perform(get("/api/projects/{key}/issues?sort=number,-asc", key).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
	}

	@Test
	void listPagesSliceCorrectly() throws Exception {
		LoginSession admin = login("list-slice-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIST16", "Slices");
		List<String> keys = new java.util.ArrayList<>();
		for (int i = 1; i <= 5; i++) {
			keys.add(createIssue(admin, key, "STORY", "Issue " + i, null, null));
		}

		assertPageKeys(key, admin, 0, 2, List.of(keys.get(0), keys.get(1)));
		assertPageKeys(key, admin, 1, 2, List.of(keys.get(2), keys.get(3)));
		assertPageKeys(key, admin, 2, 2, List.of(keys.get(4)));
		assertPageKeys(key, admin, 3, 2, List.of());
	}

	@Test
	void listReportsExactTotals() throws Exception {
		LoginSession admin = login("list-totals-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIST17", "Totals");
		for (int i = 1; i <= 25; i++) {
			createIssue(admin, key, "STORY", "Issue " + i, null, null);
		}

		// 25 active items at size 10 -> 3 pages (10, 10, 5); page 1 has 10 items.
		MvcResult result = mockMvc.perform(get("/api/projects/{key}/issues?page=1&size=10", key).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("totalItems").asLong()).isEqualTo(25L);
		assertThat(body.get("totalPages").asInt()).isEqualTo(3);
		assertThat(body.get("items").size()).isEqualTo(10);
	}

	@Test
	void listDoesNotIncludeRowsFromOtherProjects() throws Exception {
		LoginSession admin = login("list-cross-admin@example.com", UserRole.ORG_ADMIN);
		String keyA = createProject(admin, "LIST18", "Project A");
		String keyB = createProject(admin, "LIST19", "Project B");
		createIssue(admin, keyA, "STORY", "A1", null, null);
		createIssue(admin, keyA, "TASK", "A2", null, null);
		String b1 = createIssue(admin, keyB, "BUG", "B1", null, null);

		MvcResult result = mockMvc.perform(get("/api/projects/{key}/issues", keyB).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("items").size()).isEqualTo(1);
		assertThat(body.get("items").get(0).get("issueKey").asText()).isEqualTo(b1);
		assertThat(body.get("totalItems").asLong()).isEqualTo(1L);
	}

	@Test
	void hostileTitleAndDescriptionRenderOnlyAsJsonTextWithNoExtraFields() throws Exception {
		LoginSession admin = login("list-hostile-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIST20", "Hostile list");
		Map<String, Object> payload = new java.util.LinkedHashMap<>();
		payload.put("type", "STORY");
		payload.put("title", "Hostile \"title\"");
		payload.put("description", "{\"secret\":\"leak\"}");
		payload.put("assigneeId", null);
		mockMvc.perform(post("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content(objectMapper.writeValueAsString(payload)))
				.andExpect(status().isCreated());

		MvcResult result = mockMvc.perform(get("/api/projects/{key}/issues", key).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isOk())
				.andReturn();
		String raw = result.getResponse().getContentAsString();
		JsonNode page = objectMapper.readTree(raw);
		assertThat(page.size()).isEqualTo(5);
		assertThat(page.propertyNames())
				.containsExactlyInAnyOrder("items", "page", "size", "totalItems", "totalPages");
		assertThat(page.has("secret")).isFalse();
		assertThat(page.has("admin")).isFalse();
		JsonNode item = page.get("items").get(0);
		assertThat(item.get("title").isTextual()).isTrue();
		assertThat(item.get("title").asText()).isEqualTo("Hostile \"title\"");
		assertThat(item.get("description").isTextual()).isTrue();
		assertThat(item.get("description").asText()).isEqualTo("{\"secret\":\"leak\"}");
		assertThat(item.has("secret")).isFalse();
		assertThat(item.has("token")).isFalse();
	}

	@Test
	void listPerformsNoIssueActivityOrCounterMutation() throws Exception {
		LoginSession admin = login("list-nomut-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "LIST21", "No mutation");
		String a = createIssue(admin, key, "STORY", "A", null, null);
		String b = createIssue(admin, key, "TASK", "B", null, null);
		Map<String, Object> aBefore = issueSnapshot(a);
		Map<String, Object> bBefore = issueSnapshot(b);
		List<Map<String, Object>> activitiesBefore = activityRows(key);
		Long counterBefore = counterNextNumber(key);

		mockMvc.perform(get("/api/projects/{key}/issues?page=0&size=20&sort=number,asc", key).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isOk());

		assertThat(issueSnapshot(a)).isEqualTo(aBefore);
		assertThat(issueSnapshot(b)).isEqualTo(bBefore);
		assertThat(activityRows(key)).isEqualTo(activitiesBefore);
		assertThat(counterNextNumber(key)).isEqualTo(counterBefore);
	}

	// ------------------------------------------------------------------
	// Helpers
	// ------------------------------------------------------------------

	/**
	 * Returns the current persisted {@code version} of an issue.
	 */
	private long issueVersion(String issueKey) {
		return jdbcTemplate.queryForObject(
				"SELECT version FROM issue WHERE human_key = ?", Long.class, issueKey);
	}

	/**
	 * Fixture-only helper that moves an issue into the given workflow status and
	 * sets its rank directly in the DB. Used to set up destination columns before
	 * exercising the move endpoint. Does not touch version or updated_at so the
	 * move endpoint's own versioning can be asserted independently.
	 */
	private void setIssueStatusAndRank(String issueKey, String statusCode, long rank) {
		jdbcTemplate.update(
				"UPDATE issue SET workflow_status_id ="
						+ " (SELECT ws.id FROM workflow_status ws"
						+ "  JOIN project p ON p.id = ws.project_id"
						+ "  JOIN issue i ON i.project_id = p.id"
						+ "  WHERE i.human_key = ? AND ws.code = ?), rank = ?"
						+ " WHERE human_key = ?",
				issueKey, statusCode, rank, issueKey);
	}

	/**
	 * Asserts the active (non-archived) issues in the given status are ordered
	 * exactly as {@code expectedKeys} by ascending rank.
	 */
	private void assertActiveOrder(String projectKey, String statusCode,
			List<String> expectedKeys) {
		List<String> actual = jdbcTemplate.queryForList(
				"SELECT i.human_key FROM issue i"
						+ " JOIN workflow_status ws ON ws.id = i.workflow_status_id"
						+ " JOIN project p ON p.id = i.project_id"
						+ " WHERE p.key = ? AND ws.code = ? AND i.archived = FALSE"
						+ " ORDER BY i.rank",
				String.class, projectKey, statusCode);
		assertThat(actual).containsExactlyElementsOf(expectedKeys);
	}

	/**
	 * Captures the rank, version and updated_at of every active issue in the given
	 * status, keyed by issue key. Used to assert neighbor versioning behavior
	 * before/after a move.
	 */
	private Map<String, IssueState> statusState(String projectKey, String statusCode) {
		List<Map<String, Object>> rows = jdbcTemplate.queryForList(
				"SELECT i.human_key, i.rank, i.version, i.updated_at FROM issue i"
						+ " JOIN workflow_status ws ON ws.id = i.workflow_status_id"
						+ " JOIN project p ON p.id = i.project_id"
						+ " WHERE p.key = ? AND ws.code = ? AND i.archived = FALSE"
						+ " ORDER BY i.rank",
				projectKey, statusCode);
		Map<String, IssueState> result = new java.util.HashMap<>();
		for (Map<String, Object> row : rows) {
			result.put((String) row.get("human_key"),
					new IssueState((Long) row.get("rank"), (Long) row.get("version"),
							(java.sql.Timestamp) row.get("updated_at")));
		}
		return result;
	}

	/**
	 * Asserts the neighbor versioning contract for a successful move against the
	 * before/after snapshots of every destination issue:
	 * <ul>
	 *   <li>the moving issue increments exactly once;</li>
	 *   <li>every other issue whose rank actually changed increments once;</li>
	 *   <li>an issue whose rank remains identical keeps its version;</li>
	 *   <li>updated_at changes only for rows whose persisted rank changed.</li>
	 * </ul>
	 * This prevents native/bulk rank updates that bypass {@code @Version} from
	 * passing unnoticed.
	 */
	private void assertMoveVersioning(Map<String, IssueState> before,
			Map<String, IssueState> after, long movingVersionBefore, long movingVersionAfter) {
		// Moving issue increments once.
		assertThat(movingVersionAfter).isEqualTo(movingVersionBefore + 1);
		// Every destination issue whose rank changed increments once; unchanged keeps
		// its version.
		for (String key : before.keySet()) {
			IssueState b = before.get(key);
			IssueState a = after.get(key);
			if (a == null) {
				continue;
			}
			if (b.rank() != a.rank()) {
				assertThat(a.version()).as("version of %s whose rank changed", key)
						.isEqualTo(b.version() + 1);
			}
			else {
				assertThat(a.version()).as("version of %s whose rank is unchanged", key)
						.isEqualTo(b.version());
			}
		}
		// updatedAt changes only for rows whose persisted rank changed.
		for (String key : before.keySet()) {
			IssueState b = before.get(key);
			IssueState a = after.get(key);
			if (a == null) {
				continue;
			}
			if (b.rank() != a.rank()) {
				assertThat(a.updatedAt()).as("updatedAt of %s whose rank changed", key)
						.isNotEqualTo(b.updatedAt());
			}
			else {
				assertThat(a.updatedAt()).as("updatedAt of %s whose rank is unchanged", key)
						.isEqualTo(b.updatedAt());
			}
		}
	}

	/**
	 * Captures the complete pre-request move state: the full moving issue row,
	 * the ordered activity rows, the project counter, and every active issue row
	 * in the affected source/destination statuses (workflow_status_id, rank,
	 * updated_at, version). Used to prove a rejected or no-op move performed no
	 * writes at all.
	 */
	private MoveSnapshot moveSnapshot(String issueKey, String projectKey,
			String sourceStatusCode, String targetStatusCode) {
		List<Map<String, Object>> issueRows = jdbcTemplate.queryForList(
				"SELECT project_id, reporter_id, workflow_status_id, rank, number, human_key,"
						+ " type, title, description, assignee_id, archived, created_at,"
						+ " updated_at, version"
						+ " FROM issue WHERE human_key = ?",
				issueKey);
		Map<String, Object> issueRow = issueRows.isEmpty() ? null : issueRows.get(0);
		List<Map<String, Object>> activities = jdbcTemplate.queryForList(
				"SELECT ia.id, ia.actor_id, ia.type, ia.summary, ia.created_at"
						+ " FROM issue_activity ia JOIN issue i ON i.id = ia.issue_id"
						+ " WHERE i.human_key = ? ORDER BY ia.created_at, ia.id",
				issueKey);
		Long counterNextNumber = counterNextNumber(projectKey);
		List<Map<String, Object>> activeIssueRows = jdbcTemplate.queryForList(
				"SELECT i.human_key, i.workflow_status_id, i.rank, i.updated_at, i.version"
						+ " FROM issue i"
						+ " JOIN workflow_status ws ON ws.id = i.workflow_status_id"
						+ " JOIN project p ON p.id = i.project_id"
						+ " WHERE p.key = ? AND ws.code IN (?, ?) AND i.archived = FALSE"
						+ " ORDER BY i.rank, i.human_key",
				projectKey, sourceStatusCode, targetStatusCode);
		return new MoveSnapshot(issueRow, activities, counterNextNumber, activeIssueRows);
	}

	/**
	 * Asserts a rejected or no-op move left the complete move state unchanged:
	 * the moving issue row, the ordered activity rows, the project counter, and
	 * every active issue row in the affected source/destination statuses.
	 */
	private void assertMoveUnchanged(MoveSnapshot before, String issueKey, String projectKey,
			String sourceStatusCode, String targetStatusCode) {
		MoveSnapshot after = moveSnapshot(issueKey, projectKey, sourceStatusCode,
				targetStatusCode);
		assertThat(after.issueRow()).isEqualTo(before.issueRow());
		assertThat(after.activities()).isEqualTo(before.activities());
		assertThat(after.counterNextNumber()).isEqualTo(before.counterNextNumber());
		assertThat(after.activeIssueRows()).isEqualTo(before.activeIssueRows());
	}

	/**
	 * Asserts a {@code GET /api/projects/{key}/issues} request returns 200 with
	 * a JSON body and {@code Cache-Control: no-store}. Used to verify every
	 * readable role may list.
	 */
	private void listAndExpectOk(LoginSession session, String projectKey) throws Exception {
		mockMvc.perform(get("/api/projects/{key}/issues", projectKey).cookie(session.session(), session.csrfCookie()))
				.andExpect(status().isOk())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andExpect(header().string("Cache-Control", containsString("no-store")));
	}

	/**
	 * Asserts the active-issue keys returned by the list endpoint for the given
	 * sort are exactly {@code expectedKeys} in order.
	 */
	private void assertListOrder(String projectKey, LoginSession session, String sort,
			List<String> expectedKeys) throws Exception {
		MvcResult result = mockMvc.perform(
				get("/api/projects/" + projectKey + "/issues?sort=" + sort).cookie(session.session(), session.csrfCookie()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("items").size()).isEqualTo(expectedKeys.size());
		for (int i = 0; i < expectedKeys.size(); i++) {
			assertThat(body.get("items").get(i).get("issueKey").asText())
					.isEqualTo(expectedKeys.get(i));
		}
	}

	/**
	 * Asserts the active-issue keys on a specific page/size slice are exactly
	 * {@code expectedKeys} in order, and that page/size are echoed back.
	 */
	private void assertPageKeys(String projectKey, LoginSession session, int page, int size,
			List<String> expectedKeys) throws Exception {
		MvcResult result = mockMvc.perform(
				get("/api/projects/" + projectKey + "/issues?page=" + page + "&size=" + size).cookie(session.session(), session.csrfCookie()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("page").asInt()).isEqualTo(page);
		assertThat(body.get("size").asInt()).isEqualTo(size);
		assertThat(body.get("items").size()).isEqualTo(expectedKeys.size());
		for (int i = 0; i < expectedKeys.size(); i++) {
			assertThat(body.get("items").get(i).get("issueKey").asText())
					.isEqualTo(expectedKeys.get(i));
		}
	}

	/**
	 * Returns the ordered activity rows (id, actor, type, summary, created_at)
	 * of every issue in a project, used to prove a read-only request performed no
	 * activity mutation.
	 */
	private List<Map<String, Object>> activityRows(String projectKey) {
		return jdbcTemplate.queryForList(
				"SELECT ia.id, ia.actor_id, ia.type, ia.summary, ia.created_at"
						+ " FROM issue_activity ia JOIN issue i ON i.id = ia.issue_id"
						+ " JOIN project p ON p.id = i.project_id"
						+ " WHERE p.key = ? ORDER BY ia.created_at, ia.id",
				projectKey);
	}

	private void assertNoIssueOrActivityOrCounter(String projectKey) {
		Integer issueCount = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM issue i JOIN project p ON p.id = i.project_id"
						+ " WHERE p.key = ?",
				Integer.class, projectKey);
		assertThat(issueCount).isZero();

		Integer activityCount = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM issue_activity ia"
						+ " JOIN issue i ON i.id = ia.issue_id"
						+ " JOIN project p ON p.id = i.project_id"
						+ " WHERE p.key = ?",
				Integer.class, projectKey);
		assertThat(activityCount).isZero();

		Integer counterCount = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM project_issue_counter pc"
						+ " JOIN project p ON p.id = pc.project_id"
						+ " WHERE p.key = ?",
				Integer.class, projectKey);
		assertThat(counterCount).isZero();
	}

	private void assertNoInternalDetail(MvcResult result) throws Exception {
		// Case-insensitive so a leaked internal token cannot hide behind casing.
		String raw = result.getResponse().getContentAsString().toLowerCase();
		assertThat(raw).doesNotContain("exception", "stacktrace", "trace", "sql",
				"constraint", "duplicate", "password", "token", "cookie", "session");
	}

	/**
		* Asserts the exact safe issue DTO contract: the precise allowed top-level
		* field set, with the required reporterId/assigneeId/statusCode present and
		* no nested JPA entities or sensitive identity fields.
		*/
	private void assertSafeIssueDto(JsonNode body) {
		assertThat(body.isObject()).isTrue();
		assertThat(body.size()).isEqualTo(15);
		assertThat(body.propertyNames())
				.containsExactlyInAnyOrder(
						"id", "issueKey", "projectKey", "number", "type", "title",
						"description", "statusCode", "reporterId", "assigneeId", "rank",
						"archived", "version", "createdAt", "updatedAt");
		// Required safe fields must be present.
		assertThat(body.has("reporterId")).isTrue();
		assertThat(body.has("assigneeId")).isTrue();
		assertThat(body.has("statusCode")).isTrue();
		// No nested JPA entities or sensitive identity fields.
		assertThat(body.has("projectId")).isFalse();
		assertThat(body.has("workflowStatusId")).isFalse();
		assertThat(body.has("passwordHash")).isFalse();
		assertThat(body.has("userAccount")).isFalse();
		assertThat(body.has("reporter")).isFalse();
		assertThat(body.has("assignee")).isFalse();
		assertThat(body.has("actorId")).isFalse();
		assertThat(body.has("email")).isFalse();
		assertThat(body.has("firstName")).isFalse();
		assertThat(body.has("lastName")).isFalse();
		assertThat(body.has("organizationRole")).isFalse();
		assertThat(body.has("status")).isFalse();
	}

	/**
		* Returns the current {@code project_issue_counter.next_number} for a project.
		*/
	private Long counterNextNumber(String projectKey) {
		return jdbcTemplate.queryForObject(
				"SELECT next_number FROM project_issue_counter"
						+ " WHERE project_id = (SELECT id FROM project WHERE key = ?)",
				Long.class, projectKey);
	}

	/**
		* Asserts the project counter is unchanged after a lifecycle mutation.
		* PATCH/archive must never allocate issue numbers.
		*/
	private void assertCounterUnchanged(Long before, String projectKey) {
		Long after = counterNextNumber(projectKey);
		assertThat(after).isEqualTo(before);
	}

	/**
		* Captures the complete pre-request lifecycle state for an issue: the full
		* persisted issue row (including immutable derived fields and updated_at),
		* the complete ordered activity rows (id, actor_id, type, summary,
		* created_at), and the project counter's next_number. Used to prove a
		* rejected or no-op request performed no writes at all.
		*
		* <p>The issue row is {@code null} when the issue key does not exist (e.g.
		* an unknown-issue rejection), in which case the activity list is empty.</p>
		*/
	private LifecycleSnapshot lifecycleSnapshot(String issueKey, String projectKey) {
		List<Map<String, Object>> issueRows = jdbcTemplate.queryForList(
				"SELECT project_id, reporter_id, workflow_status_id, rank, number, human_key,"
						+ " type, title, description, assignee_id, archived, created_at,"
						+ " updated_at, version"
						+ " FROM issue WHERE human_key = ?",
				issueKey);
		Map<String, Object> issueRow = issueRows.isEmpty() ? null : issueRows.get(0);
		List<Map<String, Object>> activities = jdbcTemplate.queryForList(
				"SELECT ia.id, ia.actor_id, ia.type, ia.summary, ia.created_at"
						+ " FROM issue_activity ia JOIN issue i ON i.id = ia.issue_id"
						+ " WHERE i.human_key = ? ORDER BY ia.created_at, ia.id",
				issueKey);
		Long counterNextNumber = counterNextNumber(projectKey);
		return new LifecycleSnapshot(issueRow, activities, counterNextNumber);
	}

	/**
		* Asserts a rejected or no-op request left the complete lifecycle state
		* unchanged: the full issue row, the ordered activity rows/content, and the
		* project counter. No version or activity count is hard-coded; the actual
		* before snapshot is compared to the after snapshot.
		*/
	private void assertLifecycleUnchanged(LifecycleSnapshot before, String issueKey,
			String projectKey) {
		LifecycleSnapshot after = lifecycleSnapshot(issueKey, projectKey);
		assertThat(after.issueRow()).isEqualTo(before.issueRow());
		assertThat(after.activities()).isEqualTo(before.activities());
		assertThat(after.counterNextNumber()).isEqualTo(before.counterNextNumber());
	}

	/**
		* Snapshots the full persisted issue row (including immutable derived fields)
		* so a lifecycle mutation can be proven to change only the intended columns.
		*/
	private Map<String, Object> issueSnapshot(String issueKey) {
		return jdbcTemplate.queryForMap(
				"SELECT project_id, reporter_id, workflow_status_id, rank, number, human_key,"
						+ " type, title, description, assignee_id, archived, created_at,"
						+ " updated_at, version"
						+ " FROM issue WHERE human_key = ?",
				issueKey);
	}

	/**
		* Asserts the issue's workflow_status_id still references the project's TO_DO
		* workflow status row.
		*/
	private void assertWorkflowStatusIsProjectTodo(String issueKey) {
		Integer count = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM issue i"
						+ " JOIN workflow_status ws ON ws.id = i.workflow_status_id"
						+ " JOIN project p ON p.id = i.project_id"
						+ " WHERE i.human_key = ? AND ws.code = 'TO_DO'",
				Integer.class, issueKey);
		assertThat(count).isEqualTo(1);
	}

	/**
		* Returns the UPDATED activity summary for an issue (the second activity row).
		*/
	private JsonNode updatedSummary(String issueKey) throws Exception {
		List<Map<String, Object>> activities = jdbcTemplate.queryForList(
				"SELECT ia.summary"
						+ " FROM issue_activity ia JOIN issue i ON i.id = ia.issue_id"
						+ " WHERE i.human_key = ? ORDER BY ia.created_at, ia.id",
				issueKey);
		assertThat(activities).hasSize(2);
		assertThat(activities.get(1).get("summary")).isNotNull();
		return objectMapper.readTree(String.valueOf(activities.get(1).get("summary")));
	}

	private void cleanupAllRows() {
		// Child-to-parent order so later test classes cannot inherit synthetic
		// fixture rows. Guard each delete on table existence so the RED phase
		// (V4 absent) does not fail on the fixture itself.
		if (tableExists("issue_activity")) {
			jdbcTemplate.update("DELETE FROM issue_activity");
		}
		if (tableExists("issue")) {
			jdbcTemplate.update("DELETE FROM issue");
		}
		if (tableExists("project_issue_counter")) {
			jdbcTemplate.update("DELETE FROM project_issue_counter");
		}
		if (tableExists("workflow_status")) {
			jdbcTemplate.update("DELETE FROM workflow_status");
		}
		if (tableExists("project_member")) {
			jdbcTemplate.update("DELETE FROM project_member");
		}
		if (tableExists("project")) {
			jdbcTemplate.update("DELETE FROM project");
		}
		if (tableExists("user_account")) {
			jdbcTemplate.update("DELETE FROM user_account");
		}
	}

	private boolean tableExists(String tableName) {
		Integer count = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM information_schema.tables"
						+ " WHERE table_schema = 'public' AND table_name = ?",
				Integer.class, tableName);
		return count != null && count == 1;
	}

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

	/**
		* Creates an issue via the existing create endpoint and returns its human
		* issue key. The assigneeId may be null.
		*/
	private String createIssue(LoginSession session, String projectKey, String type, String title,
			String description, UUID assigneeId) throws Exception {
		String descJson = description == null ? "null" : "\"" + description + "\"";
		String assigneeJson = assigneeId == null ? "null" : "\"" + assigneeId + "\"";
		MvcResult result = mockMvc.perform(post("/api/projects/{key}/issues", projectKey).cookie(session.session(), session.csrfCookie())
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

	private record LoginSession(UUID userId, Cookie session, Cookie csrfCookie, String csrfHeader, String csrfToken) {}

	/**
		* A complete pre-request lifecycle snapshot used to prove a rejected or no-op
		* request performed no writes. {@code issueRow} is {@code null} when the issue
		* key does not exist.
		*/
	private record LifecycleSnapshot(
			Map<String, Object> issueRow,
			List<Map<String, Object>> activities,
			Long counterNextNumber) {
	}

	/**
	 * A complete pre-request move snapshot used to prove a rejected or no-op move
	 * performed no writes. In addition to the moving issue row, the ordered
	 * activity rows and the project counter, it captures every active issue row in
	 * the affected source/destination statuses (workflow_status_id, rank,
	 * updated_at, version). {@code issueRow} is {@code null} when the issue key
	 * does not exist.
	 */
	private record MoveSnapshot(
			Map<String, Object> issueRow,
			List<Map<String, Object>> activities,
			Long counterNextNumber,
			List<Map<String, Object>> activeIssueRows) {
	}

	/**
	 * The persisted rank, version and updated_at of an active issue in a status,
	 * used to assert neighbor versioning behavior before/after a move.
	 */
	private record IssueState(long rank, long version, java.sql.Timestamp updatedAt) {
	}

}
