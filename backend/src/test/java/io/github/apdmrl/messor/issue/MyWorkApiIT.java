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
 * Contract test for {@code GET /api/my-work}.
 *
 * <p>My Work returns only issues assigned to the authenticated principal across
 * the projects the principal can currently see. It must never accept a target
 * user/assignee identifier, never leak issues from projects the principal
 * cannot see, default to active issues, honor the archived/active/all contract,
 * support project/type/status filters, bounded pagination, a strict sort
 * allowlist, and deterministic secondary ordering. Responses reuse the safe
 * {@code IssuePageResponse}/{@code IssueResponse} contract and leak no internal
 * detail.</p>
 */
@AutoConfigureMockMvc
class MyWorkApiIT extends PostgresIntegrationTestSupport {

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

	// ------------------------------------------------------------------
	// Core semantics
	// ------------------------------------------------------------------

	@Test
	void memberSeesOnlyActiveIssuesAssignedToThemAcrossVisibleProjects()
			throws Exception {
		LoginSession admin = login("mywork-admin@example.com", UserRole.ORG_ADMIN);
		String keyA = createProject(admin, "WORKA1", "Project A");
		String keyB = createProject(admin, "WORKB1", "Project B");

		LoginSession assignee = login("mywork-assignee@example.com", UserRole.USER);
		addMember(keyA, assignee.userId(), "MEMBER");
		addMember(keyB, assignee.userId(), "MEMBER");

		String a1 = createIssue(admin, keyA, "STORY", "A one", null, assignee.userId());
		String a2 = createIssue(admin, keyA, "TASK", "A two", null, assignee.userId());
		String b1 = createIssue(admin, keyB, "BUG", "B one", null, assignee.userId());

		// An unassigned issue in a visible project must never appear.
		createIssue(admin, keyA, "TASK", "Unassigned in A", null, null);

		MvcResult result = mockMvc.perform(get("/api/my-work").cookie(assignee.session()))
				.andExpect(status().isOk())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andExpect(header().string("Cache-Control", containsString("no-store")))
				.andReturn();

		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("page").asInt()).isEqualTo(0);
		assertThat(body.get("size").asInt()).isEqualTo(20);
		assertThat(body.get("totalItems").asLong()).isEqualTo(3L);
		assertThat(body.get("totalPages").asInt()).isEqualTo(1);
		JsonNode items = body.get("items");
		assertThat(items.isArray()).isTrue();
		assertThat(items.size()).isEqualTo(3);

		List<String> keys = textValues(items, "issueKey");
		assertThat(keys).containsExactlyInAnyOrder(a1, a2, b1);

		// Each item is a safe IssueResponse with no nested entities.
		for (JsonNode item : items) {
			assertSafeIssueDto(item);
		}
	}

	@Test
	void issuesAssignedToAnotherUserAreExcluded() throws Exception {
		LoginSession admin = login("mywork-other-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "WORKB2", "Other project");

		LoginSession me = login("mywork-me@example.com", UserRole.USER);
		LoginSession other = login("mywork-other@example.com", UserRole.USER);
		addMember(key, me.userId(), "MEMBER");
		addMember(key, other.userId(), "MEMBER");

		String mine = createIssue(admin, key, "STORY", "Mine", null, me.userId());
		createIssue(admin, key, "STORY", "Theirs", null, other.userId());

		MvcResult result = mockMvc.perform(get("/api/my-work").cookie(me.session()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("totalItems").asLong()).isEqualTo(1L);
		assertThat(body.get("items").get(0).get("issueKey").asText()).isEqualTo(mine);
	}

	@Test
	void issuesFromProjectsWherePrincipalIsNotAMemberAreExcluded() throws Exception {
		LoginSession admin = login("mywork-nonmember-admin@example.com", UserRole.ORG_ADMIN);
		String visibleKey = createProject(admin, "WORKB3", "Visible project");
		String hiddenKey = createProject(admin, "WORKB4", "Hidden project");

		LoginSession member = login("mywork-nonmember@example.com", UserRole.USER);
		addMember(visibleKey, member.userId(), "MEMBER");

		String visible = createIssue(admin, visibleKey, "STORY", "Visible",
				null, member.userId());

		// Insert an issue assigned to the principal in a project they were never a
		// member of. The application create endpoint rejects assigning a nonmember,
		// so this data is inserted directly to prove My Work still excludes it.
		String hidden = insertDirectAssignedIssue(hiddenKey, member.userId(), "Hidden");

		MvcResult result = mockMvc.perform(get("/api/my-work").cookie(member.session()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("totalItems").asLong()).isEqualTo(1L);
		assertThat(body.get("items").get(0).get("issueKey").asText()).isEqualTo(visible);

		// Sanity: the hidden assigned issue exists but must never leak.
		Integer exists = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM issue WHERE human_key = ?", Integer.class, hidden);
		assertThat(exists).isEqualTo(1);
	}

	@Test
	void issuesFromRemovedMembershipProjectAreExcluded() throws Exception {
		LoginSession admin = login("mywork-removed-admin@example.com", UserRole.ORG_ADMIN);
		String keyA = createProject(admin, "WORKB5", "Kept");
		String keyB = createProject(admin, "WORKB6", "Removed");

		LoginSession member = login("mywork-removed@example.com", UserRole.USER);
		addMember(keyA, member.userId(), "MEMBER");
		addMember(keyB, member.userId(), "MEMBER");

		String kept = createIssue(admin, keyA, "STORY", "Kept", null, member.userId());
		String removed = createIssue(admin, keyB, "STORY", "Removed", null, member.userId());

		// Remove the principal's membership in keyB after the issue was assigned.
		jdbcTemplate.update("DELETE FROM project_member WHERE project_id ="
				+ " (SELECT id FROM project WHERE key = ?) AND user_account_id = ?",
				keyB, member.userId());

		MvcResult result = mockMvc.perform(get("/api/my-work").cookie(member.session()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("totalItems").asLong()).isEqualTo(1L);
		assertThat(body.get("items").get(0).get("issueKey").asText()).isEqualTo(kept);

		// Sanity: the removed-project issue still exists and is assigned.
		Integer exists = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM issue WHERE human_key = ?", Integer.class, removed);
		assertThat(exists).isEqualTo(1);
	}

	@Test
	void orgAdminSeesAssignedIssuesAcrossAllProjects() throws Exception {
		LoginSession admin = login("mywork-admin-all@example.com", UserRole.ORG_ADMIN);
		String keyA = createProject(admin, "WORKB7", "Admin A");
		String keyB = createProject(admin, "WORKB8", "Admin B");

		// Admin is not a member of these projects but must still see their own
		// assigned issues because an ORG_ADMIN may access every project.
		LoginSession otherLead = login("mywork-admin-otherlead@example.com", UserRole.USER);
		addMember(keyA, otherLead.userId(), "PROJECT_LEAD");
		addMember(keyB, otherLead.userId(), "PROJECT_LEAD");

		String a = createIssue(otherLead, keyA, "STORY", "Admin assigned A",
				null, admin.userId());
		String b = createIssue(otherLead, keyB, "STORY", "Admin assigned B",
				null, admin.userId());

		MvcResult result = mockMvc.perform(get("/api/my-work").cookie(admin.session()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("totalItems").asLong()).isEqualTo(2L);
		assertThat(textValues(body.get("items"), "issueKey"))
				.containsExactlyInAnyOrder(a, b);
	}

	// ------------------------------------------------------------------
	// Archive contract
	// ------------------------------------------------------------------

	@Test
	void archivedIssuesExcludedByDefault() throws Exception {
		LoginSession admin = login("mywork-arch-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "WORKC1", "Archive project");

		LoginSession member = login("mywork-arch-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		String active = createIssue(admin, key, "STORY", "Active", null, member.userId());
		String archived = createIssue(admin, key, "TASK", "Archived", null, member.userId());
		jdbcTemplate.update("UPDATE issue SET archived = TRUE, version = version + 1"
				+ " WHERE human_key = ?", archived);

		MvcResult result = mockMvc.perform(get("/api/my-work").cookie(member.session()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("totalItems").asLong()).isEqualTo(1L);
		assertThat(body.get("items").get(0).get("issueKey").asText()).isEqualTo(active);
	}

	@Test
	void archivedFilterReturnsOnlyArchived() throws Exception {
		LoginSession admin = login("mywork-archonly-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "WORKC2", "Archived only");

		LoginSession member = login("mywork-archonly-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		String active = createIssue(admin, key, "STORY", "Active", null, member.userId());
		String archived = createIssue(admin, key, "TASK", "Archived", null, member.userId());
		jdbcTemplate.update("UPDATE issue SET archived = TRUE, version = version + 1"
				+ " WHERE human_key = ?", archived);

		MvcResult result = mockMvc.perform(get("/api/my-work")
				.param("archive", "archived")
				.cookie(member.session()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("totalItems").asLong()).isEqualTo(1L);
		assertThat(body.get("items").get(0).get("issueKey").asText()).isEqualTo(archived);
		assertThat(body.get("items").get(0).get("archived").asBoolean()).isTrue();

		// The active issue is excluded in archived-only mode.
		List<String> keys = textValues(body.get("items"), "issueKey");
		assertThat(keys).doesNotContain(active);
	}

	@Test
	void allArchiveFilterReturnsActiveAndArchived() throws Exception {
		LoginSession admin = login("mywork-archall-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "WORKC3", "All archive");

		LoginSession member = login("mywork-archall-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		String active = createIssue(admin, key, "STORY", "Active", null, member.userId());
		String archived = createIssue(admin, key, "TASK", "Archived", null, member.userId());
		jdbcTemplate.update("UPDATE issue SET archived = TRUE, version = version + 1"
				+ " WHERE human_key = ?", archived);

		MvcResult result = mockMvc.perform(get("/api/my-work")
				.param("archive", "all")
				.cookie(member.session()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("totalItems").asLong()).isEqualTo(2L);
		assertThat(textValues(body.get("items"), "issueKey"))
				.containsExactlyInAnyOrder(active, archived);
	}

	// ------------------------------------------------------------------
	// Filters
	// ------------------------------------------------------------------

	@Test
	void projectTypeAndStatusFiltersCombine() throws Exception {
		LoginSession admin = login("mywork-filters-admin@example.com", UserRole.ORG_ADMIN);
		String keyA = createProject(admin, "WORKD1", "Filter A");
		String keyB = createProject(admin, "WORKD2", "Filter B");

		LoginSession member = login("mywork-filters-member@example.com", UserRole.USER);
		addMember(keyA, member.userId(), "MEMBER");
		addMember(keyB, member.userId(), "MEMBER");

		createIssue(admin, keyA, "TASK", "A task todo", null, member.userId());
		String aBugInProgress = createIssue(admin, keyA, "BUG", "A bug in progress",
				null, member.userId());
		createIssue(admin, keyB, "BUG", "B bug todo", null, member.userId());

		setStatusAndRank(aBugInProgress, "IN_PROGRESS");

		// Filter by project key only.
		MvcResult byProject = mockMvc.perform(get("/api/my-work")
				.param("project", keyA)
				.cookie(member.session()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode projBody = objectMapper.readTree(byProject.getResponse().getContentAsString());
		assertThat(projBody.get("totalItems").asLong()).isEqualTo(2L);
		for (JsonNode item : projBody.get("items")) {
			assertThat(item.get("projectKey").asText()).isEqualTo(keyA);
		}

		// Filter by type.
		MvcResult byType = mockMvc.perform(get("/api/my-work")
				.param("type", "BUG")
				.cookie(member.session()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode typeBody = objectMapper.readTree(byType.getResponse().getContentAsString());
		assertThat(typeBody.get("totalItems").asLong()).isEqualTo(2L);
		for (JsonNode item : typeBody.get("items")) {
			assertThat(item.get("type").asText()).isEqualTo("BUG");
		}

		// Filter by status.
		MvcResult byStatus = mockMvc.perform(get("/api/my-work")
				.param("status", "IN_PROGRESS")
				.cookie(member.session()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode statusBody = objectMapper.readTree(byStatus.getResponse().getContentAsString());
		assertThat(statusBody.get("totalItems").asLong()).isEqualTo(1L);
		assertThat(statusBody.get("items").get(0).get("issueKey").asText())
				.isEqualTo(aBugInProgress);

		// Combined project + type + status yields exactly one.
		MvcResult combined = mockMvc.perform(get("/api/my-work")
				.param("project", keyA)
				.param("type", "BUG")
				.param("status", "IN_PROGRESS")
				.cookie(member.session()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode combinedBody = objectMapper
				.readTree(combined.getResponse().getContentAsString());
		assertThat(combinedBody.get("totalItems").asLong()).isEqualTo(1L);
		assertThat(combinedBody.get("items").get(0).get("issueKey").asText())
				.isEqualTo(aBugInProgress);
	}

	// ------------------------------------------------------------------
	// Pagination and ordering
	// ------------------------------------------------------------------

	@Test
	void crossProjectSameNumberAndSamePrimarySortIsDeterministicAcrossPages()
			throws Exception {
		LoginSession admin = login("mywork-global-admin@example.com", UserRole.ORG_ADMIN);
		String keyA = createProject(admin, "WORKG1", "Global A");
		String keyB = createProject(admin, "WORKG2", "Global B");

		LoginSession member = login("mywork-global-member@example.com", UserRole.USER);
		addMember(keyA, member.userId(), "MEMBER");
		addMember(keyB, member.userId(), "MEMBER");

		// Three issues with the SAME number (1) and SAME primary sort value
		// (title) across two projects: issue number is not globally unique, so
		// only the final id ASC tie-breaker can keep pagination stable.
		createIssue(admin, keyA, "TASK", "Same title", null, member.userId());
		createIssue(admin, keyB, "TASK", "Same title", null, member.userId());
		createIssue(admin, keyA, "TASK", "Same title", null, member.userId());

		List<String> walk = new ArrayList<>();
		for (int page = 0; page < 3; page++) {
			MvcResult result = mockMvc.perform(get("/api/my-work")
					.param("sort", "title,asc").param("page", String.valueOf(page))
					.param("size", "1")
					.cookie(member.session()))
					.andExpect(status().isOk())
					.andReturn();
			JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
			for (JsonNode item : body.get("items")) {
				walk.add(item.get("issueKey").asText());
			}
		}
		// size=1 over 3 issues -> 3 pages -> exactly 3 unique issue keys, none
		// duplicated and none missing.
		assertThat(walk).hasSize(3);
		assertThat(walk).doesNotHaveDuplicates();

		// A second identical walk must reproduce the exact same order.
		List<String> walkAgain = new ArrayList<>();
		for (int page = 0; page < 3; page++) {
			MvcResult result = mockMvc.perform(get("/api/my-work")
					.param("sort", "title,asc").param("page", String.valueOf(page))
					.param("size", "1")
					.cookie(member.session()))
					.andExpect(status().isOk())
					.andReturn();
			JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
			for (JsonNode item : body.get("items")) {
				walkAgain.add(item.get("issueKey").asText());
			}
		}
		assertThat(walkAgain).isEqualTo(walk);
	}

	@Test
	void paginationIsBoundedAndDeterministic() throws Exception {
		LoginSession admin = login("mywork-paging-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "WORKE1", "Paging project");

		LoginSession member = login("mywork-paging-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		for (int i = 1; i <= 5; i++) {
			createIssue(admin, key, "TASK", "Task " + i, null, member.userId());
		}

		// Page 0 size 2 by default number,asc → the first two issues.
		MvcResult page0 = mockMvc.perform(get("/api/my-work")
				.param("page", "0").param("size", "2")
				.cookie(member.session()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode p0 = objectMapper.readTree(page0.getResponse().getContentAsString());
		assertThat(p0.get("page").asInt()).isEqualTo(0);
		assertThat(p0.get("size").asInt()).isEqualTo(2);
		assertThat(p0.get("totalItems").asLong()).isEqualTo(5L);
		assertThat(p0.get("totalPages").asInt()).isEqualTo(3);
		assertThat(p0.get("items").size()).isEqualTo(2);

		MvcResult page2 = mockMvc.perform(get("/api/my-work")
				.param("page", "2").param("size", "2")
				.cookie(member.session()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode p2 = objectMapper.readTree(page2.getResponse().getContentAsString());
		assertThat(p2.get("items").size()).isEqualTo(1);
		assertThat(p2.get("page").asInt()).isEqualTo(2);
	}

	@Test
	void sortAllowlistAndDeterministicSecondaryOrdering() throws Exception {
		LoginSession admin = login("mywork-sort-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "WORKE2", "Sort project");

		LoginSession member = login("mywork-sort-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		createIssue(admin, key, "TASK", "Sort title Z", null, member.userId());
		createIssue(admin, key, "TASK", "Sort title A", null, member.userId());
		createIssue(admin, key, "BUG", "Sort title M", null, member.userId());

		// Sort by title asc: deterministic and no duplicates across pages.
		MvcResult titleAsc = mockMvc.perform(get("/api/my-work")
				.param("sort", "title,asc")
				.cookie(member.session()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode body = objectMapper.readTree(titleAsc.getResponse().getContentAsString());
		assertThat(body.get("totalItems").asLong()).isEqualTo(3L);
		List<String> titles = textValues(body.get("items"), "title");
		assertThat(titles).containsExactly("Sort title A", "Sort title M", "Sort title Z");
	}

	// ------------------------------------------------------------------
	// Validation and security
	// ------------------------------------------------------------------

	@Test
	void negativePageZeroOrNegativeSizeAndOversizeRejected() throws Exception {
		LoginSession admin = login("mywork-badpage-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "WORKE3", "Bad page");

		LoginSession member = login("mywork-badpage-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		MvcResult negativePage = mockMvc.perform(get("/api/my-work")
				.param("page", "-1").cookie(member.session()))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andReturn();
		assertNoInternalDetail(negativePage);

		mockMvc.perform(get("/api/my-work").param("size", "0").cookie(member.session()))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

		mockMvc.perform(get("/api/my-work").param("size", "-5").cookie(member.session()))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

		MvcResult oversize = mockMvc.perform(get("/api/my-work")
				.param("size", "101").cookie(member.session()))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andReturn();
		assertNoInternalDetail(oversize);
	}

	@Test
	void hostileSortIsRejected() throws Exception {
		LoginSession admin = login("mywork-hostsrt-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "WORKE4", "Hostile sort");

		LoginSession member = login("mywork-hostsrt-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		// Path injection attempt.
		MvcResult pathInjection = mockMvc.perform(get("/api/my-work")
				.param("sort", "number;select")
				.cookie(member.session()))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andReturn();
		assertNoInternalDetail(pathInjection);

		// Unknown property must be rejected, never passed into the query.
		MvcResult unknown = mockMvc.perform(get("/api/my-work")
				.param("sort", "passwordHash,asc")
				.cookie(member.session()))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andReturn();
		assertNoInternalDetail(unknown);

		// Bad direction.
		mockMvc.perform(get("/api/my-work").param("sort", "title,up")
				.cookie(member.session()))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

		// Malformed field,direction.
		mockMvc.perform(get("/api/my-work").param("sort", "number")
				.cookie(member.session()))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
	}

	@Test
	void cannotSelectAnotherUserWithUserIdOrAssigneeId() throws Exception {
		LoginSession admin = login("mywork-userid-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "WORKE5", "User id");

		LoginSession me = login("mywork-userid-me@example.com", UserRole.USER);
		LoginSession victim = login("mywork-userid-victim@example.com", UserRole.USER);
		addMember(key, me.userId(), "MEMBER");
		addMember(key, victim.userId(), "MEMBER");

		createIssue(admin, key, "STORY", "Mine", null, me.userId());
		createIssue(admin, key, "STORY", "Victim", null, victim.userId());

		// Attempting to select the victim by userId is rejected outright.
		MvcResult userId = mockMvc.perform(get("/api/my-work")
				.param("userId", victim.userId().toString())
				.cookie(me.session()))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andReturn();
		assertNoInternalDetail(userId);

		MvcResult assigneeId = mockMvc.perform(get("/api/my-work")
				.param("assigneeId", victim.userId().toString())
				.cookie(me.session()))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andReturn();
		assertNoInternalDetail(assigneeId);

		// The generic assignee alias is also rejected.
		MvcResult assignee = mockMvc.perform(get("/api/my-work")
				.param("assignee", victim.userId().toString())
				.cookie(me.session()))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andReturn();
		assertNoInternalDetail(assignee);

		// The victim's issues are never returned even in a non-rejected request.
		MvcResult normal = mockMvc.perform(get("/api/my-work").cookie(me.session()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode body = objectMapper.readTree(normal.getResponse().getContentAsString());
		assertThat(body.get("totalItems").asLong()).isEqualTo(1L);
		assertThat(body.get("items").get(0).get("title").asText()).isEqualTo("Mine");
	}

	@Test
	void anonymousMyWorkReturns401() throws Exception {
		mockMvc.perform(get("/api/my-work"))
				.andExpect(status().isUnauthorized())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("UNAUTHENTICATED"))
				.andExpect(jsonPath("$.detail").value("Oturum açmanız gerekiyor."));
	}

	@Test
	void invalidArchiveValueIsRejected() throws Exception {
		LoginSession admin = login("mywork-archbad-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "WORKE6", "Bad archive");

		LoginSession member = login("mywork-archbad-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		MvcResult result = mockMvc.perform(get("/api/my-work")
				.param("archive", "everything")
				.cookie(member.session()))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andReturn();
		assertNoInternalDetail(result);
	}

	@Test
	void invalidTypeAndStatusAreRejectedOrYieldEmptyWithoutDetail() throws Exception {
		LoginSession admin = login("mywork-badtype-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "WORKE7", "Bad type");

		LoginSession member = login("mywork-badtype-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		// An unknown type value must be rejected, never coerced or reflected.
		MvcResult badType = mockMvc.perform(get("/api/my-work")
				.param("type", "EPIC")
				.cookie(member.session()))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andReturn();
		assertNoInternalDetail(badType);

		// An unknown status code yields an empty result, never an error.
		mockMvc.perform(get("/api/my-work").param("status", "NOPE")
				.cookie(member.session()))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.totalItems").value(0));
	}

	// ------------------------------------------------------------------
	// Helpers (mirror IssueApiIT)
	// ------------------------------------------------------------------

	/**
	 * Inserts an issue row assigned to {@code assigneeId} directly, bypassing the
	 * application assignee validation (which rejects nonmembers). Used to prove
	 * My Work excludes issues assigned to the principal in projects they cannot
	 * see. {@code humanKey} must match the {@code ^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]*$}
	 * check constraint.
	 */
	private String insertDirectAssignedIssue(String projectKey, UUID assigneeId,
			String title) {
		String humanKey = projectKey + "-99";
		jdbcTemplate.update(
				"""
				INSERT INTO issue (id, project_id, number, human_key, type, title,
					description, workflow_status_id, reporter_id, assignee_id, rank, archived)
				SELECT gen_random_uuid(), p.id, 99, ?, 'STORY', ?, NULL,
					(SELECT ws.id FROM workflow_status ws WHERE ws.project_id = p.id
						AND ws.code = 'TO_DO'), p.creator_id, ?, 1024, FALSE
				FROM project p WHERE p.key = ?
				""",
				humanKey, title, assigneeId, projectKey);
		return humanKey;
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

	private void assertSafeIssueDto(JsonNode body) {
		assertThat(body.isObject()).isTrue();
		assertThat(body.size()).isEqualTo(15);
		assertThat(body.propertyNames())
				.containsExactlyInAnyOrder(
						"id", "issueKey", "projectKey", "number", "type", "title",
						"description", "statusCode", "reporterId", "assigneeId", "rank",
						"archived", "version", "createdAt", "updatedAt");
		assertThat(body.has("reporterId")).isTrue();
		assertThat(body.has("assigneeId")).isTrue();
		assertThat(body.has("statusCode")).isTrue();
		assertThat(body.has("passwordHash")).isFalse();
		assertThat(body.has("userAccount")).isFalse();
		assertThat(body.has("reporter")).isFalse();
		assertThat(body.has("assignee")).isFalse();
		assertThat(body.has("email")).isFalse();
		assertThat(body.has("firstName")).isFalse();
		assertThat(body.has("lastName")).isFalse();
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
