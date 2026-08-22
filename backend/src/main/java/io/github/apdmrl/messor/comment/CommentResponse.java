package io.github.apdmrl.messor.comment;

import java.time.Instant;
import java.util.UUID;

/**
 * Safe flat projection of a comment for API responses. Tombstones return
 * {@code body = null}. JPA entities, the author's profile, email, password or
 * account fields, and any {@code deletedBy} data are never exposed.
 */
public record CommentResponse(
		UUID id,
		String issueKey,
		UUID authorId,
		String body,
		boolean deleted,
		Instant createdAt,
		Instant updatedAt,
		long version) {

	public static CommentResponse from(IssueComment comment) {
		return new CommentResponse(
				comment.getId(),
				comment.getIssue().getHumanKey(),
				comment.getAuthor().getId(),
				comment.isDeleted() ? null : comment.getBody(),
				comment.isDeleted(),
				comment.getCreatedAt(),
				comment.getUpdatedAt(),
				comment.getVersion());
	}

}
