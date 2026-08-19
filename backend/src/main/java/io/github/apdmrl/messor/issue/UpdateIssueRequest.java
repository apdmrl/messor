package io.github.apdmrl.messor.issue;

import java.util.UUID;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

/**
 * Request to update an issue's mutable fields. PATCH replaces title,
 * description and assignee; every other field (number, key, reporter, status,
 * rank, archived, version, project, actor) is server-derived and ignored.
 * {@code expectedVersion} is required for optimistic concurrency control.
 */
public record UpdateIssueRequest(
		@NotBlank @Size(max = 200) String title,
		@Size(max = 10000) String description,
		UUID assigneeId,
		@NotNull @PositiveOrZero Long expectedVersion) {
}
