package io.github.apdmrl.messor.issue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Comparator;
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

/**
 * RED-phase concurrency contract test for issue creation.
 *
 * <p>This test asserts deterministic concurrency guarantees for the locked
 * create contract: monotonic project-scoped numbering, distinct initial ranks,
 * and independent per-project counters. In the current RED phase the issue
 * endpoint/domain production code does not exist, so every scenario is expected
 * to fail with a 404/405 rather than a broken fixture or a hanging harness.</p>
 *
 * <p>Concurrency is deterministic: an {@link ExecutorService} launches tasks
 * behind a {@link CountDownLatch} start gate, every result/failure is collected
 * via {@link Future}s, and a single bounded shared deadline is used only to
 * prevent deadlock. No sleeps are used. All fixtures use synthetic
 * UUIDs/titles; no tokens, cookies, passwords or headers are logged or
 * asserted.</p>
 */
@AutoConfigureMockMvc
class IssueConcurrencyIT extends PostgresIntegrationTestSupport {

	private static final int CONCURRENCY = 12;
	private static final long DEADLOCK_TIMEOUT_SECONDS = 60;

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
	void cleanIssueData() {
		cleanupAllRows();
	}

	@AfterEach
	void cleanIssueDataAfter() {
		cleanupAllRows();
	}

	// ------------------------------------------------------------------
	// Concurrent monotonic allocation
	// ------------------------------------------------------------------

	@Test
	void concurrentCreatesAllocateMonotonicNumbersAndKeys() throws Exception {
		LoginSession admin = login("concurrency-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CONCUR1", "Concurrent project");

		// Launch CONCURRENCY concurrent create requests behind a start gate.
		List<CreateResult> results = runConcurrentCreates(key, admin, CONCURRENCY);

		// Every request returns 201.
		assertThat(results).hasSize(CONCURRENCY);
		for (CreateResult result : results) {
			assertThat(result.status()).as("create status for %s", result.title()).isEqualTo(201);
		}

		// Numbers are exactly 1..12 without duplicates.
		List<Long> numbers = results.stream()
				.map(CreateResult::number)
				.sorted()
				.toList();
		List<Long> expectedNumbers = new ArrayList<>();
		for (int i = 1; i <= CONCURRENCY; i++) {
			expectedNumbers.add((long) i);
		}
		assertThat(numbers).containsExactlyElementsOf(expectedNumbers);

		// Issue keys are exactly PROJECT-1..PROJECT-12, compared by numeric suffix
		// (not lexicographic String order, which would misorder 10, 11, 12).
		List<String> keys = results.stream()
				.map(CreateResult::issueKey)
				.sorted(Comparator.comparingLong(IssueConcurrencyIT::keyNumber))
				.toList();
		List<String> expectedKeys = new ArrayList<>();
		for (int i = 1; i <= CONCURRENCY; i++) {
			expectedKeys.add("CONCUR1-" + i);
		}
		assertThat(keys).containsExactlyElementsOf(expectedKeys);

		// Counter advanced to 13.
		Long nextNumber = jdbcTemplate.queryForObject(
				"SELECT next_number FROM project_issue_counter"
						+ " WHERE project_id = (SELECT id FROM project WHERE key = ?)",
				Long.class, key);
		assertThat(nextNumber).isEqualTo(CONCURRENCY + 1L);

		// Exactly CONCURRENCY CREATED activity rows.
		Integer activityCount = jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM issue_activity ia"
						+ " JOIN issue i ON i.id = ia.issue_id"
						+ " JOIN project p ON p.id = i.project_id"
						+ " WHERE p.key = ? AND ia.type = 'CREATED'",
				Integer.class, key);
		assertThat(activityCount).isEqualTo(CONCURRENCY);
	}

	@Test
	void concurrentCreatesAllocateDistinctOrderedInitialRanks() throws Exception {
		LoginSession admin = login("concurrency-rank-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CONCUR2", "Rank project");

		List<CreateResult> results = runConcurrentCreates(key, admin, CONCURRENCY);
		assertAllCreated(results);

		// All created in TO_DO with distinct active ranks.
		List<Long> ranks = results.stream()
				.map(CreateResult::rank)
				.sorted()
				.toList();
		assertThat(ranks).doesNotHaveDuplicates();
		assertThat(ranks).hasSize(CONCURRENCY);

		// Ordered ranks are exactly 1024, 2048, ..., 12288.
		List<Long> expectedRanks = new ArrayList<>();
		for (int i = 1; i <= CONCURRENCY; i++) {
			expectedRanks.add(1024L * i);
		}
		assertThat(ranks).containsExactlyElementsOf(expectedRanks);

		// Persisted ranks match the response ranks.
		List<Long> persistedRanks = jdbcTemplate.queryForList(
				"SELECT rank FROM issue i JOIN project p ON p.id = i.project_id"
						+ " WHERE p.key = ? ORDER BY rank",
				Long.class, key);
		assertThat(persistedRanks).containsExactlyElementsOf(expectedRanks);
	}

	@Test
	void concurrentCreatesInTwoProjectsUseIndependentCounters() throws Exception {
		LoginSession admin = login("concurrency-two-admin@example.com", UserRole.ORG_ADMIN);
		String keyA = createProject(admin, "CONCUR3", "Project A");
		String keyB = createProject(admin, "CONCUR4", "Project B");

		// One shared executor and one shared start gate so both projects' creates
		// are submitted together and released at once to run genuinely
		// concurrently against their independent counters.
		ExecutorService executor = Executors.newFixedThreadPool(2 * CONCURRENCY);
		long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(DEADLOCK_TIMEOUT_SECONDS);
		try {
			CountDownLatch sharedGate = new CountDownLatch(1);
			List<Future<CreateResult>> futuresA =
					submitCreates(executor, keyA, admin, CONCURRENCY, sharedGate, deadline);
			List<Future<CreateResult>> futuresB =
					submitCreates(executor, keyB, admin, CONCURRENCY, sharedGate, deadline);
			sharedGate.countDown();
			List<CreateResult> resultsA = awaitCreates(futuresA, deadline);
			List<CreateResult> resultsB = awaitCreates(futuresB, deadline);
			assertAllCreated(resultsA);
			assertAllCreated(resultsB);
			assertIndependentCounters(keyA, keyB, resultsA, resultsB);
		}
		finally {
			shutdownExecutor(executor, deadline);
		}
	}

	// ------------------------------------------------------------------
	// Flush-time optimistic races (PATCH/PATCH and PATCH/archive)
	// ------------------------------------------------------------------

	/**
	 * Two concurrent PATCH requests with the same {@code expectedVersion=0} must
	 * yield exactly one winner (200) and one loser (409 VERSION_CONFLICT). Both
	 * requests pass the application-level expectedVersion check and reach their
	 * versioned UPDATE before either completes; the loser's flush-time optimistic
	 * collision must be translated to the exact safe conflict contract.
	 *
	 * <p>Determinism: a separate JDBC transaction holds {@code SELECT ... FOR
	 * UPDATE} on the target issue row, so both HTTP requests block on their
	 * versioned UPDATE. The test polls {@code pg_stat_activity} with one bounded
	 * absolute deadline until PostgreSQL reports both request sessions blocked,
	 * then releases the held row lock and collects both responses with the same
	 * deadline. No sleeps are used to make the race happen.</p>
	 */
	@Test
	void concurrentPatchRequestsWithSameVersionYieldOneWinnerAndOneVersionConflict()
			throws Exception {
		LoginSession admin = login("concurrency-patch-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CONCUR5", "Patch race");
		LoginSession memberA = login("concurrency-patch-a@example.com", UserRole.USER);
		addMember(key, memberA.userId(), "MEMBER");
		LoginSession memberB = login("concurrency-patch-b@example.com", UserRole.USER);
		addMember(key, memberB.userId(), "MEMBER");
		String issueKey = createIssue(admin, key, "STORY", "Original title", "desc", null);

		Long counterBefore = counterNextNumber(key);

		try (Connection lockConn = dataSource.getConnection()) {
			lockConn.setAutoCommit(false);
			long lockPid = lockIssueRow(lockConn, issueKey);

			ExecutorService executor = Executors.newFixedThreadPool(2);
			long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(DEADLOCK_TIMEOUT_SECONDS);
			try {
				CountDownLatch startGate = new CountDownLatch(1);
				Future<MvcResult> f1 = executor.submit(() -> {
					awaitGate(startGate, deadline);
					return performPatch(issueKey, memberA, "Winner title", "desc", null, 0L);
				});
				Future<MvcResult> f2 = executor.submit(() -> {
					awaitGate(startGate, deadline);
					return performPatch(issueKey, memberB, "Loser title", "desc", null, 0L);
				});
				startGate.countDown();

				// Both requests must pass the expectedVersion check and reach their
				// versioned UPDATE, blocking on the held row lock.
				awaitBlockedSessions(lockPid, 2, deadline);

				// Release the held row lock so exactly one request wins the race.
				lockConn.rollback();

				MvcResult r1 = f1.get(remaining(deadline), TimeUnit.NANOSECONDS);
				MvcResult r2 = f2.get(remaining(deadline), TimeUnit.NANOSECONDS);

				MvcResult winner = r1.getResponse().getStatus() == 200 ? r1 : r2;
				MvcResult loser = winner == r1 ? r2 : r1;
				assertThat(winner.getResponse().getStatus()).isEqualTo(200);
				assertThat(loser.getResponse().getStatus()).isEqualTo(409);
				JsonNode loserBody = objectMapper.readTree(loser.getResponse().getContentAsString());
				assertThat(loserBody.get("code").asText()).isEqualTo("VERSION_CONFLICT");
				assertThat(loserBody.get("detail").asText())
						.isEqualTo("Kayıt başka bir işlem tarafından güncellendi.");

				// Final issue version is exactly 1 and the title is the winner's.
				Map<String, Object> row = jdbcTemplate.queryForMap(
						"SELECT title, version, archived FROM issue WHERE human_key = ?",
						issueKey);
				assertThat(row.get("version")).isEqualTo(1L);
				assertThat(row.get("title")).isEqualTo(winnerTitle(winner));
				assertThat(row.get("archived")).isEqualTo(false);

				// Exactly one UPDATED activity after CREATED; no losing activity.
				List<Map<String, Object>> activities = jdbcTemplate.queryForList(
						"SELECT ia.type FROM issue_activity ia"
								+ " JOIN issue i ON i.id = ia.issue_id"
								+ " WHERE i.human_key = ? ORDER BY ia.created_at, ia.id",
						issueKey);
				assertThat(activities).hasSize(2);
				assertThat(activities.get(0).get("type")).isEqualTo("CREATED");
				assertThat(activities.get(1).get("type")).isEqualTo("UPDATED");

				// PATCH must never allocate an issue number.
				assertCounterUnchanged(counterBefore, key);
			}
			finally {
				shutdownExecutor(executor, deadline);
			}
		}
	}

	/**
	 * A concurrent PATCH and archive with the same {@code expectedVersion=0} must
	 * yield exactly one winner (200) and one loser (409 VERSION_CONFLICT). Both
	 * requests pass the application-level expectedVersion check and reach their
	 * versioned UPDATE before either completes. Exactly one lifecycle activity
	 * (UPDATED or ARCHIVED, matching the winner) is appended after CREATED; the
	 * loser appends nothing.
	 */
	@Test
	void concurrentPatchAndArchiveWithSameVersionYieldOneWinnerAndOneVersionConflict()
			throws Exception {
		LoginSession admin = login("concurrency-patcharch-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CONCUR6", "Patch/archive race");
		LoginSession memberA = login("concurrency-patcharch-a@example.com", UserRole.USER);
		addMember(key, memberA.userId(), "MEMBER");
		LoginSession memberB = login("concurrency-patcharch-b@example.com", UserRole.USER);
		addMember(key, memberB.userId(), "MEMBER");
		String issueKey = createIssue(admin, key, "STORY", "Original title", "desc", null);

		Long counterBefore = counterNextNumber(key);

		try (Connection lockConn = dataSource.getConnection()) {
			lockConn.setAutoCommit(false);
			long lockPid = lockIssueRow(lockConn, issueKey);

			ExecutorService executor = Executors.newFixedThreadPool(2);
			long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(DEADLOCK_TIMEOUT_SECONDS);
			try {
				CountDownLatch startGate = new CountDownLatch(1);
				Future<MvcResult> f1 = executor.submit(() -> {
					awaitGate(startGate, deadline);
					return performPatch(issueKey, memberA, "Winner title", "desc", null, 0L);
				});
				Future<MvcResult> f2 = executor.submit(() -> {
					awaitGate(startGate, deadline);
					return performArchive(issueKey, memberB, 0L);
				});
				startGate.countDown();

				awaitBlockedSessions(lockPid, 2, deadline);

				lockConn.rollback();

				MvcResult r1 = f1.get(remaining(deadline), TimeUnit.NANOSECONDS);
				MvcResult r2 = f2.get(remaining(deadline), TimeUnit.NANOSECONDS);

				MvcResult winner = r1.getResponse().getStatus() == 200 ? r1 : r2;
				MvcResult loser = winner == r1 ? r2 : r1;
				assertThat(winner.getResponse().getStatus()).isEqualTo(200);
				assertThat(loser.getResponse().getStatus()).isEqualTo(409);
				JsonNode loserBody = objectMapper.readTree(loser.getResponse().getContentAsString());
				assertThat(loserBody.get("code").asText()).isEqualTo("VERSION_CONFLICT");
				assertThat(loserBody.get("detail").asText())
						.isEqualTo("Kayıt başka bir işlem tarafından güncellendi.");

				// Final version is exactly 1.
				Map<String, Object> row = jdbcTemplate.queryForMap(
						"SELECT title, version, archived FROM issue WHERE human_key = ?",
						issueKey);
				assertThat(row.get("version")).isEqualTo(1L);

				// Exactly one lifecycle activity after CREATED, matching the winner.
				List<Map<String, Object>> activities = jdbcTemplate.queryForList(
						"SELECT ia.type FROM issue_activity ia"
								+ " JOIN issue i ON i.id = ia.issue_id"
								+ " WHERE i.human_key = ? ORDER BY ia.created_at, ia.id",
						issueKey);
				assertThat(activities).hasSize(2);
				assertThat(activities.get(0).get("type")).isEqualTo("CREATED");
				String winnerType = winnerType(winner);
				assertThat(activities.get(1).get("type")).isEqualTo(winnerType);

				// The winning response/DB state determines whether the issue is
				// updated or archived; immutable fields and counter are unchanged.
				if ("ARCHIVED".equals(winnerType)) {
					assertThat(row.get("archived")).isEqualTo(true);
					assertThat(row.get("title")).isEqualTo("Original title");
				}
				else {
					assertThat(row.get("archived")).isEqualTo(false);
					assertThat(row.get("title")).isEqualTo(winnerTitle(winner));
				}
				assertCounterUnchanged(counterBefore, key);
			}
			finally {
				shutdownExecutor(executor, deadline);
			}
		}
	}

	private void assertIndependentCounters(String keyA, String keyB,
			List<CreateResult> resultsA, List<CreateResult> resultsB) {
		// Each project independently starts from number 1.
		assertThat(resultsA.stream().map(CreateResult::number).sorted().toList())
				.containsExactlyElementsOf(sequence(1, CONCURRENCY));
		assertThat(resultsB.stream().map(CreateResult::number).sorted().toList())
				.containsExactlyElementsOf(sequence(1, CONCURRENCY));

		// Neither project's counter affects the other.
		Long nextA = counterNextNumber(keyA);
		Long nextB = counterNextNumber(keyB);
		assertThat(nextA).isEqualTo(CONCURRENCY + 1L);
		assertThat(nextB).isEqualTo(CONCURRENCY + 1L);

		// Keys are scoped per project, compared by numeric suffix.
		assertThat(resultsA.stream().map(CreateResult::issueKey)
				.sorted(Comparator.comparingLong(IssueConcurrencyIT::keyNumber)).toList())
				.containsExactlyElementsOf(sequenceKeys("CONCUR3", CONCURRENCY));
		assertThat(resultsB.stream().map(CreateResult::issueKey)
				.sorted(Comparator.comparingLong(IssueConcurrencyIT::keyNumber)).toList())
				.containsExactlyElementsOf(sequenceKeys("CONCUR4", CONCURRENCY));
	}

	// ------------------------------------------------------------------
	// Concurrent movement
	// ------------------------------------------------------------------

	/**
		* Two distinct issues move concurrently to the same destination. Both requests
		* are independent and their expected versions remain valid, so exactly two
		* HTTP 200 responses are required (never two conflicts or zero successes).
		* The destination status row is locked in a separate JDBC transaction before
		* the start gate is released, so both requests deterministically block at the
		* database lock boundary; the lock is released only after both request
		* sessions are observed blocked. Each issue must reach the destination, both
		* must disappear from their source, and the destination membership/count,
		* ranks (exactly 1024 apart, positive, unique), MOVED activities and counter
		* are asserted exactly.
		*/
	@Test
	void concurrentDistinctIssuesAppendingToSameDestinationRemainOrdered() throws Exception {
		LoginSession admin = login("concurrency-moveappend-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CONCUR7", "Move append race");
		LoginSession memberA = login("concurrency-moveappend-a@example.com", UserRole.USER);
		addMember(key, memberA.userId(), "MEMBER");
		LoginSession memberB = login("concurrency-moveappend-b@example.com", UserRole.USER);
		addMember(key, memberB.userId(), "MEMBER");
		String issueA = createIssue(admin, key, "STORY", "Move A", "desc", null);
		String issueB = createIssue(admin, key, "TASK", "Move B", "desc", null);

		long versionA = issueVersion(issueA);
		long versionB = issueVersion(issueB);
		Long counterBefore = counterNextNumber(key);

		try (Connection lockConn = dataSource.getConnection()) {
			lockConn.setAutoCommit(false);
			long lockPid = lockWorkflowStatusRow(lockConn, key, "IN_PROGRESS");

			ExecutorService executor = Executors.newFixedThreadPool(2);
			long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(DEADLOCK_TIMEOUT_SECONDS);
			try {
				CountDownLatch startGate = new CountDownLatch(1);
				Future<MvcResult> f1 = executor.submit(() -> {
					awaitGate(startGate, deadline);
					return performMove(issueA, memberA, "IN_PROGRESS", null, null, versionA);
				});
				Future<MvcResult> f2 = executor.submit(() -> {
					awaitGate(startGate, deadline);
					return performMove(issueB, memberB, "IN_PROGRESS", null, null, versionB);
				});
				startGate.countDown();

				// Both requests must reach and block at the destination status lock.
				awaitBlockedOnLock(lockPid, 2, deadline, List.of(f1, f2));

				// Release the held status lock so both independent moves proceed.
				lockConn.rollback();

				MvcResult r1 = f1.get(remaining(deadline), TimeUnit.NANOSECONDS);
				MvcResult r2 = f2.get(remaining(deadline), TimeUnit.NANOSECONDS);

				// Both requests are independent; exactly two 200 responses are required.
				assertThat(r1.getResponse().getStatus()).isEqualTo(200);
				assertThat(r2.getResponse().getStatus()).isEqualTo(200);

				// Each issue reached the requested destination.
				assertThat(statusOf(issueA)).isEqualTo("IN_PROGRESS");
				assertThat(statusOf(issueB)).isEqualTo("IN_PROGRESS");

				// Both disappeared from their original source membership.
				assertThat(activeKeysInStatus(key, "TO_DO")).isEmpty();

				// Exact destination issue-key membership/count (no pre-existing
				// destination issues in this fixture).
				assertThat(activeKeysInStatus(key, "IN_PROGRESS"))
						.containsExactlyInAnyOrder(issueA, issueB);

				// Exact ranks 1024 apart, positive and unique.
				List<Long> ranks = ranksInStatus(key, "IN_PROGRESS");
				assertThat(ranks).hasSize(2);
				assertThat(ranks).doesNotHaveDuplicates();
				assertThat(ranks).allMatch(r -> r > 0);
				assertThat(Math.abs(ranks.get(0) - ranks.get(1))).isEqualTo(1024L);

				// Exactly one MOVED activity per moved issue and no unrelated activity.
				assertThat(activityTypes(issueA)).containsExactly("CREATED", "MOVED");
				assertThat(activityTypes(issueB)).containsExactly("CREATED", "MOVED");

				// Counter unchanged from the pre-request snapshot.
				assertCounterUnchanged(counterBefore, key);
			}
			finally {
				shutdownExecutor(executor, deadline);
			}
		}
	}

	/**
		* Two concurrent moves of the same issue with the same expectedVersion must
		* yield exactly one winner (200) and one loser (409 VERSION_CONFLICT), exactly
		* one MOVED activity, a final version incremented once, and a valid board
		* ordering. The destination status row is locked in a separate JDBC
		* transaction before the start gate is released, so both requests
		* deterministically block at the database lock boundary; the lock is released
		* only after both request sessions are observed blocked.
		*/
	@Test
	void concurrentMovesOfSameIssueYieldOneWinnerAndOneVersionConflict() throws Exception {
		LoginSession admin = login("concurrency-movesame-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CONCUR8", "Same issue move race");
		LoginSession memberA = login("concurrency-movesame-a@example.com", UserRole.USER);
		addMember(key, memberA.userId(), "MEMBER");
		LoginSession memberB = login("concurrency-movesame-b@example.com", UserRole.USER);
		addMember(key, memberB.userId(), "MEMBER");
		String issueKey = createIssue(admin, key, "STORY", "Same move", "desc", null);

		long version = issueVersion(issueKey);
		Long counterBefore = counterNextNumber(key);

		try (Connection lockConn = dataSource.getConnection()) {
			lockConn.setAutoCommit(false);
			long lockPid = lockWorkflowStatusRow(lockConn, key, "IN_PROGRESS");

			ExecutorService executor = Executors.newFixedThreadPool(2);
			long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(DEADLOCK_TIMEOUT_SECONDS);
			try {
				CountDownLatch startGate = new CountDownLatch(1);
				Future<MvcResult> f1 = executor.submit(() -> {
					awaitGate(startGate, deadline);
					return performMove(issueKey, memberA, "IN_PROGRESS", null, null, version);
				});
				Future<MvcResult> f2 = executor.submit(() -> {
					awaitGate(startGate, deadline);
					return performMove(issueKey, memberB, "IN_PROGRESS", null, null, version);
				});
				startGate.countDown();

				// Both requests must reach and block at the destination status lock.
				awaitBlockedOnLock(lockPid, 2, deadline, List.of(f1, f2));

				// Release the held status lock so exactly one request wins the race.
				lockConn.rollback();

				MvcResult r1 = f1.get(remaining(deadline), TimeUnit.NANOSECONDS);
				MvcResult r2 = f2.get(remaining(deadline), TimeUnit.NANOSECONDS);

				// Exactly one 200 and exactly one 409 VERSION_CONFLICT with exact detail.
				MvcResult winner = r1.getResponse().getStatus() == 200 ? r1 : r2;
				MvcResult loser = winner == r1 ? r2 : r1;
				assertThat(winner.getResponse().getStatus()).isEqualTo(200);
				assertThat(loser.getResponse().getStatus()).isEqualTo(409);
				JsonNode loserBody = objectMapper.readTree(loser.getResponse().getContentAsString());
				assertThat(loserBody.get("code").asText()).isEqualTo("VERSION_CONFLICT");
				assertThat(loserBody.get("detail").asText())
						.isEqualTo("Kayıt başka bir işlem tarafından güncellendi.");

				// Final moving issue workflow status is the requested destination.
				assertThat(statusOf(issueKey)).isEqualTo("IN_PROGRESS");

				// Issue is absent from source and present exactly once in destination.
				assertThat(activeKeysInStatus(key, "TO_DO")).isEmpty();
				assertThat(activeKeysInStatus(key, "IN_PROGRESS")).containsExactly(issueKey);

				// Final rank is the exact expected destination rank.
				assertThat(rankOf(issueKey)).isEqualTo(1024L);

				// Version increments exactly once.
				assertThat(issueVersion(issueKey)).isEqualTo(version + 1);

				// Exactly one MOVED activity after CREATED.
				assertThat(activityTypes(issueKey)).containsExactly("CREATED", "MOVED");

				// Board membership/count and ordering are exact, not vacuous.
				assertThat(activeKeysInStatus(key, "IN_PROGRESS")).containsExactly(issueKey);

				// Counter unchanged from the pre-request snapshot.
				assertCounterUnchanged(counterBefore, key);
			}
			finally {
				shutdownExecutor(executor, deadline);
			}
		}
	}

	/**
		* Two distinct issues exchange columns concurrently. At least one HTTP 200 is
		* required; zero successful moves is never permitted. The outcome may be two
		* successes (when neither transaction invalidates the other issue's version)
		* or one success plus one safe VERSION_CONFLICT (when destination rank
		* rewriting makes the other request stale). Both affected status rows are
		* locked in one deterministic order from a separate JDBC transaction before
		* the start gate is released, so both requests deterministically block at the
		* database lock boundary. Exact issue-key membership across both columns,
		* positive unique ranks with exact 1024 spacing, activity counts matching
		* successful moves, and the unchanged counter are asserted.
		*/
	@Test
	void oppositeDirectionCrossColumnMovesDoNotDeadlockOrCorruptOrdering() throws Exception {
		LoginSession admin = login("concurrency-crossmove-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CONCUR9", "Cross move race");
		LoginSession memberA = login("concurrency-crossmove-a@example.com", UserRole.USER);
		addMember(key, memberA.userId(), "MEMBER");
		LoginSession memberB = login("concurrency-crossmove-b@example.com", UserRole.USER);
		addMember(key, memberB.userId(), "MEMBER");
		String issueA = createIssue(admin, key, "STORY", "Cross A", "desc", null);
		String issueB = createIssue(admin, key, "TASK", "Cross B", "desc", null);

		// A is in TO_DO, B is in IN_PROGRESS. They exchange columns concurrently.
		setIssueStatusAndRank(issueB, "IN_PROGRESS", 1024L);

		long versionA = issueVersion(issueA);
		long versionB = issueVersion(issueB);
		Long counterBefore = counterNextNumber(key);

		try (Connection lockConn = dataSource.getConnection()) {
			lockConn.setAutoCommit(false);
			// Lock both affected status rows in one deterministic order.
			long lockPid = lockWorkflowStatusRows(lockConn, key, "TO_DO", "IN_PROGRESS");

			ExecutorService executor = Executors.newFixedThreadPool(2);
			long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(DEADLOCK_TIMEOUT_SECONDS);
			try {
				CountDownLatch startGate = new CountDownLatch(1);
				Future<MvcResult> f1 = executor.submit(() -> {
					awaitGate(startGate, deadline);
					return performMove(issueA, memberA, "IN_PROGRESS", null, null, versionA);
				});
				Future<MvcResult> f2 = executor.submit(() -> {
					awaitGate(startGate, deadline);
					return performMove(issueB, memberB, "TO_DO", null, null, versionB);
				});
				startGate.countDown();

				// Both requests must reach and block at the status lock boundary.
				awaitBlockedOnLock(lockPid, 2, deadline, List.of(f1, f2));

				// Release the held status locks so the moves proceed.
				lockConn.rollback();

				MvcResult r1 = f1.get(remaining(deadline), TimeUnit.NANOSECONDS);
				MvcResult r2 = f2.get(remaining(deadline), TimeUnit.NANOSECONDS);

				// At least one 200; never zero successful moves.
				int successes = (r1.getResponse().getStatus() == 200 ? 1 : 0)
						+ (r2.getResponse().getStatus() == 200 ? 1 : 0);
				assertThat(successes).isGreaterThanOrEqualTo(1);

				// Every outcome must be a safe 200 or a safe 409 VERSION_CONFLICT.
				for (MvcResult r : List.of(r1, r2)) {
					int status = r.getResponse().getStatus();
					assertThat(status).isIn(200, 409);
					if (status == 409) {
						JsonNode body = objectMapper.readTree(r.getResponse().getContentAsString());
						assertThat(body.get("code").asText()).isEqualTo("VERSION_CONFLICT");
					}
				}

				// Per-result: a success places the issue in its requested destination
				// with one MOVED activity; a conflict leaves it in its original state
				// with no MOVED activity.
				assertMoveOutcome(r1, issueA, "IN_PROGRESS", "TO_DO");
				assertMoveOutcome(r2, issueB, "TO_DO", "IN_PROGRESS");

				// Exact issue-key membership across both columns based on the observed
				// result pair; every issue appears exactly once across the two columns.
				List<String> todo = activeKeysInStatus(key, "TO_DO");
				List<String> inProgress = activeKeysInStatus(key, "IN_PROGRESS");
				List<String> all = new ArrayList<>();
				all.addAll(todo);
				all.addAll(inProgress);
				assertThat(all).containsExactlyInAnyOrder(issueA, issueB);
				assertThat(all).doesNotHaveDuplicates();

				// Positive unique ranks with exact 1024 spacing within each active column.
				for (String statusCode : List.of("TO_DO", "IN_PROGRESS")) {
					List<Long> ranks = ranksInStatus(key, statusCode);
					assertThat(ranks).doesNotHaveDuplicates();
					assertThat(ranks).allMatch(r -> r > 0);
					for (int i = 1; i < ranks.size(); i++) {
						assertThat(ranks.get(i) - ranks.get(i - 1)).isEqualTo(1024L);
					}
				}

				// Activity count/types correspond exactly to successful moves.
				Integer movedCount = jdbcTemplate.queryForObject(
						"SELECT COUNT(*) FROM issue_activity ia"
								+ " JOIN issue i ON i.id = ia.issue_id"
								+ " JOIN project p ON p.id = i.project_id"
								+ " WHERE p.key = ? AND ia.type = 'MOVED'",
						Integer.class, key);
				assertThat(movedCount).isEqualTo(successes);

				// Counter unchanged from the pre-request snapshot.
				assertCounterUnchanged(counterBefore, key);
			}
			finally {
				shutdownExecutor(executor, deadline);
			}
		}
	}

	/**
	 * When an archive wins before a concurrent same-status no-op move of the same
	 * issue (both with {@code expectedVersion=0}), the move must be serialized
	 * after the archive and rejected with {@code 409 ISSUE_ARCHIVED}. The archive
	 * blocks on the held issue-row lock first; only then is the move launched and
	 * allowed to block behind it. After the lock is released, the archive commits
	 * (archived=true, version=1, exactly {@code CREATED, ARCHIVED} activities) and
	 * the stale no-op move must not succeed: no {@code MOVED} activity, no version
	 * or rank change, and no mutation of the status/rank or immutable fields.
	 *
	 * <p>Determinism: a separate JDBC transaction holds {@code SELECT ... FOR
	 * UPDATE} on the issue row. The archive is launched and its session observed
	 * blocked (so it is queued first), then the move is launched and observed
	 * blocked behind it. Both are proven queued via {@link #awaitBlockedSessions}
	 * using one bounded absolute deadline before the held lock is released.</p>
	 */
	@Test
	void concurrentArchiveWinsBeforeNoOpMoveReturnsIssueArchived() throws Exception {
		LoginSession admin = login("concurrency-archmove-admin@example.com", UserRole.ORG_ADMIN);
		String key = createProject(admin, "CONCUR10", "Archive/move race");
		LoginSession memberA = login("concurrency-archmove-a@example.com", UserRole.USER);
		addMember(key, memberA.userId(), "MEMBER");
		LoginSession memberB = login("concurrency-archmove-b@example.com", UserRole.USER);
		addMember(key, memberB.userId(), "MEMBER");
		String issueKey = createIssue(admin, key, "STORY", "Archived before no-op move", "desc",
				null);

		// Snapshot complete issue/activity/order/counter state before the race.
		long versionBefore = issueVersion(issueKey);
		String statusBefore = statusOf(issueKey);
		long rankBefore = rankOf(issueKey);
		List<String> todoBefore = activeKeysInStatus(key, "TO_DO");
		List<Long> ranksBefore = ranksInStatus(key, "TO_DO");
		List<String> activityBefore = activityTypes(issueKey);
		Long counterBefore = counterNextNumber(key);

		// The single active TO_DO issue is already last in its column.
		assertThat(statusBefore).isEqualTo("TO_DO");
		assertThat(todoBefore).containsExactly(issueKey);
		assertThat(ranksBefore).containsExactly(rankBefore);
		assertThat(activityBefore).containsExactly("CREATED");
		assertThat(versionBefore).isEqualTo(0L);

		try (Connection lockConn = dataSource.getConnection()) {
			lockConn.setAutoCommit(false);
			long lockPid = lockIssueRow(lockConn, issueKey);

			ExecutorService executor = Executors.newFixedThreadPool(2);
			long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(DEADLOCK_TIMEOUT_SECONDS);
			try {
				// Launch archive first and prove it is queued on the issue-row lock.
				CountDownLatch startGate = new CountDownLatch(1);
				Future<MvcResult> archiveFuture = executor.submit(() -> {
					awaitGate(startGate, deadline);
					return performArchive(issueKey, memberA, 0L);
				});
				startGate.countDown();
				awaitBlockedSessions(lockPid, 1, deadline);

				// Launch the same-status append/no-op move only after archive is
				// queued, then prove it is queued behind archive on the same lock.
				Future<MvcResult> moveFuture = executor.submit(() ->
						performMove(issueKey, memberB, "TO_DO", null, null, 0L));
				awaitBlockedSessions(lockPid, 2, deadline);

				// Release the held issue-row lock; archive is first in queue.
				lockConn.rollback();

				MvcResult archiveResult = archiveFuture.get(remaining(deadline),
						TimeUnit.NANOSECONDS);
				MvcResult moveResult = moveFuture.get(remaining(deadline),
						TimeUnit.NANOSECONDS);

				// Archive wins and returns 200.
				assertThat(archiveResult.getResponse().getStatus()).isEqualTo(200);
				JsonNode archiveBody = objectMapper.readTree(
						archiveResult.getResponse().getContentAsString());
				assertThat(archiveBody.get("archived").asBoolean()).isTrue();

				// The serialized no-op move is rejected as archived with exact detail.
				assertThat(moveResult.getResponse().getStatus()).isEqualTo(409);
				JsonNode moveBody = objectMapper.readTree(
						moveResult.getResponse().getContentAsString());
				assertThat(moveBody.get("code").asText()).isEqualTo("ISSUE_ARCHIVED");
				assertThat(moveBody.get("detail").asText())
						.isEqualTo("Arşivlenmiş iş değiştirilemez.");

				// Final archived=true and version incremented exactly once.
				Map<String, Object> row = jdbcTemplate.queryForMap(
						"SELECT version, archived FROM issue WHERE human_key = ?", issueKey);
				assertThat(row.get("archived")).isEqualTo(true);
				assertThat(row.get("version")).isEqualTo(1L);

				// Status, rank and immutable fields unchanged by the rejected move.
				assertThat(statusOf(issueKey)).isEqualTo(statusBefore);
				assertThat(rankOf(issueKey)).isEqualTo(rankBefore);

				// Activities exactly CREATED, ARCHIVED; no MOVED activity.
				assertThat(activityTypes(issueKey)).containsExactly("CREATED", "ARCHIVED");

				// Counter unchanged from the pre-request snapshot.
				assertCounterUnchanged(counterBefore, key);
			}
			finally {
				shutdownExecutor(executor, deadline);
			}
		}
	}

	// ------------------------------------------------------------------
	// Concurrency harness
	// ------------------------------------------------------------------

	/**
	 * Asserts that every create result returned HTTP 201. This is checked before
	 * any null-sensitive field access so a RED-phase 404/405 fails with a clear
	 * status assertion rather than a NullPointerException.
	 */
	private void assertAllCreated(List<CreateResult> results) {
		for (CreateResult result : results) {
			assertThat(result.status()).as("create status for %s", result.title()).isEqualTo(201);
		}
	}

	/**
	 * Launches {@code count} concurrent create requests for the given project
	 * using the given authenticated session, behind a fresh {@link CountDownLatch}
	 * start gate. The gate is released once all tasks are submitted.
	 */
	private List<CreateResult> runConcurrentCreates(String projectKey, LoginSession session,
			int count) throws Exception {
		ExecutorService executor = Executors.newFixedThreadPool(count);
		long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(DEADLOCK_TIMEOUT_SECONDS);
		try {
			CountDownLatch startGate = new CountDownLatch(1);
			List<Future<CreateResult>> futures =
					submitCreates(executor, projectKey, session, count, startGate, deadline);
			startGate.countDown();
			return awaitCreates(futures, deadline);
		}
		finally {
			shutdownExecutor(executor, deadline);
		}
	}

	/**
	 * Submits {@code count} create tasks for the given project to the supplied
	 * executor. Every task awaits the shared {@link CountDownLatch} start gate so
	 * callers can submit multiple batches (e.g. two projects) to the same
	 * executor and release them all at once to run genuinely concurrently.
	 */
	private List<Future<CreateResult>> submitCreates(ExecutorService executor, String projectKey,
			LoginSession session, int count, CountDownLatch startGate, long deadline) {
		List<Future<CreateResult>> futures = new ArrayList<>();
		for (int i = 0; i < count; i++) {
			final int index = i;
			futures.add(executor.submit((Callable<CreateResult>) () -> {
				awaitGate(startGate, deadline);
				return performCreate(projectKey, session, "Concurrent issue " + index);
			}));
		}
		return futures;
	}

	/**
	 * Waits for every future to complete using one bounded shared deadline
	 * computed once, so there are no stacked per-future waits and no arbitrary
	 * sleeps. Real task exceptions are preserved and rethrown via
	 * {@link Future#get()}.
	 */
	private List<CreateResult> awaitCreates(List<Future<CreateResult>> futures, long deadline)
			throws Exception {
		List<CreateResult> results = new ArrayList<>();
		for (Future<CreateResult> future : futures) {
			long remaining = deadline - System.nanoTime();
			if (remaining <= 0) {
				throw new AssertionError(
						"deadline elapsed before future completed: remaining=" + remaining + "ns");
			}
			results.add(future.get(remaining, TimeUnit.NANOSECONDS));
		}
		return results;
	}

	/**
	 * Awaits the shared start gate using only the remaining time from the single
	 * absolute deadline. Fails immediately with a clear diagnostic if the
	 * deadline has already elapsed or the gate is not released in time.
	 */
	private void awaitGate(CountDownLatch startGate, long deadline) throws InterruptedException {
		long remaining = deadline - System.nanoTime();
		if (remaining <= 0) {
			throw new AssertionError(
					"start gate deadline elapsed before release: remaining=" + remaining + "ns");
		}
		if (!startGate.await(remaining, TimeUnit.NANOSECONDS)) {
			throw new AssertionError("start gate was not released within the shared deadline");
		}
	}

	/**
	 * Shuts down the executor robustly on timeout/failure. Cancels outstanding
	 * tasks via {@link ExecutorService#shutdownNow()}, then gives termination its
	 * own short bounded cleanup budget (five seconds) after cancellation. Never
	 * throws, so cleanup cannot mask the original Future failure or timeout with a
	 * secondary assertion. The primary operation uses the single absolute
	 * {@code deadline}; this short budget is recovery-only.
	 */
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

	private CreateResult performCreate(String projectKey, LoginSession session, String title)
			throws Exception {
		MvcResult result = mockMvc.perform(post("/api/projects/{key}/issues", projectKey)
				.cookie(session.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(session.csrfHeader(), session.csrfToken())
				.content("""
						{"type":"STORY","title":"%s","description":null,"assigneeId":null}
						""".formatted(title)))
				.andReturn();

		int status = result.getResponse().getStatus();
		if (status != 201) {
			return new CreateResult(status, title, null, null, null);
		}
		JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
		return new CreateResult(
				status,
				title,
				body.get("issueKey").asText(),
				body.get("number").asLong(),
				body.get("rank").asLong());
	}

	private List<Long> sequence(int start, int count) {
		List<Long> values = new ArrayList<>();
		for (int i = 0; i < count; i++) {
			values.add((long) (start + i));
		}
		return values;
	}

	private List<String> sequenceKeys(String projectKey, int count) {
		List<String> keys = new ArrayList<>();
		for (int i = 1; i <= count; i++) {
			keys.add(projectKey + "-" + i);
		}
		return keys;
	}

	/**
	 * Extracts the numeric suffix of an issue key (e.g. {@code 12} from
	 * {@code CONCUR1-12}) so keys can be compared by number rather than by
	 * lexicographic String order.
	 */
	private static long keyNumber(String issueKey) {
		return Long.parseLong(issueKey.substring(issueKey.lastIndexOf('-') + 1));
	}

	private Long counterNextNumber(String projectKey) {
		return jdbcTemplate.queryForObject(
				"SELECT next_number FROM project_issue_counter"
						+ " WHERE project_id = (SELECT id FROM project WHERE key = ?)",
				Long.class, projectKey);
	}

	// ------------------------------------------------------------------
	// Optimistic-race helpers
	// ------------------------------------------------------------------

	/**
	 * Acquires {@code SELECT ... FOR UPDATE} on the target issue row in the given
	 * separate JDBC transaction and returns the backend PID of that connection.
	 * Holding this row lock forces both concurrent HTTP requests to block on their
	 * versioned UPDATE until the lock is released.
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
	 * blocked on a lock, using one absolute deadline. This proves both requests
	 * passed the application-level expectedVersion check and reached their
	 * versioned UPDATE before either completed. A blind fixed sleep is never used
	 * to make the race happen.
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
				+ " request session(s) blocked on the issue UPDATE within the deadline");
	}

	/**
	 * Acquires {@code SELECT ... FOR UPDATE} on the given project's workflow status
	 * row in the given separate JDBC transaction and returns the backend PID of
	 * that connection. Holding this status row lock forces concurrent move requests
	 * targeting that status to block at the database lock boundary until the lock
	 * is released.
	 */
	private long lockWorkflowStatusRow(Connection conn, String projectKey, String statusCode)
			throws Exception {
		try (PreparedStatement ps = conn.prepareStatement(
				"SELECT ws.id FROM workflow_status ws"
						+ " JOIN project p ON p.id = ws.project_id"
						+ " WHERE p.key = ? AND ws.code = ? FOR UPDATE")) {
			ps.setString(1, projectKey);
			ps.setString(2, statusCode);
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
	 * Acquires {@code SELECT ... FOR UPDATE} on multiple workflow status rows in
	 * the given deterministic order within one separate JDBC transaction and
	 * returns the backend PID of that connection. Used by the opposite-direction
	 * race to hold both affected status rows so both requests block at the
	 * database lock boundary.
	 */
	private long lockWorkflowStatusRows(Connection conn, String projectKey,
			String firstStatusCode, String secondStatusCode) throws Exception {
		lockWorkflowStatusRow(conn, projectKey, firstStatusCode);
		lockWorkflowStatusRow(conn, projectKey, secondStatusCode);
		try (Statement st = conn.createStatement();
				ResultSet rs = st.executeQuery("SELECT pg_backend_pid()")) {
			rs.next();
			return rs.getLong(1);
		}
	}

	/**
	 * Condition-based bounded polling: waits until PostgreSQL reports at least
	 * {@code expected} request sessions (other than the lock-holding connection)
	 * blocked on a lock held by {@code lockPid}, using one absolute deadline. This
	 * proves the request sessions reached and blocked at the database lock
	 * boundary before the held lock is released. If all the given futures complete
	 * before the deadline (e.g. the move endpoint is absent in the RED phase and
	 * returns 404/405 immediately), the method returns normally so the subsequent
	 * status assertions fail on the endpoint absence rather than on a polling
	 * timeout. A blind fixed sleep is never used to make the race happen.
	 *
	 * <p>PostgreSQL row-level ({@code SELECT ... FOR UPDATE}) waiters are
	 * recorded in {@code pg_locks} as non-granted {@code transactionid} locks (on
	 * the holder's transaction) rather than as a tuple lock that matches the
	 * holder's {@code relation}/{@code tuple}. Matching only on tuple locks would
	 * therefore miss real waiters. Blocking is instead detected the same way as
	 * {@link #awaitBlockedSessions}: any other active session whose
	 * {@code wait_event_type} is {@code Lock}. In these tests the only concurrent
	 * lock-waiting sessions are the submitted move requests.</p>
	 */
	private void awaitBlockedOnLock(long lockPid, int expected, long deadline,
			List<Future<MvcResult>> futures) throws Exception {
		while (System.nanoTime() < deadline) {
			Integer count = jdbcTemplate.queryForObject(
					"SELECT COUNT(*) FROM pg_stat_activity a"
							+ " WHERE a.pid <> ? AND a.wait_event_type = 'Lock'"
							+ " AND a.state = 'active'",
					Integer.class, lockPid);
			if (count != null && count >= expected) {
				return;
			}
			// If every future already completed, the endpoint is absent (RED) or the
			// requests finished without blocking; proceed so the status assertions
			// determine the outcome.
			boolean allDone = true;
			for (Future<MvcResult> f : futures) {
				if (!f.isDone()) {
					allDone = false;
					break;
				}
			}
			if (allDone) {
				return;
			}
			Thread.sleep(20L);
		}
		throw new AssertionError("expected " + expected
				+ " request session(s) blocked on the status lock within the deadline");
	}

	/**
	 * Returns the current workflow status code of an issue.
	 */
	private String statusOf(String issueKey) {
		return jdbcTemplate.queryForObject(
				"SELECT ws.code FROM issue i"
						+ " JOIN workflow_status ws ON ws.id = i.workflow_status_id"
						+ " WHERE i.human_key = ?",
				String.class, issueKey);
	}

	/**
	 * Returns the current rank of an issue.
	 */
	private long rankOf(String issueKey) {
		return jdbcTemplate.queryForObject(
				"SELECT rank FROM issue WHERE human_key = ?", Long.class, issueKey);
	}

	/**
	 * Returns the active (non-archived) issue keys in the given status ordered by
	 * ascending rank.
	 */
	private List<String> activeKeysInStatus(String projectKey, String statusCode) {
		return jdbcTemplate.queryForList(
				"SELECT i.human_key FROM issue i"
						+ " JOIN workflow_status ws ON ws.id = i.workflow_status_id"
						+ " JOIN project p ON p.id = i.project_id"
						+ " WHERE p.key = ? AND ws.code = ? AND i.archived = FALSE"
						+ " ORDER BY i.rank",
				String.class, projectKey, statusCode);
	}

	/**
	 * Returns the active (non-archived) ranks in the given status ordered by
	 * ascending rank.
	 */
	private List<Long> ranksInStatus(String projectKey, String statusCode) {
		return jdbcTemplate.queryForList(
				"SELECT i.rank FROM issue i"
						+ " JOIN workflow_status ws ON ws.id = i.workflow_status_id"
						+ " JOIN project p ON p.id = i.project_id"
						+ " WHERE p.key = ? AND ws.code = ? AND i.archived = FALSE"
						+ " ORDER BY i.rank",
				Long.class, projectKey, statusCode);
	}

	/**
	 * Returns the ordered activity types for an issue.
	 */
	private List<String> activityTypes(String issueKey) {
		return jdbcTemplate.queryForList(
				"SELECT ia.type FROM issue_activity ia"
						+ " JOIN issue i ON i.id = ia.issue_id"
						+ " WHERE i.human_key = ? ORDER BY ia.created_at, ia.id",
				String.class, issueKey);
	}

	/**
	 * Asserts a single move result's outcome: a 200 places the issue in its
	 * requested destination with exactly one MOVED activity; a 409 leaves it in
	 * its original status with no MOVED activity.
	 */
	private void assertMoveOutcome(MvcResult r, String issueKey, String requestedDest,
			String originalStatus) throws Exception {
		if (r.getResponse().getStatus() == 200) {
			assertThat(statusOf(issueKey)).isEqualTo(requestedDest);
			assertThat(activityTypes(issueKey)).containsExactly("CREATED", "MOVED");
		}
		else {
			assertThat(statusOf(issueKey)).isEqualTo(originalStatus);
			assertThat(activityTypes(issueKey)).containsExactly("CREATED");
		}
	}

	/**
	 * Returns the remaining nanoseconds from the single absolute deadline, failing
	 * immediately if it has already elapsed.
	 */
	private long remaining(long deadline) {
		long rem = deadline - System.nanoTime();
		if (rem <= 0) {
			throw new AssertionError("deadline elapsed before future completed");
		}
		return rem;
	}

	private MvcResult performPatch(String issueKey, LoginSession session, String title,
			String description, UUID assigneeId, long expectedVersion) throws Exception {
		String descJson = description == null ? "null" : "\"" + description + "\"";
		String assigneeJson = assigneeId == null ? "null" : "\"" + assigneeId + "\"";
		return mockMvc.perform(patch("/api/issues/{issueKey}", issueKey)
				.cookie(session.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(session.csrfHeader(), session.csrfToken())
				.content("""
						{"title":"%s","description":%s,"assigneeId":%s,"expectedVersion":%d}
						""".formatted(title, descJson, assigneeJson, expectedVersion)))
				.andReturn();
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

	/**
	 * Performs a move request against {@code PATCH /api/issues/{issueKey}/move}.
	 * The before/after neighbor keys may be null.
	 */
	private MvcResult performMove(String issueKey, LoginSession session, String targetStatusCode,
			String beforeIssueKey, String afterIssueKey, long expectedVersion) throws Exception {
		String beforeJson = beforeIssueKey == null ? "null" : "\"" + beforeIssueKey + "\"";
		String afterJson = afterIssueKey == null ? "null" : "\"" + afterIssueKey + "\"";
		return mockMvc.perform(patch("/api/issues/{issueKey}/move", issueKey)
				.cookie(session.session())
				.contentType(MediaType.APPLICATION_JSON)
				.header(session.csrfHeader(), session.csrfToken())
				.content("""
						{"targetStatusCode":"%s","beforeIssueKey":%s,
						 "afterIssueKey":%s,"expectedVersion":%d}
						""".formatted(targetStatusCode, beforeJson, afterJson, expectedVersion)))
				.andReturn();
	}

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
	 * exercising the move endpoint.
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
	 * Extracts the winning title from a 200 response body.
	 */
	private String winnerTitle(MvcResult winner) throws Exception {
		JsonNode body = objectMapper.readTree(winner.getResponse().getContentAsString());
		return body.get("title").asText();
	}

	/**
	 * Determines the winning operation type (UPDATED or ARCHIVED) from the winning
	 * response body's {@code archived} flag.
	 */
	private String winnerType(MvcResult winner) throws Exception {
		JsonNode body = objectMapper.readTree(winner.getResponse().getContentAsString());
		return body.get("archived").asBoolean() ? "ARCHIVED" : "UPDATED";
	}

	private String createIssue(LoginSession session, String projectKey, String type, String title,
			String description, UUID assigneeId) throws Exception {
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

	private void assertCounterUnchanged(Long before, String projectKey) {
		Long after = counterNextNumber(projectKey);
		assertThat(after).isEqualTo(before);
	}

	// ------------------------------------------------------------------
	// Helpers
	// ------------------------------------------------------------------

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

	private record CreateResult(int status, String title, String issueKey, Long number, Long rank) {
	}

}
