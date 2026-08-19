package io.github.apdmrl.messor.issue;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

/**
 * Repository for the per-project issue number counter.
 *
 * <p>Counter rows are lazily initialized with a PostgreSQL
 * {@code INSERT ... ON CONFLICT DO NOTHING} so there is no check-then-insert
 * race, then locked with {@code PESSIMISTIC_WRITE} ({@code SELECT FOR UPDATE})
 * before the next number is read and advanced. All of this happens inside the
 * same transaction that inserts the issue and its activity.</p>
 */
public interface ProjectIssueCounterRepository extends JpaRepository<ProjectIssueCounter, UUID> {

	/**
	 * Inserts a counter row for the project if one does not already exist. The
	 * {@code ON CONFLICT DO NOTHING} makes the lazy initialization race-free:
	 * concurrent first-creates for the same project cannot both fail on a
	 * duplicate primary key.
	 */
	@Modifying
	@Query(value = """
			INSERT INTO project_issue_counter (project_id)
			VALUES (:projectId)
			ON CONFLICT (project_id) DO NOTHING
			""", nativeQuery = true)
	void insertIfAbsent(@Param("projectId") UUID projectId);

	/**
	 * Locks the project's counter row with a pessimistic write lock so the
	 * read-and-advance of {@code next_number} is atomic under concurrency.
	 */
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("select pc from ProjectIssueCounter pc where pc.projectId = :projectId")
	Optional<ProjectIssueCounter> lockByProjectId(@Param("projectId") UUID projectId);

}
