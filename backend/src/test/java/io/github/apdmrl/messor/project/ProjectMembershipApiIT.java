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
class ProjectMembershipApiIT extends PostgresIntegrationTestSupport {

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
		jdbcTemplate.update("DELETE FROM workflow_status");
		jdbcTemplate.update("DELETE FROM project_member");
		jdbcTemplate.update("DELETE FROM project");
	}

	// --- Anonymous and CSRF ---

	@Test
	void anonymousMembershipRequestsReturn401() throws Exception {
		mockMvc.perform(get("/api/projects/ANY/members"))
				.andExpect(status().isUnauthorized())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
	}

	@Test
	void membershipMutationsWithoutCsrfReturn403() throws Exception {
		LoginSession admin = login("membership-csrf-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MCSRF1", "Original");

		mockMvc.perform(post("/api/projects/{key}/members", key)
				.cookie(admin.session())
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"email":"someone@example.com","role":"MEMBER"}
						"""))
				.andExpect(status().isForbidden())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_CSRF_TOKEN"));

		mockMvc.perform(patch("/api/projects/{key}/members/{userId}", key, UUID.randomUUID())
				.cookie(admin.session())
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
						{"role":"VIEWER","expectedVersion":0}
						"""))
				.andExpect(status().isForbidden())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_CSRF_TOKEN"));

		mockMvc.perform(delete("/api/projects/{key}/members/{userId}", key, UUID.randomUUID())
				.cookie(admin.session())
				.param("expectedVersion", "0"))
				.andExpect(status().isForbidden())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("INVALID_CSRF_TOKEN"));
	}

	// --- Authorization: who may manage members ---

	@Test
	void orgAdminCanListAddChangeAndRemoveMembers() throws Exception {
		LoginSession admin = login("membership-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MADM01", "Admin project");

		LoginSession target = login("membership-target@example.com", UserRole.USER);

		// Add
		MvcResult add = mockMvc.perform(post("/api/projects/{key}/members", key)
				.cookie(admin.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"email":"membership-target@example.com","role":"MEMBER"}
						"""))
				.andExpect(status().isCreated())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andExpect(header().string("Cache-Control", containsString("no-store")))
				.andReturn();
		JsonNode addBody = objectMapper.readTree(add.getResponse().getContentAsString());
		assertThat(addBody.get("userId").asText()).isEqualTo(target.userId().toString());
		assertThat(addBody.get("email").asText()).isEqualTo("membership-target@example.com");
		assertThat(addBody.get("role").asText()).isEqualTo("MEMBER");
		assertThat(addBody.get("version").asLong()).isEqualTo(0L);

		// List
		MvcResult list = mockMvc.perform(get("/api/projects/{key}/members", key)
				.cookie(admin.session()))
				.andExpect(status().isOk())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andReturn();
		JsonNode listBody = objectMapper.readTree(list.getResponse().getContentAsString());
		assertThat(listBody.size()).isEqualTo(2);

		// Change role
		MvcResult change = mockMvc.perform(patch("/api/projects/{key}/members/{userId}", key, target.userId())
				.cookie(admin.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"role":"VIEWER","expectedVersion":0}
						"""))
				.andExpect(status().isOk())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andReturn();
		JsonNode changeBody = objectMapper.readTree(change.getResponse().getContentAsString());
		assertThat(changeBody.get("role").asText()).isEqualTo("VIEWER");
		assertThat(changeBody.get("version").asLong()).isEqualTo(1L);

		// Remove
		mockMvc.perform(delete("/api/projects/{key}/members/{userId}", key, target.userId())
				.cookie(admin.session())
				.header(admin.csrfHeader(), admin.csrfToken())
				.param("expectedVersion", "1"))
				.andExpect(status().isNoContent());
	}

	@Test
	void projectLeadCanManageMembers() throws Exception {
		LoginSession admin = login("membership-lead-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MLEAD1", "Lead project");

		LoginSession lead = login("membership-lead@example.com", UserRole.USER);
		addMember(key, lead.userId(), "PROJECT_LEAD");

		LoginSession target = login("membership-lead-target@example.com", UserRole.USER);

		mockMvc.perform(post("/api/projects/{key}/members", key)
				.cookie(lead.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(lead.csrfHeader(), lead.csrfToken())
				.content("""
						{"email":"membership-lead-target@example.com","role":"MEMBER"}
						"""))
				.andExpect(status().isCreated())
				.andExpect(jsonPath("$.role").value("MEMBER"));

		mockMvc.perform(get("/api/projects/{key}/members", key).cookie(lead.session()))
				.andExpect(status().isOk());
	}

	@Test
	void memberCannotManageMembersReturns403() throws Exception {
		LoginSession admin = login("membership-member-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MMEMB1", "Member project");

		LoginSession member = login("membership-member@example.com", UserRole.USER);
		addMember(key, member.userId(), "MEMBER");

		mockMvc.perform(get("/api/projects/{key}/members", key).cookie(member.session()))
				.andExpect(status().isForbidden())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("FORBIDDEN"));

		mockMvc.perform(post("/api/projects/{key}/members", key)
				.cookie(member.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(member.csrfHeader(), member.csrfToken())
				.content("""
						{"email":"someone@example.com","role":"MEMBER"}
						"""))
				.andExpect(status().isForbidden())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("FORBIDDEN"));
	}

	@Test
	void viewerCannotManageMembersReturns403() throws Exception {
		LoginSession admin = login("membership-viewer-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MVIEW1", "Viewer project");

		LoginSession viewer = login("membership-viewer@example.com", UserRole.USER);
		addMember(key, viewer.userId(), "VIEWER");

		mockMvc.perform(get("/api/projects/{key}/members", key).cookie(viewer.session()))
				.andExpect(status().isForbidden())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("FORBIDDEN"));
	}

	@Test
	void nonmemberCannotProbeMembershipReturns404WithoutDisclosure() throws Exception {
		LoginSession admin = login("membership-nonmember-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MNONM1", "Hidden project");

		LoginSession outsider = login("membership-nonmember@example.com", UserRole.USER);

		// The outsider cannot list members, and the response must not reveal
		// whether the project exists or whether the target account exists.
		MvcResult list = mockMvc.perform(get("/api/projects/{key}/members", key)
				.cookie(outsider.session()))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andReturn();
		JsonNode listBody = objectMapper.readTree(list.getResponse().getContentAsString());
		assertThat(listBody.get("code").asText()).isEqualTo("PROJECT_NOT_FOUND");

		// A mutation attempt by a nonmember must also be 404, not 403, and must
		// not reveal whether the target account exists.
		MvcResult add = mockMvc.perform(post("/api/projects/{key}/members", key)
				.cookie(outsider.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(outsider.csrfHeader(), outsider.csrfToken())
				.content("""
						{"email":"membership-nonmember@example.com","role":"MEMBER"}
						"""))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andReturn();
		JsonNode addBody = objectMapper.readTree(add.getResponse().getContentAsString());
		assertThat(addBody.get("code").asText()).isEqualTo("PROJECT_NOT_FOUND");
	}

	// --- Membership rules ---

	@Test
	void addMemberNormalizesMixedCaseAndWhitespaceEmail() throws Exception {
		LoginSession admin = login("membership-normalize-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MNORM1", "Normalize project");

		login("membership-normalize-target@example.com", UserRole.USER);

		mockMvc.perform(post("/api/projects/{key}/members", key)
				.cookie(admin.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"email":"  Membership-Normalize-Target@Example.COM  ","role":"MEMBER"}
						"""))
				.andExpect(status().isCreated())
				.andExpect(jsonPath("$.email").value("membership-normalize-target@example.com"))
				.andExpect(jsonPath("$.role").value("MEMBER"));
	}

	@Test
	void addMemberWithInvalidEmailReturns400() throws Exception {
		LoginSession admin = login("membership-invalid-email-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MINV01", "Invalid email project");

		mockMvc.perform(post("/api/projects/{key}/members", key)
				.cookie(admin.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"email":"not-an-email","role":"MEMBER"}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
	}

	@Test
	void addMemberWithNullOrInvalidRoleReturns400() throws Exception {
		LoginSession admin = login("membership-invalid-role-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MIROL1", "Invalid role project");

		// Null role
		mockMvc.perform(post("/api/projects/{key}/members", key)
				.cookie(admin.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"email":"someone@example.com","role":null}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

		// Unknown role value
		mockMvc.perform(post("/api/projects/{key}/members", key)
				.cookie(admin.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"email":"someone@example.com","role":"OWNER"}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
	}

	@Test
	void changeRoleWithMissingOrNegativeVersionReturns400() throws Exception {
		LoginSession admin = login("membership-version-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MVER01", "Version project");

		LoginSession target = login("membership-version-target@example.com", UserRole.USER);
		addMember(key, target.userId(), "MEMBER");

		// Missing version
		mockMvc.perform(patch("/api/projects/{key}/members/{userId}", key, target.userId())
				.cookie(admin.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"role":"VIEWER"}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

		// Negative version
		mockMvc.perform(patch("/api/projects/{key}/members/{userId}", key, target.userId())
				.cookie(admin.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"role":"VIEWER","expectedVersion":-1}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
	}

	@Test
	void successfulResponseContainsOnlySafeDtoFields() throws Exception {
		LoginSession admin = login("membership-safe-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MSAFE1", "Safe project");

		login("membership-safe-target@example.com", UserRole.USER);

		MvcResult add = mockMvc.perform(post("/api/projects/{key}/members", key)
				.cookie(admin.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"email":"membership-safe-target@example.com","role":"MEMBER"}
						"""))
				.andExpect(status().isCreated())
				.andReturn();

		String raw = add.getResponse().getContentAsString();
		assertThat(raw).doesNotContain("passwordHash", "status", "organizationRole",
				"userAccount", "projectId", "membershipId", "createdAt", "updatedAt");
	}

	@Test
	void duplicateMembershipReturns409MemberAlreadyExists() throws Exception {
		LoginSession admin = login("membership-dup-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MDUP01", "Duplicate project");

		LoginSession target = login("membership-dup-target@example.com", UserRole.USER);
		addMember(key, target.userId(), "MEMBER");

		MvcResult dup = mockMvc.perform(post("/api/projects/{key}/members", key)
				.cookie(admin.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"email":"membership-dup-target@example.com","role":"VIEWER"}
						"""))
				.andExpect(status().isConflict())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andReturn();

		JsonNode body = objectMapper.readTree(dup.getResponse().getContentAsString());
		assertThat(body.get("code").asText()).isEqualTo("MEMBER_ALREADY_EXISTS");
		assertThat(body.get("status").asInt()).isEqualTo(409);
	}

	@Test
	void unknownEmailReturnsSafe404UserNotFound() throws Exception {
		LoginSession admin = login("membership-unknown-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MUNK01", "Unknown email project");

		MvcResult result = mockMvc.perform(post("/api/projects/{key}/members", key)
				.cookie(admin.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"email":"does-not-exist@example.com","role":"MEMBER"}
						"""))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andReturn();

		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("code").asText()).isEqualTo("USER_NOT_FOUND");
	}

	@Test
	void inactiveEmailReturnsSafe404UserNotFound() throws Exception {
		LoginSession admin = login("membership-inactive-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MINAC1", "Inactive email project");

		UserAccount inactive = UserAccount.create("membership-inactive-target@example.com",
				passwordEncoder.encode("correct horse battery staple"), "In", "Active", UserRole.USER);
		inactive.disable();
		userAccountRepository.saveAndFlush(inactive);

		MvcResult result = mockMvc.perform(post("/api/projects/{key}/members", key)
				.cookie(admin.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"email":"membership-inactive-target@example.com","role":"MEMBER"}
						"""))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andReturn();

		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("code").asText()).isEqualTo("USER_NOT_FOUND");
	}

	@Test
	void missingTargetMembershipReturns404ProjectMemberNotFound() throws Exception {
		LoginSession admin = login("membership-missing-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MMISS1", "Missing member project");

		LoginSession target = login("membership-missing-target@example.com", UserRole.USER);

		// PATCH a user who is not a member
		MvcResult patch = mockMvc.perform(patch("/api/projects/{key}/members/{userId}", key, target.userId())
				.cookie(admin.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"role":"VIEWER","expectedVersion":0}
						"""))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andReturn();
		JsonNode patchBody = objectMapper.readTree(patch.getResponse().getContentAsString());
		assertThat(patchBody.get("code").asText()).isEqualTo("PROJECT_MEMBER_NOT_FOUND");

		// DELETE a user who is not a member
		MvcResult del = mockMvc.perform(delete("/api/projects/{key}/members/{userId}", key, target.userId())
				.cookie(admin.session())
				.header(admin.csrfHeader(), admin.csrfToken())
				.param("expectedVersion", "0"))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andReturn();
		JsonNode delBody = objectMapper.readTree(del.getResponse().getContentAsString());
		assertThat(delBody.get("code").asText()).isEqualTo("PROJECT_MEMBER_NOT_FOUND");
	}

	@Test
	void finalLeadCannotBeDemotedOrRemoved() throws Exception {
		LoginSession admin = login("membership-finallead-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MFNL01", "Final lead project");

		// The creator is the only PROJECT_LEAD. Demote them.
		MvcResult demote = mockMvc.perform(patch("/api/projects/{key}/members/{userId}", key, admin.userId())
				.cookie(admin.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"role":"MEMBER","expectedVersion":0}
						"""))
				.andExpect(status().isConflict())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andReturn();
		JsonNode demoteBody = objectMapper.readTree(demote.getResponse().getContentAsString());
		assertThat(demoteBody.get("code").asText()).isEqualTo("LAST_PROJECT_LEAD_REQUIRED");

		// Remove the final lead.
		MvcResult remove = mockMvc.perform(delete("/api/projects/{key}/members/{userId}", key, admin.userId())
				.cookie(admin.session())
				.header(admin.csrfHeader(), admin.csrfToken())
				.param("expectedVersion", "0"))
				.andExpect(status().isConflict())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andReturn();
		JsonNode removeBody = objectMapper.readTree(remove.getResponse().getContentAsString());
		assertThat(removeBody.get("code").asText()).isEqualTo("LAST_PROJECT_LEAD_REQUIRED");
	}

	@Test
	void leadMayBeDemotedOrRemovedWhenAnotherLeadRemains() throws Exception {
		LoginSession admin = login("membership-twolead-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MTWO01", "Two lead project");

		LoginSession secondLead = login("membership-twolead@example.com", UserRole.USER);
		addMember(key, secondLead.userId(), "PROJECT_LEAD");

		// Demote the creator lead; another lead remains.
		mockMvc.perform(patch("/api/projects/{key}/members/{userId}", key, admin.userId())
				.cookie(admin.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"role":"MEMBER","expectedVersion":0}
						"""))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.role").value("MEMBER"));

		// Remove the remaining lead; the creator is now a member, so no lead remains.
		MvcResult remove = mockMvc.perform(delete("/api/projects/{key}/members/{userId}", key, secondLead.userId())
				.cookie(admin.session())
				.header(admin.csrfHeader(), admin.csrfToken())
				.param("expectedVersion", "0"))
				.andExpect(status().isConflict())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andReturn();
		JsonNode removeBody = objectMapper.readTree(remove.getResponse().getContentAsString());
		assertThat(removeBody.get("code").asText()).isEqualTo("LAST_PROJECT_LEAD_REQUIRED");
	}

	@Test
	void stalePatchAndDeleteReturn409VersionConflict() throws Exception {
		LoginSession admin = login("membership-stale-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MSTAL1", "Stale project");

		LoginSession target = login("membership-stale-target@example.com", UserRole.USER);
		addMember(key, target.userId(), "MEMBER");

		// First change bumps version to 1.
		mockMvc.perform(patch("/api/projects/{key}/members/{userId}", key, target.userId())
				.cookie(admin.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"role":"VIEWER","expectedVersion":0}
						"""))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.version").value(1));

		// Stale PATCH with version 0.
		MvcResult stalePatch = mockMvc.perform(patch("/api/projects/{key}/members/{userId}", key, target.userId())
				.cookie(admin.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"role":"MEMBER","expectedVersion":0}
						"""))
				.andExpect(status().isConflict())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andReturn();
		JsonNode stalePatchBody = objectMapper.readTree(stalePatch.getResponse().getContentAsString());
		assertThat(stalePatchBody.get("code").asText()).isEqualTo("VERSION_CONFLICT");

		// Stale DELETE with version 0.
		MvcResult staleDelete = mockMvc.perform(delete("/api/projects/{key}/members/{userId}", key, target.userId())
				.cookie(admin.session())
				.header(admin.csrfHeader(), admin.csrfToken())
				.param("expectedVersion", "0"))
				.andExpect(status().isConflict())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andReturn();
		JsonNode staleDeleteBody = objectMapper.readTree(staleDelete.getResponse().getContentAsString());
		assertThat(staleDeleteBody.get("code").asText()).isEqualTo("VERSION_CONFLICT");
	}

	@Test
	void successfulMutationsIncrementAndPersistVersions() throws Exception {
		LoginSession admin = login("membership-versioning-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MVERS1", "Versioning project");

		LoginSession target = login("membership-versioning-target@example.com", UserRole.USER);

		// Add -> version 0
		MvcResult add = mockMvc.perform(post("/api/projects/{key}/members", key)
				.cookie(admin.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"email":"membership-versioning-target@example.com","role":"MEMBER"}
						"""))
				.andExpect(status().isCreated())
				.andReturn();
		JsonNode addBody = objectMapper.readTree(add.getResponse().getContentAsString());
		assertThat(addBody.get("version").asLong()).isEqualTo(0L);

		// Change -> version 1
		MvcResult change = mockMvc.perform(patch("/api/projects/{key}/members/{userId}", key, target.userId())
				.cookie(admin.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"role":"VIEWER","expectedVersion":0}
						"""))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode changeBody = objectMapper.readTree(change.getResponse().getContentAsString());
		assertThat(changeBody.get("version").asLong()).isEqualTo(1L);

		// Persisted version is 1.
		Long persisted = jdbcTemplate.queryForObject(
				"SELECT pm.version FROM project_member pm"
						+ " JOIN project p ON p.id = pm.project_id"
						+ " WHERE p.key = ? AND pm.user_account_id = ?",
				Long.class, key, target.userId());
		assertThat(persisted).isEqualTo(1L);
	}

	@Test
	void unrelatedIntegrityViolationIsNotLabeledMemberAlreadyExists() throws Exception {
		LoginSession admin = login("membership-unrelated-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MUNRL1", "Unrelated project");

		// Attempt to add a member with a role that violates the DB check
		// constraint (not the unique project/user constraint). This must not be
		// reported as MEMBER_ALREADY_EXISTS.
		MvcResult result = mockMvc.perform(post("/api/projects/{key}/members", key)
				.cookie(admin.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(admin.csrfHeader(), admin.csrfToken())
				.content("""
						{"email":"someone@example.com","role":"OWNER"}
						"""))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
				.andReturn();

		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		assertThat(body.get("code").asText()).isEqualTo("VALIDATION_FAILED");
	}

	@Test
	void memberListIsDeterministicAndOrderedByNormalizedEmail() throws Exception {
		LoginSession admin = login("membership-order-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "MORD01", "Order project");

		LoginSession zeta = login("zeta@example.com", UserRole.USER);
		LoginSession alpha = login("alpha@example.com", UserRole.USER);
		LoginSession beta = login("beta@example.com", UserRole.USER);
		addMember(key, zeta.userId(), "MEMBER");
		addMember(key, alpha.userId(), "VIEWER");
		addMember(key, beta.userId(), "MEMBER");

		MvcResult list = mockMvc.perform(get("/api/projects/{key}/members", key)
				.cookie(admin.session()))
				.andExpect(status().isOk())
				.andReturn();

		JsonNode body = objectMapper.readTree(list.getResponse().getContentAsString());
		assertThat(body.size()).isEqualTo(4);
		assertThat(body.get(0).get("email").asText()).isEqualTo("alpha@example.com");
		assertThat(body.get(1).get("email").asText()).isEqualTo("beta@example.com");
		assertThat(body.get(2).get("email").asText()).isEqualTo("membership-order-admin@example.com");
		assertThat(body.get(3).get("email").asText()).isEqualTo("zeta@example.com");
	}

	// --- Helpers ---

	private String createProject(LoginSession session, String key, String name) throws Exception {
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
		JsonNode csrfAfterBody = objectMapper.readTree(csrfAfter.getResponse().getContentAsString());

		return new LoginSession(
				account.getId(),
				postLoginSession,
				csrfAfterBody.get("headerName").asText(),
				csrfAfterBody.get("token").asText());
	}

	private record LoginSession(UUID userId, Cookie session, String csrfHeader, String csrfToken) {
	}

}