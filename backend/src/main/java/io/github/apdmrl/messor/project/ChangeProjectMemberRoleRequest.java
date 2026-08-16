package io.github.apdmrl.messor.project;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

/**
 * Request to change a member's role. {@code expectedVersion} enables optimistic
 * locking; a stale value returns {@code 409 VERSION_CONFLICT}.
 */
public record ChangeProjectMemberRoleRequest(
		@NotNull ProjectRole role,
		@NotNull @PositiveOrZero Long expectedVersion) {
}
