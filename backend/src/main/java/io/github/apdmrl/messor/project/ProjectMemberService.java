package io.github.apdmrl.messor.project;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import jakarta.persistence.EntityManager;

import io.github.apdmrl.messor.common.api.ApiProblemException;
import io.github.apdmrl.messor.identity.MessorUserPrincipal;
import io.github.apdmrl.messor.identity.UserAccount;
import io.github.apdmrl.messor.identity.UserAccountRepository;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Application service for project membership operations.
 *
 * <p>Every operation first authorizes the acting principal through the focused
 * {@link ProjectAuthorizationService} before looking up the target email or
 * user, so an unauthorized caller cannot probe account existence. Business
 * rules (duplicate membership, final-lead invariant, optimistic versions) live
 * here, never in the controller.</p>
 */
@Service
public class ProjectMemberService {

	private final ProjectAuthorizationService authorizationService;
	private final ProjectMemberRepository memberRepository;
	private final UserAccountRepository userAccountRepository;
	private final EntityManager entityManager;

	public ProjectMemberService(ProjectAuthorizationService authorizationService,
			ProjectMemberRepository memberRepository,
			UserAccountRepository userAccountRepository,
			EntityManager entityManager) {
		this.authorizationService = authorizationService;
		this.memberRepository = memberRepository;
		this.userAccountRepository = userAccountRepository;
		this.entityManager = entityManager;
	}

	@Transactional(readOnly = true)
	public List<ProjectMemberResponse> list(String projectKey, MessorUserPrincipal principal) {
		// Reading the member list requires only READ so that MEMBER and VIEWER
		// roles can see who is on the project; mutations still require
		// MANAGE_MEMBERS.
		ProjectAccess access = authorizationService.requireProject(
				projectKey, principal, ProjectPermission.READ);
		return memberRepository.findAllByProjectIdOrderByUserEmailAsc(access.project().getId())
				.stream()
				.map(ProjectMemberResponse::of)
				.toList();
	}

	@Transactional
	public ProjectMemberResponse add(String projectKey, AddProjectMemberRequest request,
			MessorUserPrincipal principal) {
		ProjectAccess access = authorizationService.requireProject(
				projectKey, principal, ProjectPermission.MANAGE_MEMBERS);

		// Authorize before resolving the target so an unauthorized caller cannot
		// probe whether an account exists.
		UserAccount target = resolveActiveUser(request.email());

		Optional<ProjectMember> existing = memberRepository
				.findByProjectIdAndUserId(access.project().getId(), target.getId());
		if (existing.isPresent()) {
			throw memberAlreadyExists();
		}

		ProjectMember member = ProjectMember.create(access.project(), target, request.role());
		try {
			memberRepository.saveAndFlush(member);
		}
		catch (DataIntegrityViolationException ex) {
			if (isMemberUniqueViolation(ex)) {
				throw memberAlreadyExists();
			}
			// Any other integrity violation is rethrown so the global handler
			// reports a generic conflict instead of guessing a domain reason.
			throw ex;
		}
		return ProjectMemberResponse.of(member);
	}

	@Transactional
	public ProjectMemberResponse changeRole(String projectKey, UUID userId,
			ChangeProjectMemberRoleRequest request, MessorUserPrincipal principal) {
		ProjectAccess access = authorizationService.requireProject(
				projectKey, principal, ProjectPermission.MANAGE_MEMBERS);

		ProjectMember member = requireMember(access.project().getId(), userId);

		if (request.expectedVersion() != member.getVersion()) {
			throw versionConflict();
		}

		// Enforce the final-lead invariant transactionally with a pessimistic
		// lock on the project's membership rows.
		if (member.getRole() == ProjectRole.PROJECT_LEAD
				&& request.role() != ProjectRole.PROJECT_LEAD) {
			requireAnotherLeadRemains(access.project().getId(), member);
		}

		member.changeRole(request.role());
		memberRepository.save(member);
		// Flush so the @Version increment is applied before the response is
		// built. The whole operation remains a single transaction.
		entityManager.flush();
		return ProjectMemberResponse.of(member);
	}

	@Transactional
	public void remove(String projectKey, UUID userId, long expectedVersion,
			MessorUserPrincipal principal) {
		ProjectAccess access = authorizationService.requireProject(
				projectKey, principal, ProjectPermission.MANAGE_MEMBERS);

		ProjectMember member = requireMember(access.project().getId(), userId);

		if (expectedVersion != member.getVersion()) {
			throw versionConflict();
		}

		if (member.getRole() == ProjectRole.PROJECT_LEAD) {
			requireAnotherLeadRemains(access.project().getId(), member);
		}

		memberRepository.delete(member);
	}

	private ProjectMember requireMember(UUID projectId, UUID userId) {
		return memberRepository.findByProjectIdAndUserId(projectId, userId)
				.orElseThrow(() -> new ApiProblemException(HttpStatus.NOT_FOUND,
						"PROJECT_MEMBER_NOT_FOUND", "Proje üyesi bulunamadı."));
	}

	/**
	 * Enforces that at least one {@code PROJECT_LEAD} remains after the given
	 * member stops being a lead. The membership rows are locked pessimistically
	 * so the check and the subsequent mutation are atomic under concurrency.
	 */
	private void requireAnotherLeadRemains(UUID projectId, ProjectMember memberBeingChanged) {
		memberRepository.lockAllByProjectId(projectId);
		long leadCount = memberRepository.countLeadsByProjectId(projectId);
		if (leadCount <= 1) {
			throw new ApiProblemException(HttpStatus.CONFLICT, "LAST_PROJECT_LEAD_REQUIRED",
					"Projede en az bir proje lideri kalmalıdır.");
		}
	}

	private UserAccount resolveActiveUser(String rawEmail) {
		Optional<UserAccount> account = userAccountRepository.findByNormalizedEmail(rawEmail);
		if (account.isEmpty() || !account.get().isActive()) {
			throw new ApiProblemException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND",
					"Kullanıcı bulunamadı.");
		}
		return account.get();
	}

	/**
	 * Returns {@code true} only when the cause chain of the given integrity
	 * violation is the project/user unique constraint
	 * ({@code uq_project_member_project_user}) from the V3 migration. The
	 * constraint name is read from Hibernate's structured
	 * {@code ConstraintViolationException} rather than by searching a localized
	 * message, so unrelated constraints are never mislabeled.
	 */
	private boolean isMemberUniqueViolation(DataIntegrityViolationException ex) {
		Throwable cause = ex;
		while (cause != null) {
			if (cause instanceof org.hibernate.exception.ConstraintViolationException cve
					&& "uq_project_member_project_user".equals(cve.getConstraintName())) {
				return true;
			}
			cause = cause.getCause();
		}
		return false;
	}

	private ApiProblemException memberAlreadyExists() {
		return new ApiProblemException(HttpStatus.CONFLICT, "MEMBER_ALREADY_EXISTS",
				"Bu kullanıcı zaten proje üyesi.");
	}

	private ApiProblemException versionConflict() {
		return new ApiProblemException(HttpStatus.CONFLICT, "VERSION_CONFLICT",
				"Kayıt başka bir işlem tarafından güncellendi.");
	}

}
