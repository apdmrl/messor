package io.github.apdmrl.messor.project;

import java.time.Instant;
import java.util.UUID;

/**
 * Safe projection of a project for list responses.
 */
public record ProjectSummaryResponse(
		UUID id,
		String key,
		String name,
		String description,
		ProjectRole currentUserRole,
		long version,
		Instant createdAt,
		Instant updatedAt) {

	public static ProjectSummaryResponse of(Project project, ProjectRole currentUserRole) {
		return new ProjectSummaryResponse(
				project.getId(),
				project.getKey(),
				project.getName(),
				project.getDescription(),
				currentUserRole,
				project.getVersion(),
				project.getCreatedAt(),
				project.getUpdatedAt());
	}

}
