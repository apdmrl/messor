package io.github.apdmrl.messor.project;

import java.util.EnumSet;
import java.util.Optional;
import java.util.Set;

import io.github.apdmrl.messor.common.api.ApiProblemException;
import io.github.apdmrl.messor.identity.MessorUserPrincipal;
import io.github.apdmrl.messor.identity.UserRole;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/**
 * Focused, fail-closed project authorization service.
 *
 * <p>Every project-owned operation resolves the requested permission against
 * persistent membership. The service never falls through to authorization when
 * the project, principal, membership, or permission cannot be resolved.</p>
 *
 * <p>Behavior:</p>
 * <ul>
 *   <li>{@code ORG_ADMIN} holds every permission on every existing project and
 *       is reported with the effective {@code PROJECT_LEAD} role.</li>
 *   <li>{@code PROJECT_LEAD} holds every permission on their project.</li>
 *   <li>{@code MEMBER} holds {@code READ}, {@code MUTATE_ISSUES} and
 *       {@code COMMENT}.</li>
 *   <li>{@code VIEWER} holds {@code READ} only.</li>
 *   <li>A nonmember has no permission.</li>
 * </ul>
 *
 * <p>Unknown projects and nonmembers both yield {@code 404 PROJECT_NOT_FOUND}
 * to avoid identifier disclosure. A known member with an insufficient role
 * yields {@code 403 FORBIDDEN}.</p>
 */
@Service
public class ProjectAuthorizationService {

	private static final Set<ProjectPermission> MEMBER_PERMISSIONS = EnumSet.of(
			ProjectPermission.READ,
			ProjectPermission.MUTATE_ISSUES,
			ProjectPermission.COMMENT);

	private static final Set<ProjectPermission> VIEWER_PERMISSIONS = EnumSet.of(
			ProjectPermission.READ);

	private final ProjectRepository projectRepository;
	private final ProjectMemberRepository memberRepository;

	public ProjectAuthorizationService(ProjectRepository projectRepository,
			ProjectMemberRepository memberRepository) {
		this.projectRepository = projectRepository;
		this.memberRepository = memberRepository;
	}

	/**
	 * Returns the authorized project and effective role, or throws a
	 * {@link ApiProblemException} with {@code 404 PROJECT_NOT_FOUND} for unknown
	 * projects and nonmembers, or {@code 403 FORBIDDEN} for known members with
	 * an insufficient role.
	 */
	public ProjectAccess requireProject(String projectKey, MessorUserPrincipal principal,
			ProjectPermission permission) {
		if (projectKey == null || principal == null || permission == null) {
			throw notFound();
		}

		Optional<Project> project = projectRepository.findByKey(projectKey);
		if (project.isEmpty()) {
			throw notFound();
		}

		if (principal.getRole() == UserRole.ORG_ADMIN) {
			return new ProjectAccess(project.get(), ProjectRole.PROJECT_LEAD);
		}

		Optional<ProjectMember> membership = memberRepository
				.findByProjectIdAndUserId(project.get().getId(), principal.getId());
		if (membership.isEmpty()) {
			// Nonmember: hide the project entirely, including mutation attempts.
			throw notFound();
		}

		ProjectRole role = membership.get().getRole();
		if (!permissionsFor(role).contains(permission)) {
			throw new ApiProblemException(HttpStatus.FORBIDDEN, "FORBIDDEN",
					"Bu işlem için yetkiniz yok.");
		}
		return new ProjectAccess(project.get(), role);
	}

	private Set<ProjectPermission> permissionsFor(ProjectRole role) {
		return switch (role) {
			case PROJECT_LEAD -> EnumSet.allOf(ProjectPermission.class);
			case MEMBER -> MEMBER_PERMISSIONS;
			case VIEWER -> VIEWER_PERMISSIONS;
		};
	}

	private ApiProblemException notFound() {
		return new ApiProblemException(HttpStatus.NOT_FOUND, "PROJECT_NOT_FOUND",
				"Proje bulunamadı.");
	}

}
