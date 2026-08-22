package io.github.apdmrl.messor.comment;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

/**
 * Repository for {@link IssueComment}.
 */
public interface IssueCommentRepository extends JpaRepository<IssueComment, UUID> {

	/**
	 * Returns every comment (active and tombstone) of the issue, in stable
	 * created-at-then-id order so deleted comments keep their original position.
	 */
	List<IssueComment> findByIssueIdOrderByCreatedAtAscIdAsc(UUID issueId);

	/**
	 * Loads a single comment row with a pessimistic write lock
	 * ({@code SELECT ... FOR UPDATE}) and returns the authoritative committed
	 * state. Used by update/delete so two concurrent requests carrying the same
	 * expectedVersion serialize: the first winner commits and the stale waiter,
	 * which blocks until that commit, re-reads the incremented version and fails
	 * with a version conflict.
	 */
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("select c from IssueComment c where c.id = :id")
	Optional<IssueComment> lockById(@Param("id") UUID id);

}
