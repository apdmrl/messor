package io.github.apdmrl.messor.project;

import java.util.List;

import io.github.apdmrl.messor.common.api.ApiProblemException;
import io.github.apdmrl.messor.common.api.PageResponse;
import io.github.apdmrl.messor.identity.MessorUserPrincipal;
import io.github.apdmrl.messor.identity.UserAccount;
import io.github.apdmrl.messor.identity.UserAccountRepository;
import io.github.apdmrl.messor.identity.UserRole;

import jakarta.persistence.EntityManager;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Application service for projects.
 *
 * <p>Project creation is a single transaction that persists the project, the
 * creator's {@code PROJECT_LEAD} membership, and exactly three default workflow
 * statuses atomically. Object-level authorization for existing projects is
 * delegated to the focused {@link ProjectAuthorizationService}; this service
 * holds no duplicated authorization helpers.</p>
 */
@Service
public class ProjectService {

	private final ProjectRepository projectRepository;
	private final ProjectMemberRepository memberRepository;
	private final WorkflowStatusRepository statusRepository;
	private final UserAccountRepository userAccountRepository;
	private final ProjectAuthorizationService authorizationService;
	private final EntityManager entityManager;

	public ProjectService(ProjectRepository projectRepository,
			ProjectMemberRepository memberRepository,
			WorkflowStatusRepository statusRepository,
			UserAccountRepository userAccountRepository,
			ProjectAuthorizationService authorizationService,
			EntityManager entityManager) {
		this.projectRepository = projectRepository;
		this.memberRepository = memberRepository;
		this.statusRepository = statusRepository;
		this.userAccountRepository = userAccountRepository;
		this.authorizationService = authorizationService;
		this.entityManager = entityManager;
	}

	@Transactional
	public ProjectDetailResponse create(CreateProjectRequest request, MessorUserPrincipal principal) {
		String normalizedKey;
		try {
			normalizedKey = ProjectKeyNormalizer.normalize(request.key());
		}
		catch (IllegalArgumentException ex) {
			throw new ApiProblemException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED",
					"İstek doğrulama kurallarını karşılamıyor.");
		}
		if (projectRepository.existsByKey(normalizedKey)) {
			throw new ApiProblemException(HttpStatus.CONFLICT, "PROJECT_KEY_ALREADY_EXISTS",
					"Bu proje anahtarı zaten kullanılıyor.");
		}

		UserAccount creator = userAccountRepository.findById(principal.getId())
				.orElseThrow(() -> new ApiProblemException(HttpStatus.UNAUTHORIZED,
						"UNAUTHENTICATED", "Oturum açmanız gerekiyor."));

		Project project = Project.create(normalizedKey, request.name(), request.description(), creator);

		try {
			projectRepository.save(project);

			memberRepository.save(ProjectMember.create(project, creator, ProjectRole.PROJECT_LEAD));

			statusRepository.save(WorkflowStatus.create(project, "TO_DO", "Yapılacak", 0));
			statusRepository.save(WorkflowStatus.create(project, "IN_PROGRESS", "Devam Ediyor", 1));
			statusRepository.save(WorkflowStatus.create(project, "DONE", "Tamamlandı", 2));

			// Flush so @PrePersist populates createdAt/updatedAt before the
			// response is built. The whole operation remains a single
			// transaction; a constraint violation surfaces here.
			entityManager.flush();
		}
		catch (DataIntegrityViolationException ex) {
			if (isProjectKeyUniqueViolation(ex)) {
				throw new ApiProblemException(HttpStatus.CONFLICT, "PROJECT_KEY_ALREADY_EXISTS",
						"Bu proje anahtarı zaten kullanılıyor.");
			}
			// Any other integrity violation is rethrown so the global handler
			// reports a generic conflict instead of guessing a domain reason.
			throw ex;
		}

		return toDetail(project, ProjectRole.PROJECT_LEAD);
	}

	/**
	 * Returns {@code true} only when the cause chain of the given integrity
	 * violation is the project key unique constraint ({@code uq_project_key})
	 * from the V3 migration. The constraint name is read from Hibernate's
	 * structured {@code ConstraintViolationException} rather than by searching
	 * a localized message, so unrelated constraints are never mislabeled.
	 */
	private boolean isProjectKeyUniqueViolation(DataIntegrityViolationException ex) {
		Throwable cause = ex;
		while (cause != null) {
			if (cause instanceof org.hibernate.exception.ConstraintViolationException cve
					&& "uq_project_key".equals(cve.getConstraintName())) {
				return true;
			}
			cause = cause.getCause();
		}
		return false;
	}

	@Transactional(readOnly = true)
	public PageResponse<ProjectSummaryResponse> list(MessorUserPrincipal principal,
			int page, int size, String sortField, String sortDirection) {
		Sort sort = Sort.by(Sort.Direction.fromString(sortDirection), sortField);
		Pageable pageable = PageRequest.of(page, size, sort);

		Page<Project> result;
		if (principal.getRole() == UserRole.ORG_ADMIN) {
			result = projectRepository.findAll(pageable);
		}
		else {
			result = projectRepository.findAllByMembersUserId(principal.getId(), pageable);
		}

		List<ProjectSummaryResponse> items = result.getContent().stream()
				.map(project -> ProjectSummaryResponse.of(project, roleFor(project, principal)))
				.toList();

		return PageResponse.of(items, page, size, result.getTotalElements());
	}

	@Transactional(readOnly = true)
	public ProjectDetailResponse get(String projectKey, MessorUserPrincipal principal) {
		ProjectAccess access = authorizationService.requireProject(
				projectKey, principal, ProjectPermission.READ);
		return toDetail(access.project(), access.effectiveRole());
	}

	@Transactional
	public ProjectDetailResponse update(String projectKey, UpdateProjectRequest request,
			MessorUserPrincipal principal) {
		ProjectAccess access = authorizationService.requireProject(
				projectKey, principal, ProjectPermission.MANAGE_PROJECT);
		Project project = access.project();
		if (request.expectedVersion() != project.getVersion()) {
			throw new ApiProblemException(HttpStatus.CONFLICT, "VERSION_CONFLICT",
					"Kayıt başka bir işlem tarafından güncellendi.");
		}
		project.update(request.name(), request.description());
		projectRepository.save(project);
		return toDetail(project, access.effectiveRole());
	}

	private ProjectRole roleFor(Project project, MessorUserPrincipal principal) {
		if (principal.getRole() == UserRole.ORG_ADMIN) {
			return ProjectRole.PROJECT_LEAD;
		}
		return memberRepository.findByProjectIdAndUserId(project.getId(), principal.getId())
				.map(ProjectMember::getRole)
				.orElse(ProjectRole.VIEWER);
	}

	private ProjectDetailResponse toDetail(Project project, ProjectRole role) {
		List<WorkflowStatusResponse> statuses = statusRepository
				.findByProjectIdOrderByPositionAsc(project.getId())
				.stream()
				.map(WorkflowStatusResponse::from)
				.toList();
		return ProjectDetailResponse.of(project, role, statuses);
	}

}
