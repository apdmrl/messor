package io.github.apdmrl.messor.issue;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Safe flat projection of an issue activity for API responses.
 *
 * <p>Only the exact locked field set is exposed: id, type, actorId, summary and
 * createdAt. The actor entity, user metadata, email, names, password hash,
 * organization role, the issue entity and nested JPA fields are never returned.
 * The summary is the controlled JSONB document built by the service.</p>
 */
public record IssueActivityResponse(
		UUID id,
		IssueActivityType type,
		UUID actorId,
		Map<String, Object> summary,
		Instant createdAt) {

	public static IssueActivityResponse from(IssueActivity activity) {
		return new IssueActivityResponse(
				activity.getId(),
				activity.getType(),
				activity.getActor().getId(),
				IssueActivitySummary.deepFreeze(activity.getSummary()),
				activity.getCreatedAt());
	}

}
