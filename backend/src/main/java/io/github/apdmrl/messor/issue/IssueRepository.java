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
	/**
	 * Returns a page of a project's issues matching the optional
	 * type/status/assignee/archive filters. The archived predicate is
	 * {@code null} for ALL, {@code false} for ACTIVE (default) and {@code true}
	 * for ARCHIVED. The assignee filter is applied only when non-null; an
	 * assignee that is not a current member of the project matches no issue (an
	 * issue's assignee is always a member), so the result is safely empty. The
	 * ordering comes from the caller-constructed {@link Pageable}, built from a
	 * validated allowlist field plus a final globally-unique {@code id ASC}
	 * tie-breaker.
	 */
	@Query("""
			select i from Issue i
			where i.project.id = :projectId
			  and (:type is null or i.type = :type)
			  and (:statusCode is null or i.workflowStatus.code = :statusCode)
			  and (:assigneeId is null or i.assignee.id = :assigneeId)
			  and (:archived is null or i.archived = :archived)
			""")
	Page<Issue> findProjectIssues(@Param("projectId") UUID projectId,
			@Param("type") IssueType type,
			@Param("statusCode") String statusCode,
			@Param("assigneeId") UUID assigneeId,
			@Param("archived") Boolean archived, Pageable pageable);

	/**
	 * Returns a page of issues assigned to {@code userId} across every project
	 * (the ORG_ADMIN case, which may access all projects). The archived predicate
	 * is {@code null} for ALL, {@code false} for ACTIVE (default) and {@code true}
	 * for ARCHIVED. Optional project/type/status filters are applied only when
	 * their parameter is non-null. Ordering comes from the caller-constructed
	 * {@link Pageable}, which is built from a validated allowlist field plus a
	 * deterministic secondary {@code number ASC} tie-breaker.
	 */
	@Query("""
			select i from Issue i
			where i.assignee.id = :userId
			  and (:projectKey is null or i.project.key = :projectKey)
			  and (:type is null or i.type = :type)
			  and (:statusCode is null or i.workflowStatus.code = :statusCode)
			  and (:archived is null or i.archived = :archived)
			""")
	Page<Issue> findMyWork(@Param("userId") UUID userId,
			@Param("projectKey") String projectKey,
			@Param("type") IssueType type,
			@Param("statusCode") String statusCode,
			@Param("archived") Boolean archived, Pageable pageable);

	/**
	 * Same as {@link #findMyWork(UUID, String, IssueType, String, Boolean, Pageable)}
	 * but additionally restricts the result to projects the principal currently
	 * belongs to (the non-admin case). Issues assigned to the principal in a
	 * project whose membership was removed, or where they were never a member,
	 * are safely excluded by the membership subquery.
	 */
	@Query("""
			select i from Issue i
			where i.assignee.id = :userId
			  and (:projectKey is null or i.project.key = :projectKey)
			  and (:type is null or i.type = :type)
			  and (:statusCode is null or i.workflowStatus.code = :statusCode)
			  and (:archived is null or i.archived = :archived)
			  and i.project.id in (
			    select pm.project.id from ProjectMember pm where pm.user.id = :userId)
			""")
	Page<Issue> findMyWorkInMemberProjects(@Param("userId") UUID userId,
			@Param("projectKey") String projectKey,
			@Param("type") IssueType type,
			@Param("statusCode") String statusCode,
			@Param("archived") Boolean archived, Pageable pageable);

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
