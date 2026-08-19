package io.github.apdmrl.messor.issue;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

/**
 * Repository for {@link Issue}.
 */
public interface IssueRepository extends JpaRepository<Issue, UUID> {

	/**
	 * Returns the issue with the exact immutable human issue key (e.g.
	 * {@code PROJ-1}), or empty when no such issue exists. The human key is
	 * globally unique, so at most one issue can match.
	 */
	Optional<Issue> findByHumanKey(String humanKey);

	/**
	 * Locks every active (non-archived) issue in the given project and workflow
	 * status in deterministic rank-then-id order using pessimistic write locks.
	 * Used by move to serialize destination column ordering after the project's
	 * status rows are locked.
	 */
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("""
			select i from Issue i
			where i.project.id = :projectId
			  and i.workflowStatus.id = :workflowStatusId
			  and i.archived = false
			order by i.rank asc, i.id asc
			""")
	List<Issue> lockActiveByProjectAndWorkflowStatusId(@Param("projectId") UUID projectId,
			@Param("workflowStatusId") UUID workflowStatusId);

	/**
	 * Returns a page of active (non-archived) issues of a project, ordered
	 * according to the caller-constructed {@link Pageable}. The predicate is
	 * constrained by project and archived flag so it aligns with the
	 * {@code (project_id, archived, number)} index. The ordering is built from a
	 * validated allowlist field/direction; an unvalidated client field is never
	 * passed into the query.
	 */
	@Query("""
			select i from Issue i
			where i.project.id = :projectId
			  and i.archived = false
			""")
	Page<Issue> findActiveByProject(@Param("projectId") UUID projectId, Pageable pageable);

	/**
	 * Returns the maximum active (non-archived) rank currently used in the given
	 * project and workflow status, or {@code 0} when no active issue exists
	 * there. Used to append a new issue after the current maximum with a positive
	 * spacing step. The predicate is constrained by project, workflow status and
	 * archived flag so it aligns with the
	 * {@code (project_id, workflow_status_id, archived, rank)} index.
	 */
	@Query("""
			select coalesce(max(i.rank), 0L) from Issue i
			where i.project.id = :projectId
			  and i.workflowStatus.id = :workflowStatusId
			  and i.archived = false
			""")
	long maxActiveRankByProjectAndWorkflowStatusId(@Param("projectId") UUID projectId,
			@Param("workflowStatusId") UUID workflowStatusId);

}
