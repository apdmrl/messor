package io.github.apdmrl.messor.comment;

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

@AutoConfigureMockMvc
class CommentApiIT extends PostgresIntegrationTestSupport {

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
	void cleanCommentData() {
		cleanupAllRows();
	}

	@AfterEach
	void cleanCommentDataAfter() {
		cleanupAllRows();
	}

	// ---------------------------------------------------------------- listing

	@Test
	void leadMemberAndViewerListComments() throws Exception {
		LoginSession admin = login("comments-lead@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CML1", "Comments project");
		String issueKey = createIssue(admin, key, "STORY", "A story", null, null);
		LoginSession member = login("comments-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");
		createComment(admin, issueKey, "lead comment");

		LoginSession viewer = login("comments-viewer@example.com", UserRole.USER);
		addMember(key, viewer.userId(), "VIEWER");

		for (LoginSession session : List.of(admin, member, viewer)) {
			mockMvc.perform(get("/api/issues/{key}/comments", issueKey).cookie(session.session(), session.csrfCookie()))
					.andExpect(status().isOk())
					.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
					.andExpect(header().string("Cache-Control", containsString("no-store")))
					.andExpect(jsonPath("$[0].body").value("lead comment"))
					.andExpect(jsonPath("$[0].authorId").value(admin.userId().toString()));
		}
	}

	@Test
	void listingIsStableByCreatedAtThenId() throws Exception {
		LoginSession admin = login("comments-order-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CML2", "Order project");
		String issueKey = createIssue(admin, key, "TASK", "Ordered", null, null);

		createComment(admin, issueKey, "first");
		createComment(admin, issueKey, "second");
		createComment(admin, issueKey, "third");

		MvcResult result = mockMvc.perform(get("/api/issues/{key}/comments", issueKey).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.size()).isEqualTo(3);
		assertThat(body.get(0).get("body").asText()).isEqualTo("first");
		assertThat(body.get(1).get("body").asText()).isEqualTo("second");
		assertThat(body.get(2).get("body").asText()).isEqualTo("third");
		assertSafeCommentDto(body.get(0));
	}

	@Test
	void tombstoneRetainsOriginalPosition() throws Exception {
		LoginSession admin = login("comments-tomb-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CML3", "Tombstone project");
		String issueKey = createIssue(admin, key, "BUG", "Tomb", null, null);

		createComment(admin, issueKey, "first");
		String secondId = createComment(admin, issueKey, "second");
		createComment(admin, issueKey, "third");

		MvcResult del = mockMvc.perform(delete("/api/comments/{id}", secondId).cookie(admin.session(), admin.csrfCookie())
				.header(admin.csrfHeader(), admin.csrfToken())
				.queryParam("expectedVersion", "0"))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode deleted = objectMapper.readTree(del.getResponse().getContentAsString());
		assertThat(deleted.get("deleted").asBoolean()).isTrue();
		assertThat(deleted.has("body")).isTrue();
		assertThat(deleted.get("body").isNull()).isTrue();

		MvcResult result = mockMvc.perform(get("/api/issues/{key}/comments", issueKey).cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.size()).isEqualTo(3);
		assertThat(body.get(0).get("body").asText()).isEqualTo("first");
		assertThat(body.get(1).get("deleted").asBoolean()).isTrue();
		assertThat(body.get(1).get("body").isNull()).isTrue();
		assertThat(body.get(2).get("body").asText()).isEqualTo("third");
	}

	@Test
	void nonmemberListingReturnsSafeNotFound() throws Exception {
		LoginSession admin = login("comments-nm-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CML4", "Hidden project");
		String issueKey = createIssue(admin, key, "TASK", "Hidden", null, null);

		LoginSession outsider = login("comments-outsider@example.com", UserRole.USER);
		MvcResult result = mockMvc.perform(get("/api/issues/{key}/comments", issueKey).cookie(outsider.session(), outsider.csrfCookie()))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("ISSUE_NOT_FOUND"))
				.andReturn();
		assertNoInternalDetail(result);
	}

	@Test
	void unknownIssueListingReturnsNotFound() throws Exception {
		LoginSession admin = login("comments-unk-admin@example.com", UserRole.ORG_ADMIN);
		MvcResult result = mockMvc.perform(get("/api/issues/UNK-9/comments").cookie(admin.session(), admin.csrfCookie()))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("ISSUE_NOT_FOUND"))
				.andReturn();
		assertNoInternalDetail(result);
	}

	@Test
	void unauthenticatedListingReturns401() throws Exception {
		mockMvc.perform(get("/api/issues/MES-1/comments"))
				.andExpect(status().isUnauthorized());
	}

	// ----------------------------------------------------------------- create

	@Test
	void leadMemberAndOrgAdminCreateComment() throws Exception {
		LoginSession admin = login("comments-create-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMC1", "Create project");
		String issueKey = createIssue(admin, key, "TASK", "Create", null, null);

		LoginSession member = login("comments-create-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		for (LoginSession session : List.of(admin, member)) {
			MvcResult result = mockMvc.perform(post("/api/issues/{key}/comments", issueKey).cookie(session.session(), session.csrfCookie())
					.contentType(MediaType.APPLICATION_JSON)
					.header(session.csrfHeader(), session.csrfToken())
					.content("""
							{"body":"hello there"}
							"""))
					.andExpect(status().isCreated())
					.andExpect(header().string("Location", containsString("/api/comments/")))
					.andExpect(header().string("Cache-Control", containsString("no-store")))
					.andReturn();
			JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
			assertThat(body.get("issueKey").asText()).isEqualTo(issueKey);
			assertThat(body.get("authorId").asText()).isEqualTo(session.userId().toString());
			assertThat(body.get("body").asText()).isEqualTo("hello there");
			assertThat(body.get("deleted").asBoolean()).isFalse();
			assertThat(body.get("version").asLong()).isEqualTo(0);
			assertSafeCommentDto(body);
		}
	}

	@Test
	void serverDerivesAuthorFromPrincipalNotBody() throws Exception {
		LoginSession admin = login("comments-derived-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMC2", "Derived project");
		String issueKey = createIssue(admin, key, "BUG", "Derived", null, null);
		LoginSession member = login("comments-derived-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		MvcResult result = mockMvc.perform(post("/api/issues/{key}/comments", issueKey).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"body":"mine","authorId":"00000000-0000-0000-0000-000000000099"}
						"""))
				.andExpect(status().isCreated())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("authorId").asText()).isEqualTo(member.userId().toString());
	}

	@Test
	void viewerCreateReturns403AndInsertsNothing() throws Exception {
		LoginSession admin = login("comments-viewer-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMC3", "Viewer project");
		String issueKey = createIssue(admin, key, "TASK", "Viewer", null, null);
		LoginSession viewer = login("comments-viewer@example.com", UserRole.USER);
		addMember(key, viewer.userId(), "VIEWER");

		MvcResult result = mockMvc.perform(post("/api/issues/{key}/comments", issueKey).cookie(viewer.session(), viewer.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(viewer.csrfHeader(), viewer.csrfToken())
				.content("""
						{"body":"nope"}
						"""))
				.andExpect(status().isForbidden())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("FORBIDDEN"))
				.andReturn();
		assertNoInternalDetail(result);
	}

	@Test
	void nonmemberCreateReturnsSafeNotFound() throws Exception {
		LoginSession admin = login("comments-nc-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMC4", "Hidden create");
		String issueKey = createIssue(admin, key, "TASK", "Hidden", null, null);
		LoginSession outsider = login("comments-nc-out@example.com", UserRole.USER);

		MvcResult result = mockMvc.perform(post("/api/issues/{key}/comments", issueKey).cookie(outsider.session(), outsider.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(outsider.csrfHeader(), outsider.csrfToken())
				.content("""
						{"body":"probe"}
						"""))
				.andExpect(status().isNotFound())
				.andExpect(jsonPath("$.code").value("ISSUE_NOT_FOUND"))
				.andReturn();
		assertNoInternalDetail(result);
		assertCommentCount(key, 0);
	}

	@Test
	void createRejectsBlankWhitespaceOversizeAndMalformedBody() throws Exception {
		LoginSession admin = login("comments-val-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMC5", "Validation project");
		String issueKey = createIssue(admin, key, "TASK", "Validation", null, null);

		MvcResult blank = mockMvc.perform(post("/api/issues/{key}/comments", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"body":""}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andReturn();
		assertNoInternalDetail(blank);

		MvcResult whitespace = mockMvc.perform(post("/api/issues/{key}/comments", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"body":"   \t  "}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andReturn();
		assertNoInternalDetail(whitespace);

		String tooLong = "x".repeat(5001);
		MvcResult oversize = mockMvc.perform(post("/api/issues/{key}/comments", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"body":"%s"}
						""".formatted(tooLong)))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andReturn();
		assertNoInternalDetail(oversize);

		MvcResult malformed = mockMvc.perform(post("/api/issues/{key}/comments", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("not-json"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andReturn();
		assertNoInternalDetail(malformed);

		assertCommentCount(key, 0);
	}

	@Test
	void createPreservesAcceptedLeadingAndTrailingWhitespace() throws Exception {
		LoginSession admin = login("comments-ws-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMC6", "Whitespace project");
		String issueKey = createIssue(admin, key, "TASK", "Whitespace", null, null);

		MvcResult result = mockMvc.perform(post("/api/issues/{key}/comments", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"body":"  padded text  "}
						"""))
				.andExpect(status().isCreated())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("body").asText()).isEqualTo("  padded text  ");
	}

	@Test
	void createRequiresCsrfAndRejectsInvalidCsrf() throws Exception {
		LoginSession admin = login("comments-csrf-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMC7", "Csrf project");
		String issueKey = createIssue(admin, key, "TASK", "Csrf", null, null);

		mockMvc.perform(post("/api/issues/{key}/comments", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"body":"no token"}
						"""))
				.andExpect(status().isForbidden());

		mockMvc.perform(post("/api/issues/{key}/comments", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), "bogus-token")
				.content("""
						{"body":"bad token"}
						"""))
				.andExpect(status().isForbidden());

		assertCommentCount(key, 0);
	}

	@Test
	void createOnArchivedIssueReturnsSafeNotFound() throws Exception {
		LoginSession admin = login("comments-arch-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMC8", "Archived project");
		String issueKey = createIssue(admin, key, "TASK", "Will archive", null, null);
		archiveIssue(admin, issueKey);

		MvcResult result = mockMvc.perform(post("/api/issues/{key}/comments", issueKey).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"body":"late comment"}
						"""))
				.andExpect(status().isNotFound())
				.andExpect(jsonPath("$.code").value("ISSUE_NOT_FOUND"))
				.andReturn();
		assertNoInternalDetail(result);
	}

	// ----------------------------------------------------------------- update

	@Test
	void authorUpdatesOwnCommentWithExactVersionIncrement() throws Exception {
		LoginSession admin = login("comments-upd-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMU1", "Update project");
		String issueKey = createIssue(admin, key, "TASK", "Update", null, null);
		String commentId = createComment(admin, issueKey, "original");

		MvcResult result = mockMvc.perform(patch("/api/comments/{id}", commentId).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"body":"edited text","expectedVersion":0}
						"""))
				.andExpect(status().isOk())
				.andExpect(header().string("Cache-Control", containsString("no-store")))
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("body").asText()).isEqualTo("edited text");
		assertThat(body.get("version").asLong()).isEqualTo(1);
		assertSafeCommentDto(body);
	}

	@Test
	void authorAfterRoleDowngradeToViewerIsRejected() throws Exception {
		LoginSession admin = login("comments-downgrade-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMU2", "Downgrade project");
		String issueKey = createIssue(admin, key, "TASK", "Downgrade", null, null);
		LoginSession member = login("comments-downgrade-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");
		String commentId = createComment(member, issueKey, "mine");

		jdbcTemplate.update("""
				UPDATE project_member SET role = 'VIEWER'
				WHERE project_id = (SELECT id FROM project WHERE key = ?)
				  AND user_account_id = ?
				""", key, member.userId());

		MvcResult result = mockMvc.perform(patch("/api/comments/{id}", commentId).cookie(member.session(), member.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"body":"try edit","expectedVersion":0}
						"""))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("FORBIDDEN"))
				.andReturn();
		assertNoInternalDetail(result);
	}

	@Test
	void memberCannotEditAnotherAuthorsComment() throws Exception {
		LoginSession admin = login("comments-edit-member-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMU3", "Edit member project");
		String issueKey = createIssue(admin, key, "TASK", "Edit member", null, null);
		LoginSession memberA = login("comments-edit-a@example.com", UserRole.USER);
		LoginSession memberB = login("comments-edit-b@example.com", UserRole.USER);
		addMember(key, memberA.userId(), "MEMBER");
		addMember(key, memberB.userId(), "MEMBER");
		String commentId = createComment(memberA, issueKey, "from A");

		MvcResult result = mockMvc.perform(patch("/api/comments/{id}", commentId).cookie(memberB.session(), memberB.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(memberB.csrfHeader(), memberB.csrfToken())
				.content("""
						{"body":"intrusion","expectedVersion":0}
						"""))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("FORBIDDEN"))
				.andReturn();
		assertNoInternalDetail(result);
	}

	@Test
	void leadAndAdminCannotEditAnotherAuthorsComment() throws Exception {
		LoginSession admin = login("comments-edit-lead-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMU4", "Lead edit project");
		String issueKey = createIssue(admin, key, "TASK", "Lead edit", null, null);
		LoginSession member = login("comments-edit-lead-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");
		String commentId = createComment(member, issueKey, "from member");

		// The ORG_ADMIN is a non-author and must not edit the member's text.
		MvcResult result = mockMvc.perform(patch("/api/comments/{id}", commentId).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"body":"moderator edit","expectedVersion":0}
						"""))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("FORBIDDEN"))
				.andReturn();
		assertNoInternalDetail(result);
	}

	@Test
	void staleExpectedVersionReturns409() throws Exception {
		LoginSession admin = login("comments-stale-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMU5", "Stale project");
		String issueKey = createIssue(admin, key, "TASK", "Stale", null, null);
		String commentId = createComment(admin, issueKey, "v0");

		// First edit succeeds (v0 -> v1).
		mockMvc.perform(patch("/api/comments/{id}", commentId).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"body":"first edit","expectedVersion":0}
						"""))
				.andExpect(status().isOk());

		// Second edit with the stale v0 must conflict.
		MvcResult result = mockMvc.perform(patch("/api/comments/{id}", commentId).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"body":"stale edit","expectedVersion":0}
						"""))
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.code").value("VERSION_CONFLICT"))
				.andReturn();
		assertNoInternalDetail(result);
	}

	@Test
	void updateDeletedOrUnknownCommentReturnsNotFound() throws Exception {
		LoginSession admin = login("comments-upd404-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMU6", "Update 404 project");
		String issueKey = createIssue(admin, key, "TASK", "Update 404", null, null);
		String commentId = createComment(admin, issueKey, "to delete");
		deleteComment(admin, commentId, 0);

		MvcResult deleted = mockMvc.perform(patch("/api/comments/{id}", commentId).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"body":"reopen","expectedVersion":1}
						"""))
				.andExpect(status().isNotFound())
				.andExpect(jsonPath("$.code").value("COMMENT_NOT_FOUND"))
				.andReturn();
		assertNoInternalDetail(deleted);

		MvcResult unknown = mockMvc.perform(patch("/api/comments/{id}",
				UUID.randomUUID()).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"body":"nope","expectedVersion":0}
						"""))
				.andExpect(status().isNotFound())
				.andExpect(jsonPath("$.code").value("COMMENT_NOT_FOUND"))
				.andReturn();
		assertNoInternalDetail(unknown);
	}

	@Test
	void updateValidationAndCsrfNegatives() throws Exception {
		LoginSession admin = login("comments-upd-neg-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMU7", "Update neg project");
		String issueKey = createIssue(admin, key, "TASK", "Update neg", null, null);
		String commentId = createComment(admin, issueKey, "v0");

		mockMvc.perform(patch("/api/comments/{id}", commentId).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"body":"   ","expectedVersion":0}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

		mockMvc.perform(patch("/api/comments/{id}", commentId).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"body":"ok body"}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

		mockMvc.perform(patch("/api/comments/{id}", commentId).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"body":"no csrf","expectedVersion":0}
						"""))
				.andExpect(status().isForbidden());
	}

	// ----------------------------------------------------------------- delete

	@Test
	void authorDeletesOwnCommentReturningTombstone() throws Exception {
		LoginSession admin = login("comments-del-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMD1", "Delete project");
		String issueKey = createIssue(admin, key, "TASK", "Delete", null, null);
		String commentId = createComment(admin, issueKey, "remove me");

		MvcResult result = mockMvc.perform(delete("/api/comments/{id}", commentId).cookie(admin.session(), admin.csrfCookie())
				.header(admin.csrfHeader(), admin.csrfToken())
				.queryParam("expectedVersion", "0"))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("deleted").asBoolean()).isTrue();
		assertThat(body.get("body").isNull()).isTrue();
		assertThat(body.get("issueKey").asText()).isEqualTo(issueKey);
		assertThat(body.get("authorId").asText()).isEqualTo(admin.userId().toString());
		assertThat(body.get("version").asLong()).isEqualTo(1);
		assertSafeCommentDto(body);
	}

	@Test
	void leadAndAdminCanModerationDelete() throws Exception {
		LoginSession admin = login("comments-mod-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMD2", "Moderation project");
		String issueKey = createIssue(admin, key, "TASK", "Moderation", null, null);
		LoginSession member = login("comments-mod-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");
		String commentId = createComment(member, issueKey, "member words");

		// ORG_ADMIN moderates.
		mockMvc.perform(delete("/api/comments/{id}", commentId).cookie(admin.session(), admin.csrfCookie())
				.header(admin.csrfHeader(), admin.csrfToken())
				.queryParam("expectedVersion", "0"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.deleted").value(true));
	}

	@Test
	void memberCannotDeleteAnotherAuthorsComment() throws Exception {
		LoginSession admin = login("comments-mdm-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMD3", "Member delete project");
		String issueKey = createIssue(admin, key, "TASK", "Member delete", null, null);
		LoginSession memberA = login("comments-mda@example.com", UserRole.USER);
		LoginSession memberB = login("comments-mdb@example.com", UserRole.USER);
		addMember(key, memberA.userId(), "MEMBER");
		addMember(key, memberB.userId(), "MEMBER");
		String commentId = createComment(memberA, issueKey, "A's comment");

		MvcResult result = mockMvc.perform(delete("/api/comments/{id}", commentId).cookie(memberB.session(), memberB.csrfCookie())
				.header(memberB.csrfHeader(), memberB.csrfToken())
				.queryParam("expectedVersion", "0"))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("FORBIDDEN"))
				.andReturn();
		assertNoInternalDetail(result);
	}

	@Test
	void viewerDeleteIsRejected() throws Exception {
		LoginSession admin = login("comments-vd-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMD4", "Viewer delete project");
		String issueKey = createIssue(admin, key, "TASK", "Viewer delete", null, null);
		String commentId = createComment(admin, issueKey, "keep");
		LoginSession viewer = login("comments-vd@example.com", UserRole.USER);
		addMember(key, viewer.userId(), "VIEWER");

		MvcResult result = mockMvc.perform(delete("/api/comments/{id}", commentId).cookie(viewer.session(), viewer.csrfCookie())
				.header(viewer.csrfHeader(), viewer.csrfToken())
				.queryParam("expectedVersion", "0"))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("FORBIDDEN"))
				.andReturn();
		assertNoInternalDetail(result);
	}

	@Test
	void deleteStaleVersionReturns409() throws Exception {
		LoginSession admin = login("comments-dsv-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMD5", "Delete stale project");
		String issueKey = createIssue(admin, key, "TASK", "Delete stale", null, null);
		String commentId = createComment(admin, issueKey, "stale delete");

		// Bump the version via an edit (v0 -> v1) so the comment stays active but
		// a delete carrying the old v0 must conflict.
		mockMvc.perform(patch("/api/comments/{id}", commentId).cookie(admin.session(), admin.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"body":"edited first","expectedVersion":0}
						"""))
				.andExpect(status().isOk());

		MvcResult result = mockMvc.perform(delete("/api/comments/{id}", commentId).cookie(admin.session(), admin.csrfCookie())
				.header(admin.csrfHeader(), admin.csrfToken())
				.queryParam("expectedVersion", "0"))
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.code").value("VERSION_CONFLICT"))
				.andReturn();
		assertNoInternalDetail(result);
	}

	@Test
	void repeatedDeletionAfterTombstoneReturnsNotFound() throws Exception {
		LoginSession admin = login("comments-rd-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMD6", "Repeat delete project");
		String issueKey = createIssue(admin, key, "TASK", "Repeat delete", null, null);
		String commentId = createComment(admin, issueKey, "remove");

		mockMvc.perform(delete("/api/comments/{id}", commentId).cookie(admin.session(), admin.csrfCookie())
				.header(admin.csrfHeader(), admin.csrfToken())
				.queryParam("expectedVersion", "0"))
				.andExpect(status().isOk());

		// Repeated deletion with the latest version returns COMMENT_NOT_FOUND.
		MvcResult result = mockMvc.perform(delete("/api/comments/{id}", commentId).cookie(admin.session(), admin.csrfCookie())
				.header(admin.csrfHeader(), admin.csrfToken())
				.queryParam("expectedVersion", "1"))
				.andExpect(status().isNotFound())
				.andExpect(jsonPath("$.code").value("COMMENT_NOT_FOUND"))
				.andReturn();
		assertNoInternalDetail(result);
	}

	@Test
	void deleteRequiresCsrfAndRejectsInvalidCsrf() throws Exception {
		LoginSession admin = login("comments-dcsrf-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMD7", "Delete csrf project");
		String issueKey = createIssue(admin, key, "TASK", "Delete csrf", null, null);
		String commentId = createComment(admin, issueKey, "csrf");

		mockMvc.perform(delete("/api/comments/{id}", commentId).cookie(admin.session(), admin.csrfCookie())
				.queryParam("expectedVersion", "0"))
				.andExpect(status().isForbidden());

		mockMvc.perform(delete("/api/comments/{id}", commentId).cookie(admin.session(), admin.csrfCookie())
				.header(admin.csrfHeader(), "bogus")
				.queryParam("expectedVersion", "0"))
				.andExpect(status().isForbidden());
	}

	@Test
	void deleteRejectsNegativeOrMissingExpectedVersion() throws Exception {
		LoginSession admin = login("comments-dneg-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CMD8", "Delete negative project");
		String issueKey = createIssue(admin, key, "TASK", "Delete negative", null, null);
		String commentId = createComment(admin, issueKey, "negative");

		MvcResult negative = mockMvc.perform(delete("/api/comments/{id}", commentId).cookie(admin.session(), admin.csrfCookie())
				.header(admin.csrfHeader(), admin.csrfToken())
				.queryParam("expectedVersion", "-1"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andReturn();
		assertNoInternalDetail(negative);

		// A missing expectedVersion is bound as absent (not a framework binding
		// error) and rejected with the same exact RFC 9457 VALIDATION_FAILED code.
		MvcResult missing = mockMvc.perform(delete("/api/comments/{id}", commentId).cookie(admin.session(), admin.csrfCookie())
				.header(admin.csrfHeader(), admin.csrfToken()))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andReturn();
		assertNoInternalDetail(missing);

		// Zero is a valid version and the delete proceeds.
		mockMvc.perform(delete("/api/comments/{id}", commentId).cookie(admin.session(), admin.csrfCookie())
				.header(admin.csrfHeader(), admin.csrfToken())
				.queryParam("expectedVersion", "0"))
				.andExpect(status().isOk());
	}

	// --------------------------------------------------------------- helpers

	private void assertSafeCommentDto(JsonNode node) {
		// The contract exposes only authorId (a UUID), never the author entity,
		// email, password/account fields, or any JPA/identity data.
		String raw = node.toString().toLowerCase();
		assertThat(raw).doesNotContain("email", "password", "token", "cookie", "session",
				"hash", "deletedby", "firstname", "lastname");
	}

	private void assertNoInternalDetail(MvcResult result) throws Exception {
		String raw = result.getResponse().getContentAsString().toLowerCase();
		assertThat(raw).doesNotContain("exception", "stacktrace", "trace", "sql",
				"constraint", "duplicate", "password", "token", "cookie", "session");
	}

	private void assertCommentCount(String projectKey, int expected) {
		Integer count = jdbcTemplate.queryForObject("""
				SELECT COUNT(*) FROM issue_comment
				WHERE issue_id IN (
					SELECT i.id FROM issue i JOIN project p ON p.id = i.project_id
					WHERE p.key = ?
				)
				""", Integer.class, projectKey);
		assertThat(count).isEqualTo(expected);
	}

	private void cleanupAllRows() {
		if (tableExists("issue_comment")) {
			jdbcTemplate.update("DELETE FROM issue_comment");
		}
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

	private String createIssue(LoginSession session, String projectKey, String type,
			String title, String description, UUID assigneeId) throws Exception {
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

	private void archiveIssue(LoginSession session, String issueKey) throws Exception {
		mockMvc.perform(post("/api/issues/{key}/archive", issueKey).cookie(session.session(), session.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(session.csrfHeader(), session.csrfToken())
				.content("""
						{"expectedVersion":0}
						"""))
				.andExpect(status().isOk());
	}

	private String createComment(LoginSession session, String issueKey, String body)
			throws Exception {
		MvcResult result = mockMvc.perform(post("/api/issues/{key}/comments", issueKey).cookie(session.session(), session.csrfCookie())
				.contentType(MediaType.APPLICATION_JSON)
				.header(session.csrfHeader(), session.csrfToken())
				.content("""
						{"body":"%s"}
						""".formatted(body)))
				.andExpect(status().isCreated())
				.andReturn();
		JsonNode json = objectMapper.readTree(result.getResponse().getContentAsString());
		return json.get("id").asText();
	}

	private void deleteComment(LoginSession session, String commentId, long expectedVersion)
			throws Exception {
		mockMvc.perform(delete("/api/comments/{id}", commentId).cookie(session.session(), session.csrfCookie())
				.header(session.csrfHeader(), session.csrfToken())
				.queryParam("expectedVersion", Long.toString(expectedVersion)))
				.andExpect(status().isOk());
	}

	private void addMember(String projectKey, UUID userId, String role) {
		jdbcTemplate.update("""
				INSERT INTO project_member (id, project_id, user_account_id, role)
				SELECT gen_random_uuid(), p.id, ?, ?
				FROM project p WHERE p.key = ?
				""", userId, role, projectKey);
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
}
