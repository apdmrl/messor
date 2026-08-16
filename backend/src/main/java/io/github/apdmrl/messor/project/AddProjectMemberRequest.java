package io.github.apdmrl.messor.project;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Request to add a member to a project. The server accepts only the target
 * email and role; project ownership, actor, organization role and membership
 * identifiers are never accepted from the client.
 *
 * <p>The email is trimmed in the compact constructor so surrounding whitespace
 * is accepted and validated against the normalized value; the service performs
 * the full normalization (trim + lowercase) before lookup.</p>
 */
public record AddProjectMemberRequest(
		@Email @NotBlank @Size(max = 254) String email,
		@NotNull ProjectRole role) {

	public AddProjectMemberRequest {
		if (email != null) {
			email = email.trim();
		}
	}

}
