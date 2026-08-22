package io.github.apdmrl.messor.comment;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Request to create a comment on an issue. Only the body is accepted; the
 * author, issue and project are derived server-side and never trusted from the
 * client. Whitespace-only bodies are rejected by the service, while accepted
 * leading/trailing whitespace is preserved.
 */
public record CreateCommentRequest(
		@NotNull @Size(min = 1, max = 5000) String body) {
}
