package io.github.apdmrl.messor.project;

import java.util.UUID;

/**
 * Safe projection of a project membership for API responses. Only the fields
 * required by the contract are exposed; JPA entities, password hashes, account
 * status, organization role and internal audit fields are never returned.
 */
public record ProjectMemberResponse(
		UUID userId,
		String email,
		String firstName,
		String lastName,
		ProjectRole role,
		long version) {

	public static ProjectMemberResponse of(ProjectMember member) {
		return new ProjectMemberResponse(
				member.getUser().getId(),
				member.getUser().getEmail(),
				member.getUser().getFirstName(),
				member.getUser().getLastName(),
				member.getRole(),
				member.getVersion());
	}

}
