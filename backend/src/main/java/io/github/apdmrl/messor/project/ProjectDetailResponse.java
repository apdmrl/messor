package io.github.apdmrl.messor.project;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Safe projection of a project for API responses. Only the fields required by
 * the contract are exposed; internal entities, creator identity and audit
 * internals are never returned.
 */
public record ProjectDetailResponse(
		UUID id,
		String key,
		String name,
		String description,
		ProjectRole currentUserRole,
		long version,
		Instant createdAt,
		Instant updatedAt,
		List<WorkflowStatusResponse> workflowStatuses) {

	public static ProjectDetailResponse of(Project project, ProjectRole currentUserRole,
			List<WorkflowStatusResponse> workflowStatuses) {
		return new ProjectDetailResponse(
				project.getId(),
				project.getKey(),
				project.getName(),
				project.getDescription(),
				currentUserRole,
				project.getVersion(),
				project.getCreatedAt(),
				project.getUpdatedAt(),
				workflowStatuses);
	}

}
