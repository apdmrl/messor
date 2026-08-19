package io.github.apdmrl.messor.issue;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Repository for {@link IssueActivity}.
 */
public interface IssueActivityRepository extends JpaRepository<IssueActivity, UUID> {

	/**
	 * Returns the activities of an issue ordered deterministically by
	 * {@code createdAt} ascending and then {@code id} ascending, matching the
	 * {@code (issue_id, created_at, id)} index. Activity is append-only, so this
	 * order is stable for the lifetime of an issue.
	 */
	List<IssueActivity> findByIssueIdOrderByCreatedAtAscIdAsc(UUID issueId);

}
