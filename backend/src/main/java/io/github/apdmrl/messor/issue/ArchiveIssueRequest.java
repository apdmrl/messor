package io.github.apdmrl.messor.issue;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

/**
 * Request to archive an issue. Only the optimistic {@code expectedVersion} is
 * accepted; every other field is server-derived and ignored.
 */
public record ArchiveIssueRequest(
		@NotNull @PositiveOrZero Long expectedVersion) {
}
