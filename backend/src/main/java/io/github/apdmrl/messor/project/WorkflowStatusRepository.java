package io.github.apdmrl.messor.project;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

public interface WorkflowStatusRepository extends JpaRepository<WorkflowStatus, UUID> {

	List<WorkflowStatus> findByProjectIdOrderByPositionAsc(UUID projectId);

	/**
	 * Locks the workflow status row of a project with the given code using a
	 * pessimistic write lock. Used to serialize destination ordering (rank
	 * allocation) for issues created into that status.
	 */
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("""
			select ws from WorkflowStatus ws
			where ws.project.id = :projectId and ws.code = :code
			""")
	Optional<WorkflowStatus> lockByProjectIdAndCode(@Param("projectId") UUID projectId,
			@Param("code") String code);

	/**
	 * Locks every workflow status row of a project in deterministic
	 * position-then-id order using pessimistic write locks. This serializes move
	 * and create operations that share a project's status set with a consistent
	 * per-project lock order, preventing cross-column lock inversion. A project
	 * has only three default statuses, and independent projects lock disjoint
	 * rows, so they never contend.
	 */
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("""
			select ws from WorkflowStatus ws
			where ws.project.id = :projectId
			order by ws.position asc, ws.id asc
			""")
	List<WorkflowStatus> lockAllByProjectIdOrderByPositionAscIdAsc(
			@Param("projectId") UUID projectId);

}
