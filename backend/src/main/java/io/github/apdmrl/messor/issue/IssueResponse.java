package io.github.apdmrl.messor.issue;

import java.time.Instant;
import java.util.UUID;

/**
 * Safe flat projection of an issue for API responses.
 *
 * <p>Only the exact locked field set is exposed. JPA entities, organization and
 * user metadata, {@code projectId}, {@code workflowStatusId}, password hashes,
 * nested reporter/assignee/status objects and actor data are never returned.</p>
 */
public record IssueResponse(
		UUID id,
		String issueKey,
		String projectKey,
		long number,
		IssueType type,
		String title,
		String description,
		String statusCode,
		UUID reporterId,
		UUID assigneeId,
		long rank,
		boolean archived,
		long version,
		Instant createdAt,
		Instant updatedAt) {

	public static IssueResponse from(Issue issue) {
		return new IssueResponse(
				issue.getId(),
				issue.getHumanKey(),
				issue.getProject().getKey(),
				issue.getNumber(),
				issue.getType(),
				issue.getTitle(),
				issue.getDescription(),
				issue.getWorkflowStatus().getCode(),
				issue.getReporter().getId(),
				issue.getAssignee() != null ? issue.getAssignee().getId() : null,
				issue.getRank(),
				issue.isArchived(),
				issue.getVersion(),
				issue.getCreatedAt(),
				issue.getUpdatedAt());
	}

}
