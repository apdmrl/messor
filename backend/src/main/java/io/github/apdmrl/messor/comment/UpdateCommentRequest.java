package io.github.apdmrl.messor.comment;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

/**
 * Request to edit a comment. Only the original author may edit; the
 * {@code expectedVersion} must match the persisted version exactly or the
 * request fails with a version conflict.
 */
public record UpdateCommentRequest(
		@NotNull @Size(min = 1, max = 5000) String body,
		@NotNull @PositiveOrZero Long expectedVersion) {
}
