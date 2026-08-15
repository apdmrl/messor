package io.github.apdmrl.messor.project;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Request to create a project. The key is normalized (trimmed and uppercased)
 * by the service; the creator is always derived from the authenticated
 * principal, never from this request.
 */
public record CreateProjectRequest(
		@NotBlank @Size(max = 10) String key,
		@NotBlank @Size(max = 120) String name,
		@Size(max = 2000) String description) {
}
