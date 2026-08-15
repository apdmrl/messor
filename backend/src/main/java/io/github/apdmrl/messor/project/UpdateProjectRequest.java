package io.github.apdmrl.messor.project;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

/**
 * Request to update project metadata. The project key is immutable and cannot
 * be changed through this request. {@code expectedVersion} enables optimistic
 * locking; a stale value returns {@code 409 VERSION_CONFLICT}.
 */
public record UpdateProjectRequest(
		@NotBlank @Size(max = 120) String name,
		@Size(max = 2000) String description,
		@NotNull @PositiveOrZero Long expectedVersion) {
}
