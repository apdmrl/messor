package io.github.apdmrl.messor.issue;

import java.util.UUID;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Request to create an issue. Only the type, title, description and assignee
 * are accepted; every other field (number, key, reporter, status, rank,
 * archived, version, project, actor) is server-derived and ignored.
 */
public record CreateIssueRequest(
		@NotNull IssueType type,
		@NotBlank @Size(max = 200) String title,
		@Size(max = 10000) String description,
		UUID assigneeId) {
}
