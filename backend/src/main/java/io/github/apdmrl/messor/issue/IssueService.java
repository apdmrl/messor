package io.github.apdmrl.messor.issue;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import io.github.apdmrl.messor.common.api.ApiProblemException;
import io.github.apdmrl.messor.identity.MessorUserPrincipal;
import io.github.apdmrl.messor.identity.UserAccount;
import io.github.apdmrl.messor.identity.UserAccountRepository;
import io.github.apdmrl.messor.identity.UserStatus;
import io.github.apdmrl.messor.project.Project;
import io.github.apdmrl.messor.project.ProjectAccess;
import io.github.apdmrl.messor.project.ProjectAuthorizationService;
import io.github.apdmrl.messor.project.ProjectMember;
import io.github.apdmrl.messor.project.ProjectMemberRepository;
import io.github.apdmrl.messor.project.ProjectPermission;
import io.github.apdmrl.messor.project.WorkflowStatus;
import io.github.apdmrl.messor.project.WorkflowStatusRepository;

import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Application service for issue creation.
 *
 * <p>Creation is a single transaction that atomically allocates the project's
 * next issue number, appends a deterministic positive rank to the end of the
 * project's active {@code TO_DO} issues, persists the issue, and records exactly
 * one {@code CREATED} activity. The assignee is validated before any counter
 * allocation or advancement.</p>
 *
 * <p>Lock order (consistent across all concurrent creates to avoid deadlock):
 * the project's {@code TO_DO} workflow-status row is locked first to serialize
 * rank ordering, then the project's counter row is locked to serialize number
 * allocation. Independent projects lock disjoint rows, so they never contend.</p>
 */
@Service
public class IssueService {

	private static final long RANK_STEP = 1024L;
	private static final String TO_DO_CODE = "TO_DO";

	private final ProjectAuthorizationService authorizationService;
	private final ProjectMemberRepository memberRepository;
	private final UserAccountRepository userAccountRepository;
	private final WorkflowStatusRepository statusRepository;
	private final ProjectIssueCounterRepository counterRepository;
	private final IssueRepository issueRepository;
	private final IssueActivityRepository activityRepository;
	private final EntityManager entityManager;

	public IssueService(ProjectAuthorizationService authorizationService,
			ProjectMemberRepository memberRepository,
			UserAccountRepository userAccountRepository,
			WorkflowStatusRepository statusRepository,
			ProjectIssueCounterRepository counterRepository,
			IssueRepository issueRepository,
			IssueActivityRepository activityRepository,
			EntityManager entityManager) {
		this.authorizationService = authorizationService;
		this.memberRepository = memberRepository;
		this.userAccountRepository = userAccountRepository;
		this.statusRepository = statusRepository;
		this.counterRepository = counterRepository;
		this.issueRepository = issueRepository;
		this.activityRepository = activityRepository;
		this.entityManager = entityManager;
	}

	@Transactional
	public IssueResponse create(String projectKey, CreateIssueRequest request,
			MessorUserPrincipal principal) {
		ProjectAccess access = authorizationService.requireProject(
				projectKey, principal, ProjectPermission.MUTATE_ISSUES);
		Project project = access.project();

		// Validate the assignee before allocating or advancing the counter so a
		// rejected assignee never consumes a number or rank.
		UserAccount assignee = null;
		if (request.assigneeId() != null) {
			assignee = requireActiveSameProjectMember(project.getId(), request.assigneeId());
		}

		UserAccount reporter = userAccountRepository.getReferenceById(principal.getId());

		// Lock the project's TO_DO workflow-status row to serialize rank
		// ordering for issues created into that status.
		WorkflowStatus todoStatus = statusRepository
				.lockByProjectIdAndCode(project.getId(), TO_DO_CODE)
				.orElseThrow(() -> new ApiProblemException(HttpStatus.CONFLICT, "CONFLICT",
						"Kaynak durumu istekle çakışıyor."));

		// Lazily initialize and lock the project's counter, then allocate the
		// next number and advance it. All of this is inside the same transaction.
		counterRepository.insertIfAbsent(project.getId());
		ProjectIssueCounter counter = counterRepository.lockByProjectId(project.getId())
				.orElseThrow(() -> new ApiProblemException(HttpStatus.CONFLICT, "CONFLICT",
						"Kaynak durumu istekle çakışıyor."));
		long number = counter.getNextNumber();
		counter.setNextNumber(number + 1);

		// Append after the current maximum active rank in TO_DO, constrained to
		// the project so the query aligns with the
		// (project_id, workflow_status_id, archived, rank) index.
		long maxRank = issueRepository.maxActiveRankByProjectAndWorkflowStatusId(
				project.getId(), todoStatus.getId());
		long rank = maxRank + RANK_STEP;

		Issue issue = Issue.create(project, number, project.getKey() + "-" + number,
				request.type(), request.title(), request.description(), todoStatus,
				reporter, assignee, rank);
		issueRepository.save(issue);

		activityRepository.save(IssueActivity.create(issue, reporter,
				IssueActivityType.CREATED, createdSummary(issue, todoStatus, assignee)));

		// Flush so @PrePersist populates createdAt/updatedAt and the counter
		// advance is applied before the response is built. The whole operation
		// remains a single transaction; a constraint violation surfaces here and
		// rolls back the counter advance.
		entityManager.flush();

		return IssueResponse.from(issue);
	}

	/**
		* Returns the issue identified by its exact immutable human key, authorizing
		* {@code READ} against the issue's project. Archived issues remain readable.
		* No mutation or activity write is performed.
		*/
	@Transactional(readOnly = true)
	public IssueResponse get(String issueKey, MessorUserPrincipal principal) {
		Issue issue = loadIssue(issueKey, principal, ProjectPermission.READ);
		return IssueResponse.from(issue);
	}

	/**
		* Updates the mutable fields (title, description, assignee) of the issue
		* identified by its exact immutable human key, authorizing
		* {@code MUTATE_ISSUES}. The update is optimistic: the request must carry the
		* persisted {@code expectedVersion}, otherwise a {@code 409 VERSION_CONFLICT}
		* is returned before any mutation or activity write. A genuine no-op (no
		* field actually changed) returns the unchanged issue without touching
		* {@code updatedAt}, the version, or the activity log.
		*/
	@Transactional
	public IssueResponse update(String issueKey, UpdateIssueRequest request,
			MessorUserPrincipal principal) {
		Issue issue = loadIssue(issueKey, principal, ProjectPermission.MUTATE_ISSUES);

		if (issue.isArchived()) {
			throw new ApiProblemException(HttpStatus.CONFLICT, "ISSUE_ARCHIVED",
					"Arşivlenmiş iş değiştirilemez.");
		}
		if (request.expectedVersion() != issue.getVersion()) {
			throw new ApiProblemException(HttpStatus.CONFLICT, "VERSION_CONFLICT",
					"Kayıt başka bir işlem tarafından güncellendi.");
		}

		// Validate the assignee before changing the issue so an invalid assignee
		// never mutates the row, increments the version, or appends an activity.
		UserAccount assignee = null;
		if (request.assigneeId() != null) {
			assignee = requireActiveSameProjectMember(issue.getProject().getId(),
					request.assigneeId());
		}

		// Null-safe comparison of persisted values against the requested values.
		boolean titleChanged = !Objects.equals(issue.getTitle(), request.title());
		boolean descriptionChanged = !Objects.equals(issue.getDescription(),
				request.description());
		boolean assigneeChanged = !Objects.equals(
				issue.getAssignee() != null ? issue.getAssignee().getId() : null,
				request.assigneeId());

		// A genuine no-op still performed authorization, archived-state,
		// expectedVersion, validation and assignee checks, but changes nothing.
		if (!titleChanged && !descriptionChanged && !assigneeChanged) {
			return IssueResponse.from(issue);
		}

		issue.updateDetails(request.title(), request.description(), assignee);

		// Flush the versioned issue so the version increments exactly once and a
		// concurrent flush-time collision surfaces as an optimistic-locking
		// failure (mapped to VERSION_CONFLICT) before the activity is appended.
		entityManager.flush();

		List<String> changedFields = new ArrayList<>();
		if (titleChanged) {
			changedFields.add("title");
		}
		if (descriptionChanged) {
			changedFields.add("description");
		}
		if (assigneeChanged) {
			changedFields.add("assigneeId");
		}

		UserAccount actor = userAccountRepository.getReferenceById(principal.getId());
		activityRepository.save(IssueActivity.create(issue, actor, IssueActivityType.UPDATED,
				updatedSummary(changedFields, assignee)));

		entityManager.flush();

		return IssueResponse.from(issue);
	}

	/**
		* Archives the issue identified by its exact immutable human key, authorizing
		* {@code MUTATE_ISSUES}. The request must carry the persisted
		* {@code expectedVersion}, otherwise a {@code 409 VERSION_CONFLICT} is
		* returned. An already-archived issue yields {@code 409 ISSUE_ARCHIVED}.
		* Only the {@code archived} flag and {@code updatedAt} change; the version
		* increments exactly once and exactly one {@code ARCHIVED} activity is
		* appended atomically.
		*/
	@Transactional
	public IssueResponse archive(String issueKey, ArchiveIssueRequest request,
			MessorUserPrincipal principal) {
		Issue issue = loadIssue(issueKey, principal, ProjectPermission.MUTATE_ISSUES);

		if (issue.isArchived()) {
			throw new ApiProblemException(HttpStatus.CONFLICT, "ISSUE_ARCHIVED",
					"Arşivlenmiş iş değiştirilemez.");
		}
		if (request.expectedVersion() != issue.getVersion()) {
			throw new ApiProblemException(HttpStatus.CONFLICT, "VERSION_CONFLICT",
					"Kayıt başka bir işlem tarafından güncellendi.");
		}

		issue.archive();

		// Flush the versioned issue so the version increments exactly once and a
		// concurrent flush-time collision surfaces before the activity is appended.
		entityManager.flush();

		UserAccount actor = userAccountRepository.getReferenceById(principal.getId());
		activityRepository.save(IssueActivity.create(issue, actor, IssueActivityType.ARCHIVED,
				archivedSummary(issue)));

		entityManager.flush();

		return IssueResponse.from(issue);
	}

	/**
		* Moves the issue identified by its exact immutable human key to a target
		* workflow status and position, authorizing {@code MUTATE_ISSUES} against
		* the issue's project.
		*
		* <p>Locking uses a deterministic per-project lock order to avoid deadlock:
		* the moving issue is loaded and authorized first, then every workflow
		* status row of the project is locked with pessimistic write locks in
		* position-then-id order, then the moving issue row itself is locked with
		* a {@code PESSIMISTIC_WRITE} lock, then the active destination issues are
		* locked by rank then id. Because every move locks the same project status
		* set in the same order, opposite-direction cross-column moves serialize on
		* the statuses instead of inverting lock order, and a move into {@code TO_DO}
		* coordinates with create's own {@code TO_DO} status lock. Independent
		* projects lock disjoint rows and never contend. Locking the moving issue
		* row (which archive/update never follow with a workflow-status lock)
		* serializes a move against archive/update without introducing a reverse
		* lock cycle. The moving issue is refreshed under that write lock after
		* acquiring the status locks and its archived state and
		* {@code expectedVersion} are rechecked after the wait. The target status
		* is resolved only from the locked same-project status set, and neighbors
		* are validated only against the locked active destination list.</p>
		*
		* <p>The final destination order is computed in memory and assigned exact
		* ranks {@code 1024, 2048, ...}. Only rows whose status or rank actually
		* change are updated, so changed rows bump {@code updatedAt} and their
		* {@code @Version}, while unchanged rows retain both. A genuine no-op (same
		* status, order and ranks) returns 200 unchanged with no version, timestamp
		* or activity change. An effective move flushes all versioned changes,
		* appends exactly one {@code MOVED} activity atomically, and flushes again
		* before returning the persisted issue.</p>
		*/
	@Transactional
	public IssueResponse move(String issueKey, MoveIssueRequest request,
			MessorUserPrincipal principal) {
		// Fail-closed load and authorize the moving issue.
		Issue issue = loadIssue(issueKey, principal, ProjectPermission.MUTATE_ISSUES);
		if (issue.isArchived()) {
			throw archived();
		}
		UUID projectId = issue.getProject().getId();

		// Lock all workflow-status rows of the project in deterministic
		// position/id order, then acquire a pessimistic write lock on the moving
		// issue row and refresh it atomically with the held lock. Locking the
		// issue row here serializes a move against archive/update (which lock only
		// the issue row and never request workflow-status locks), so if archive
		// wins first the move waits, refreshes the archived state, and rejects,
		// while if the move locks first its no-op is linearized before archive and
		// may safely return 200. The issue row is refreshed after the status locks
		// and its archived state and expectedVersion are rechecked after the wait.
		List<WorkflowStatus> statuses = statusRepository
				.lockAllByProjectIdOrderByPositionAscIdAsc(projectId);
		entityManager.refresh(issue, LockModeType.PESSIMISTIC_WRITE);

		// Recheck archived state and expectedVersion after the wait.
		if (issue.isArchived()) {
			throw archived();
		}
		if (request.expectedVersion() != issue.getVersion()) {
			throw versionConflict();
		}

		// Resolve the target status only from the locked same-project status set.
		WorkflowStatus targetStatus = statuses.stream()
				.filter(ws -> ws.getCode().equals(request.targetStatusCode()))
				.findFirst()
				.orElseThrow(() -> new ApiProblemException(HttpStatus.BAD_REQUEST,
						"INVALID_WORKFLOW_STATUS", "Geçersiz iş akışı durumu."));
		WorkflowStatus sourceStatus = issue.getWorkflowStatus();
		boolean sameStatus = sourceStatus.getId().equals(targetStatus.getId());

		// Lock the active destination issues ordered by rank, id.
		List<Issue> order = new ArrayList<>(
				issueRepository.lockActiveByProjectAndWorkflowStatusId(projectId,
						targetStatus.getId()));

		// For a same-status reorder, remove the moving issue before computing the
		// insertion point so its own rank is not shifted.
		if (sameStatus) {
			order.removeIf(i -> i.getId().equals(issue.getId()));
		}

		// Validate neighbors only against the locked active destination list.
		int insertIndex;
		if (request.beforeIssueKey() != null) {
			insertIndex = indexOfIssueByKey(order, request.beforeIssueKey());
			if (insertIndex < 0) {
				throw invalidPosition();
			}
		}
		else if (request.afterIssueKey() != null) {
			int neighborIndex = indexOfIssueByKey(order, request.afterIssueKey());
			if (neighborIndex < 0) {
				throw invalidPosition();
			}
			insertIndex = neighborIndex + 1;
		}
		else {
			insertIndex = order.size();
		}
		order.add(insertIndex, issue);

		// Assign exact ranks and update only rows whose status or rank changed.
		if (!applyRanks(order, targetStatus)) {
			return IssueResponse.from(issue);
		}

		// Effective move: flush versioned changes, append one MOVED activity, flush.
		entityManager.flush();
		UserAccount actor = userAccountRepository.getReferenceById(principal.getId());
		activityRepository.save(IssueActivity.create(issue, actor, IssueActivityType.MOVED,
				movedSummary(sourceStatus, targetStatus)));
		entityManager.flush();

		return IssueResponse.from(issue);
	}

	/**
		* Returns a page of the given project's issues matching the optional
		* type/status/assignee/archive filters, authorizing {@code READ} against the
		* project before querying. The primary sort field and direction are
		* validated by the controller allowlist; the final ordering always appends a
		* globally-unique {@code id ASC} tie-breaker so pagination never duplicates
		* or drops rows. This is a read-only query; no issue, activity or counter is
		* mutated.
		*/
	@Transactional(readOnly = true)
	public IssuePageResponse list(String projectKey, MessorUserPrincipal principal, int page,
			int size, String field, String direction, IssueType type, String statusCode,
			UUID assigneeId, ArchiveFilter archive) {
		Project project = authorizationService
				.requireProject(projectKey, principal, ProjectPermission.READ).project();
		Boolean archived = switch (archive) {
			case ACTIVE -> Boolean.FALSE;
			case ARCHIVED -> Boolean.TRUE;
			case ALL -> null;
		};
		Pageable pageable = PageRequest.of(page, size, buildSort(field, direction));
		Page<Issue> result = issueRepository.findProjectIssues(project.getId(), type,
				statusCode, assigneeId, archived, pageable);
		return IssuePageResponse.from(result);
	}

	private Sort buildSort(String field, String direction) {
		Sort.Direction primary = "desc".equals(direction) ? Sort.Direction.DESC
				: Sort.Direction.ASC;
		Sort sort = Sort.by(primary, field);
		if (!"number".equals(field)) {
			// Deterministic secondary within the project.
			sort = sort.and(Sort.by(Sort.Direction.ASC, "number"));
		}
		// Final globally-unique tie-breaker so pagination is stable and complete.
		return sort.and(Sort.by(Sort.Direction.ASC, "id"));
	}

	private int indexOfIssueByKey(List<Issue> issues, String humanKey) {
		for (int i = 0; i < issues.size(); i++) {
			if (issues.get(i).getHumanKey().equals(humanKey)) {
				return i;
			}
		}
		return -1;
	}

	private boolean applyRanks(List<Issue> order, WorkflowStatus targetStatus) {
		boolean changed = false;
		long rank = RANK_STEP;
		for (Issue issue : order) {
			boolean statusChanged = !issue.getWorkflowStatus().getId()
					.equals(targetStatus.getId());
			boolean rankChanged = issue.getRank() != rank;
			if (statusChanged || rankChanged) {
				issue.moveTo(targetStatus, rank);
				changed = true;
			}
			rank += RANK_STEP;
		}
		return changed;
	}

	private ApiProblemException archived() {
		return new ApiProblemException(HttpStatus.CONFLICT, "ISSUE_ARCHIVED",
				"Arşivlenmiş iş değiştirilemez.");
	}

	private ApiProblemException versionConflict() {
		return new ApiProblemException(HttpStatus.CONFLICT, "VERSION_CONFLICT",
				"Kayıt başka bir işlem tarafından güncellendi.");
	}

	private ApiProblemException invalidPosition() {
		return new ApiProblemException(HttpStatus.BAD_REQUEST, "INVALID_ISSUE_POSITION",
				"Geçersiz iş konumu.");
	}

	/**
		* Builds the controlled MOVED activity summary. It contains exactly two
		* keys: {@code fromStatusCode} and {@code toStatusCode}. No user text,
		* identity metadata or arbitrary fields are included.
		*/
	private Map<String, Object> movedSummary(WorkflowStatus from, WorkflowStatus to) {
		Map<String, Object> summary = new LinkedHashMap<>();
		summary.put("fromStatusCode", from.getCode());
		summary.put("toStatusCode", to.getCode());
		return summary;
	}

	/**
		* Returns the ordered activity log of the issue identified by its exact
		* immutable human key, authorizing {@code READ} against the issue's project.
		* Activities are ordered by {@code createdAt} ascending then {@code id}
		* ascending. Activity is append-only; no update or delete is performed.
		*/
	@Transactional(readOnly = true)
	public List<IssueActivityResponse> activity(String issueKey,
			MessorUserPrincipal principal) {
		Issue issue = loadIssue(issueKey, principal, ProjectPermission.READ);
		return activityRepository.findByIssueIdOrderByCreatedAtAscIdAsc(issue.getId())
				.stream()
				.map(IssueActivityResponse::from)
				.toList();
	}

	/**
		* Fail-closed helper for direct {@code /api/issues/{issueKey}} endpoints.
		* Loads the issue by its exact immutable human key and authorizes the given
		* permission against the issue's project. A missing, malformed or unknown key
		* yields {@code 404 ISSUE_NOT_FOUND}. An inaccessible project/issue (a
		* nonmember, or an unknown project) is translated into the same
		* {@code 404 ISSUE_NOT_FOUND} so the endpoint never reveals whether an
		* inaccessible issue or project exists. A known member who can see the
		* project/issue but lacks the requested mutation permission keeps the
		* {@code 403 FORBIDDEN} response. {@code PROJECT_NOT_FOUND} is never returned
		* from these direct endpoints.
		*/
	private Issue loadIssue(String issueKey, MessorUserPrincipal principal,
			ProjectPermission permission) {
		Issue issue = issueRepository.findByHumanKey(issueKey)
				.orElseThrow(() -> new ApiProblemException(HttpStatus.NOT_FOUND,
						"ISSUE_NOT_FOUND", "İş bulunamadı."));
		try {
			authorizationService.requireProject(issue.getProject().getKey(), principal,
					permission);
		}
		catch (ApiProblemException ex) {
			if ("PROJECT_NOT_FOUND".equals(ex.getProblem().getProperties().get("code"))) {
				throw new ApiProblemException(HttpStatus.NOT_FOUND, "ISSUE_NOT_FOUND",
						"İş bulunamadı.");
			}
			throw ex;
		}
		return issue;
	}

	/**
		* Builds the controlled UPDATED activity summary. It contains exactly two
		* keys: {@code changedFields} (the deterministic ordered list of fields that
		* actually changed: title, description, assigneeId) and {@code assigneeId}
		* (the resulting active assignee UUID, or JSON null when unassigned). No
		* title/description contents, old values, email, names, credentials, request
		* JSON or arbitrary client fields are ever included.
		*/
	private Map<String, Object> updatedSummary(List<String> changedFields,
			UserAccount assignee) {
		Map<String, Object> summary = new LinkedHashMap<>();
		// Freeze the changedFields list here so the summary is immutable even if
		// the entity/DTO layer also protects it.
		summary.put("changedFields", List.copyOf(changedFields));
		summary.put("assigneeId", assignee != null ? assignee.getId() : null);
		return summary;
	}

	/**
		* Builds the controlled ARCHIVED activity summary. It contains exactly one
		* key: {@code statusCode} (the current workflow status code). No user text or
		* identity metadata is included.
		*/
	private Map<String, Object> archivedSummary(Issue issue) {
		Map<String, Object> summary = new LinkedHashMap<>();
		summary.put("statusCode", issue.getWorkflowStatus().getCode());
		return summary;
	}

	/**
		* Validates that the assignee is a current member of the same project with an
	 * {@code ACTIVE} account. {@code VIEWER} members are assignable. Unknown,
	 * cross-project, nonmember, and disabled users all yield the same safe
	 * {@code 400 INVALID_ASSIGNEE} response so the endpoint never reveals whether
	 * an unrelated user account exists. The user is only loaded through the
	 * membership row of the same project, never from an unrelated context.
	 */
	private UserAccount requireActiveSameProjectMember(UUID projectId, UUID assigneeId) {
		ProjectMember member = memberRepository.findByProjectIdAndUserId(projectId, assigneeId)
				.orElseThrow(() -> new ApiProblemException(HttpStatus.BAD_REQUEST,
						"INVALID_ASSIGNEE", "Atanan kullanıcı bu projenin üyesi değil."));
		if (member.getUser().getStatus() != UserStatus.ACTIVE) {
			throw new ApiProblemException(HttpStatus.BAD_REQUEST, "INVALID_ASSIGNEE",
					"Atanan kullanıcı bu projenin üyesi değil.");
		}
		return member.getUser();
	}

	/**
	 * Builds the controlled CREATED activity summary. It contains exactly the
	 * server-derived {@code type}, {@code statusCode} and {@code assigneeId}
	 * (JSON null when unassigned). No title, description, email, names,
	 * credentials, request JSON or arbitrary client fields are ever included.
	 */
	private Map<String, Object> createdSummary(Issue issue, WorkflowStatus status,
			UserAccount assignee) {
		Map<String, Object> summary = new LinkedHashMap<>();
		summary.put("type", issue.getType().name());
		summary.put("statusCode", status.getCode());
		summary.put("assigneeId", assignee != null ? assignee.getId() : null);
		return summary;
	}

}
