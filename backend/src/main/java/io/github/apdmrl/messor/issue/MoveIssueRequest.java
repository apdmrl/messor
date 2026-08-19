package io.github.apdmrl.messor.issue;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

/**
 * Request to move an issue to a target workflow status and position.
 *
 * <p>{@code beforeIssueKey} and {@code afterIssueKey} are mutually exclusive;
 * both {@code null} means append to the end of the destination. Every other
 * issue field is server-derived and ignored. {@code expectedVersion} is
 * required for optimistic concurrency control.</p>
 */
public record MoveIssueRequest(
		@NotBlank @Size(max = 32) String targetStatusCode,
		@Size(max = 32) String beforeIssueKey,
		@Size(max = 32) String afterIssueKey,
		@NotNull @PositiveOrZero Long expectedVersion) {

	@AssertTrue(message = "beforeIssueKey and afterIssueKey are mutually exclusive")
	public boolean isNeighborPositionMutuallyExclusive() {
		return beforeIssueKey == null || afterIssueKey == null;
	}

	@AssertTrue(message = "beforeIssueKey must not be blank when provided")
	public boolean isBeforeIssueKeyNotBlank() {
		return beforeIssueKey == null || !beforeIssueKey.isBlank();
	}

	@AssertTrue(message = "afterIssueKey must not be blank when provided")
	public boolean isAfterIssueKeyNotBlank() {
		return afterIssueKey == null || !afterIssueKey.isBlank();
	}

}
