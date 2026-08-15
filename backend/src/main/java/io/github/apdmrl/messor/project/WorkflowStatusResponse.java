package io.github.apdmrl.messor.project;

import java.util.UUID;

/**
 * Safe projection of a workflow status for API responses.
 */
public record WorkflowStatusResponse(UUID id, String code, String displayName, int position) {

	public static WorkflowStatusResponse from(WorkflowStatus status) {
		return new WorkflowStatusResponse(
				status.getId(),
				status.getCode(),
				status.getDisplayName(),
				status.getPosition());
	}

}
