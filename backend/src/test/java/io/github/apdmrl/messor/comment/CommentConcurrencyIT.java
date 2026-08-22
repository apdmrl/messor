package io.github.apdmrl.messor.comment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import javax.sql.DataSource;

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
class CommentConcurrencyIT extends PostgresIntegrationTestSupport {

	private static final int DEADLOCK_TIMEOUT_SECONDS = 60;

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

	@Autowired
	private DataSource dataSource;

	@BeforeEach
	void clean() {
		cleanupAllRows();
	}

	@AfterEach
	void cleanAfter() {
		cleanupAllRows();
	}

	@Test
	void concurrentUpdatesWithSameExpectedVersionHaveExactlyOneWinner() throws Exception {
		LoginSession admin = login("cc-upd-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CCU1", "Concurrent update");
		String issueKey = createIssue(admin, key);
		String commentId = createComment(admin, issueKey, "v0");

		List<Integer> statuses = runConcurrently(
				() -> patchComment(admin, commentId, "edited", 0),
				() -> patchComment(admin, commentId, "edited", 0));

		assertThat(statuses).containsExactlyInAnyOrder(200, 409);
		assertThat(statuses).contains(200);

		JsonNode finalComment = getComment(admin, commentId);
		assertThat(finalComment.get("deleted").asBoolean()).isFalse();
		assertThat(finalComment.get("body").asText()).isEqualTo("edited");
		assertThat(finalComment.get("version").asLong()).isEqualTo(1);
	}

	@Test
	void concurrentUpdateAndDeleteHaveExactlyOneEffectiveWinner() throws Exception {
		LoginSession admin = login("cc-upd-del-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CCU2", "Concurrent update/delete");
		String issueKey = createIssue(admin, key);
		String commentId = createComment(admin, issueKey, "v0");

		List<Integer> statuses = runConcurrently(
				() -> patchComment(admin, commentId, "edited", 0),
				() -> deleteComment(admin, commentId, 0));

		assertThat(statuses).hasSize(2);
		long successCount = statuses.stream().filter(s -> s == 200).count();
		long failureCount = statuses.stream().filter(s -> s == 409 || s == 404).count();
		assertThat(successCount).isEqualTo(1);
		assertThat(failureCount).isEqualTo(1);

		JsonNode finalComment = getComment(admin, commentId);
		assertThat(finalComment.get("version").asLong()).isEqualTo(1);
		// Exactly one effective winner: either the edit produced a body, or the
		// delete produced a tombstone -- never both and never neither.
		boolean edited = !finalComment.get("deleted").asBoolean();
		boolean tombstoned = finalComment.get("deleted").asBoolean();
		assertThat(edited ^ tombstoned).isTrue();
		if (!finalComment.get("deleted").asBoolean()) {
			assertThat(finalComment.get("body").asText()).isEqualTo("edited");
		} else {
			assertThat(finalComment.get("body").isNull()).isTrue();
		}
	}

	/**
	 * Comment create must never succeed on an issue that a concurrent archive
	 * archives first. The issue row is locked with {@code SELECT ... FOR UPDATE}
	 * in a separate JDBC transaction; the archive is launched and proven queued
	 * on that row lock, then the comment create is launched and proven queued
	 * behind it. Releasing the lock lets the archive (first in the FIFO queue)
	 * win: it commits the archive, and the create refreshes the archived flag and
	 * returns the safe {@code 404 ISSUE_NOT_FOUND}. No comment row is created.
	 *
	 * <p>Determinism uses PostgreSQL blocked-session observation
	 * ({@link #awaitBlockedSessions}) with a single bounded absolute deadline; no
	 * blind sleep forces the race.</p>
	 */
	@Test
	void concurrentArchiveWinsBeforeCommentCreateRejectsSafeNotFound() throws Exception {
		LoginSession admin = login("cc-arch-create-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CCCA1", "Archive/create race");
		LoginSession memberA = login("cc-arch-create-a@example.com", UserRole.USER);
		addMember(key, memberA.userId(), "MEMBER");
		LoginSession memberB = login("cc-arch-create-b@example.com", UserRole.USER);
		addMember(key, memberB.userId(), "MEMBER");
		String issueKey = createIssue(admin, key);

		try (Connection lockConn = dataSource.getConnection()) {
			lockConn.setAutoCommit(false);
			long lockPid = lockIssueRow(lockConn, issueKey);

			ExecutorService executor = Executors.newFixedThreadPool(2);
			long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(DEADLOCK_TIMEOUT_SECONDS);
			try {
				// Launch the archive first and prove it is queued on the row lock.
				CountDownLatch startGate = new CountDownLatch(1);
				Future<MvcResult> archiveFuture = executor.submit(() -> {
					awaitGate(startGate, deadline);
					return performArchive(issueKey, memberA, 0L);
				});
				startGate.countDown();
				awaitBlockedSessions(lockPid, 1, deadline);

				// Launch the comment create second and prove it queues behind.
				Future<MvcResult> createFuture = executor.submit(() ->
						performCreateComment(issueKey, memberB, "late comment"));
				awaitBlockedSessions(lockPid, 2, deadline);

				// Release the held row lock; the archive is first in the FIFO queue.
				lockConn.rollback();

				MvcResult archiveResult = archiveFuture.get(remaining(deadline),
						TimeUnit.NANOSECONDS);
				MvcResult createResult = createFuture.get(remaining(deadline),
						TimeUnit.NANOSECONDS);

				// Archive wins: 200 with archived=true.
				assertThat(archiveResult.getResponse().getStatus()).isEqualTo(200);
				JsonNode archiveBody = objectMapper.readTree(
						archiveResult.getResponse().getContentAsString());
				assertThat(archiveBody.get("archived").asBoolean()).isTrue();

				// The serialized create is rejected as a safe 404 ISSUE_NOT_FOUND.
				assertThat(createResult.getResponse().getStatus()).isEqualTo(404);
				JsonNode createBody = objectMapper.readTree(
						createResult.getResponse().getContentAsString());
				assertThat(createBody.get("code").asText()).isEqualTo("ISSUE_NOT_FOUND");

				// No comment row was ever created for the issue.
				Integer commentCount = jdbcTemplate.queryForObject("""
						SELECT COUNT(*) FROM issue_comment WHERE issue_id =
							(SELECT id FROM issue WHERE human_key = ?)
						""", Integer.class, issueKey);
				assertThat(commentCount).isEqualTo(0);

				// Issue is archived with version incremented once.
				Map<String, Object> row = jdbcTemplate.queryForMap(
						"SELECT version, archived FROM issue WHERE human_key = ?", issueKey);
				assertThat(row.get("archived")).isEqualTo(true);
				assertThat(row.get("version")).isEqualTo(1L);
			}
			finally {
				shutdownExecutor(executor, deadline);
			}
		}
	}

	/**
	 * The reverse linearization is also valid: if the comment create locks the
	 * issue row before the archive, the create may linearize first and succeed
	 * ({@code 201}), and only then does the archive proceed to archive the issue.
	 * This proves the lock serialization is fair and order-dependent rather than
	 * always rejecting the create.
	 */
	@Test
	void concurrentCommentCreateLockingFirstLinearizesBeforeArchive() throws Exception {
		LoginSession admin = login("cc-create-arch-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CCCA2", "Create/archive race");
		LoginSession memberA = login("cc-create-arch-a@example.com", UserRole.USER);
		addMember(key, memberA.userId(), "MEMBER");
		LoginSession memberB = login("cc-create-arch-b@example.com", UserRole.USER);
		addMember(key, memberB.userId(), "MEMBER");
		String issueKey = createIssue(admin, key);

		try (Connection lockConn = dataSource.getConnection()) {
			lockConn.setAutoCommit(false);
			long lockPid = lockIssueRow(lockConn, issueKey);

			ExecutorService executor = Executors.newFixedThreadPool(2);
			long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(DEADLOCK_TIMEOUT_SECONDS);
			try {
				// Launch the comment create first and prove it is queued on the lock.
				CountDownLatch startGate = new CountDownLatch(1);
				Future<MvcResult> createFuture = executor.submit(() -> {
					awaitGate(startGate, deadline);
					return performCreateComment(issueKey, memberA, "first comment");
				});
				startGate.countDown();
				awaitBlockedSessions(lockPid, 1, deadline);

				// Launch the archive second and prove it queues behind the create.
				Future<MvcResult> archiveFuture = executor.submit(() ->
						performArchive(issueKey, memberB, 0L));
				awaitBlockedSessions(lockPid, 2, deadline);

				lockConn.rollback();

				MvcResult createResult = createFuture.get(remaining(deadline),
						TimeUnit.NANOSECONDS);
				MvcResult archiveResult = archiveFuture.get(remaining(deadline),
						TimeUnit.NANOSECONDS);

				// The create won the row lock first and linearized before the archive.
				assertThat(createResult.getResponse().getStatus()).isEqualTo(201);
				JsonNode created = objectMapper.readTree(
						createResult.getResponse().getContentAsString());
				assertThat(created.get("body").asText()).isEqualTo("first comment");

				// The archive then proceeds and archives the issue.
				assertThat(archiveResult.getResponse().getStatus()).isEqualTo(200);
				JsonNode archiveBody = objectMapper.readTree(
						archiveResult.getResponse().getContentAsString());
				assertThat(archiveBody.get("archived").asBoolean()).isTrue();

				// Exactly one comment row exists for the issue.
				Integer commentCount = jdbcTemplate.queryForObject("""
						SELECT COUNT(*) FROM issue_comment WHERE issue_id =
							(SELECT id FROM issue WHERE human_key = ?)
						""", Integer.class, issueKey);
				assertThat(commentCount).isEqualTo(1);
			}
			finally {
				shutdownExecutor(executor, deadline);
			}
		}
	}

	// -------------------------------------------------------------- harness

	private void awaitGate(CountDownLatch startGate, long deadline)
			throws InterruptedException {
		long rem = deadline - System.nanoTime();
		if (rem <= 0) {
			throw new AssertionError("start gate deadline elapsed before release");
		}
		if (!startGate.await(rem, TimeUnit.NANOSECONDS)) {
			throw new AssertionError("start gate was not released within the shared deadline");
		}
	}

	private long remaining(long deadline) {
		long rem = deadline - System.nanoTime();
		if (rem <= 0) {
			throw new AssertionError("deadline elapsed before future completed");
		}
		return rem;
	}

	private void shutdownExecutor(ExecutorService executor, long deadline) {
		executor.shutdownNow();
		long cleanupBudget = TimeUnit.SECONDS.toNanos(5);
		try {
			executor.awaitTermination(cleanupBudget, TimeUnit.NANOSECONDS);
		}
		catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		}
	}

	private MvcResult performArchive(String issueKey, LoginSession session, long expectedVersion)
			throws Exception {
		return mockMvc.perform(post("/api/issues/{issueKey}/archive", issueKey)
				.cookie(session.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(session.csrfHeader(), session.csrfToken())
				.content("""
						{"expectedVersion":%d}
						""".formatted(expectedVersion)))
				.andReturn();
	}

	private MvcResult performCreateComment(String issueKey, LoginSession session, String body)
			throws Exception {
		return mockMvc.perform(post("/api/issues/{issueKey}/comments", issueKey)
				.cookie(session.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(session.csrfHeader(), session.csrfToken())
				.content("""
						{"body":"%s"}
						""".formatted(body)))
				.andReturn();
	}

	/**
	 * Acquires {@code SELECT ... FOR UPDATE} on the target issue row in a separate
	 * JDBC transaction and returns the backend PID of that connection, so both
	 * concurrent requests deterministically block on the row lock.
	 */
	private long lockIssueRow(Connection conn, String issueKey) throws Exception {
		try (PreparedStatement ps = conn.prepareStatement(
				"SELECT id FROM issue WHERE human_key = ? FOR UPDATE")) {
			ps.setString(1, issueKey);
			try (ResultSet rs = ps.executeQuery()) {
				assertThat(rs.next()).isTrue();
			}
		}
		try (Statement st = conn.createStatement();
				ResultSet rs = st.executeQuery("SELECT pg_backend_pid()")) {
			rs.next();
			return rs.getLong(1);
		}
	}

	/**
	 * Condition-based bounded polling: waits until PostgreSQL reports at least
	 * {@code expected} request sessions (other than the lock-holding connection)
	 * blocked on a lock, using one absolute deadline. Proves the request sessions
	 * reached the row-lock boundary before the lock is released. No blind sleep.
	 */
	private void awaitBlockedSessions(long lockPid, int expected, long deadline)
			throws Exception {
		while (System.nanoTime() < deadline) {
			Integer count = jdbcTemplate.queryForObject(
					"SELECT COUNT(*) FROM pg_stat_activity a"
							+ " WHERE a.pid <> ? AND a.wait_event_type = 'Lock'"
							+ " AND a.state = 'active'",
					Integer.class, lockPid);
			if (count != null && count >= expected) {
				return;
			}
			Thread.sleep(20L);
		}
		throw new AssertionError("expected " + expected
				+ " request session(s) blocked on the issue-row lock within the deadline");
	}

	private void addMember(String projectKey, UUID userId, String role) {
		jdbcTemplate.update("""
				INSERT INTO project_member (id, project_id, user_account_id, role)
				SELECT gen_random_uuid(), p.id, ?, ?
				FROM project p WHERE p.key = ?
				""", userId, role, projectKey);
	}

	private List<Integer> runConcurrently(Callable<Integer>... operations)
			throws Exception {
		ExecutorService executor = Executors.newFixedThreadPool(operations.length);
		long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(DEADLOCK_TIMEOUT_SECONDS);
		try {
			CountDownLatch startGate = new CountDownLatch(1);
			List<Future<Integer>> futures = new ArrayList<>();
			for (Callable<Integer> op : operations) {
				futures.add(executor.submit(() -> {
					startGate.await();
					return op.call();
				}));
			}
			startGate.countDown();
			List<Integer> results = new ArrayList<>();
			for (Future<Integer> future : futures) {
				long remaining = deadline - System.nanoTime();
				if (remaining <= 0) {
					throw new AssertionError("deadline elapsed before future completed");
				}
				results.add(future.get(remaining, TimeUnit.NANOSECONDS));
			}
			return results;
		}
		finally {
			executor.shutdownNow();
			executor.awaitTermination(5, TimeUnit.SECONDS);
		}
	}

	private int patchComment(LoginSession session, String commentId, String body,
			long expectedVersion) throws Exception {
		MvcResult result = mockMvc.perform(patch("/api/comments/{id}", commentId)
				.cookie(session.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(session.csrfHeader(), session.csrfToken())
				.content("""
						{"body":"%s","expectedVersion":%d}
						""".formatted(body, expectedVersion)))
				.andReturn();
		int status = result.getResponse().getStatus();
		// Never an unhandled 500.
		assertThat(status).isNotEqualTo(500);
		return status;
	}

	private int deleteComment(LoginSession session, String commentId, long expectedVersion)
			throws Exception {
		MvcResult result = mockMvc.perform(delete("/api/comments/{id}", commentId)
				.cookie(session.session())
				.header(session.csrfHeader(), session.csrfToken())
				.queryParam("expectedVersion", Long.toString(expectedVersion)))
				.andReturn();
		int status = result.getResponse().getStatus();
		assertThat(status).isNotEqualTo(500);
		return status;
	}

	private JsonNode getComment(LoginSession session, String commentId) throws Exception {
		String issueKey = jdbcTemplate.queryForObject("""
				SELECT i.human_key FROM issue_comment c JOIN issue i ON i.id = c.issue_id
				WHERE c.id = ?
				""", String.class, UUID.fromString(commentId));
		MvcResult result = mockMvc.perform(get("/api/issues/{key}/comments", issueKey)
				.cookie(session.session()))
				.andExpect(status().isOk())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		for (JsonNode node : body) {
			if (node.get("id").asText().equals(commentId)) {
				return node;
			}
		}
		throw new AssertionError("comment not found in list: " + commentId);
	}

	// ------------------------------------------------------------- fixtures

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

	private String createIssue(LoginSession session, String projectKey) throws Exception {
		MvcResult result = mockMvc.perform(post("/api/projects/{key}/issues", projectKey)
				.cookie(session.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(session.csrfHeader(), session.csrfToken())
				.content("""
						{"type":"TASK","title":"Concurrent","description":null,"assigneeId":null}
						"""))
				.andExpect(status().isCreated())
				.andReturn();
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		return body.get("issueKey").asText();
	}

	private String createComment(LoginSession session, String issueKey, String body)
			throws Exception {
		MvcResult result = mockMvc.perform(post("/api/issues/{key}/comments", issueKey)
				.cookie(session.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(session.csrfHeader(), session.csrfToken())
				.content("""
						{"body":"%s"}
						""".formatted(body)))
				.andExpect(status().isCreated())
				.andReturn();
		JsonNode bodyNode = objectMapper.readTree(result.getResponse().getContentAsString());
		return bodyNode.get("id").asText();
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
