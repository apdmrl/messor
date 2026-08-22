package io.github.apdmrl.messor.comment;

import java.util.List;
import java.util.UUID;

import io.github.apdmrl.messor.common.api.ApiProblemException;
import io.github.apdmrl.messor.identity.MessorUserPrincipal;
import io.github.apdmrl.messor.identity.UserAccount;
import io.github.apdmrl.messor.identity.UserAccountRepository;
import io.github.apdmrl.messor.issue.Issue;
import io.github.apdmrl.messor.issue.IssueRepository;
import io.github.apdmrl.messor.project.ProjectAccess;
import io.github.apdmrl.messor.project.ProjectAuthorizationService;
import io.github.apdmrl.messor.project.ProjectPermission;
import io.github.apdmrl.messor.project.ProjectRole;

import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Application service for issue comments.
 *
 * <p>Every operation is authorized against the comment's project through the
 * focused {@link ProjectAuthorizationService}. Authorization always derives from
 * persistent project membership plus the authenticated principal; a
 * client-supplied author, issue or project is never trusted.</p>
 *
 * <p>Concurrency: create takes a pessimistic write lock on the issue row before
 * inserting, then rechecks the archived flag after the wait, so a concurrent
 * archive/update can never slip a new comment in after the archived check. Edit
 * and delete lock the comment row with a pessimistic write lock, then recheck
 * tombstone state, authorization and {@code expectedVersion} after the lock.
 * Two concurrent requests carrying the same expectedVersion serialize: exactly
 * one succeeds and the stale waiter returns {@code 409 VERSION_CONFLICT}.</p>
 */
@Service
public class CommentService {

	private static final int BODY_MAX_LENGTH = 5000;

	private final ProjectAuthorizationService authorizationService;
	private final IssueRepository issueRepository;
	private final IssueCommentRepository commentRepository;
	private final UserAccountRepository userAccountRepository;
	private final EntityManager entityManager;

	public CommentService(ProjectAuthorizationService authorizationService,
			IssueRepository issueRepository,
			IssueCommentRepository commentRepository,
			UserAccountRepository userAccountRepository,
			EntityManager entityManager) {
		this.authorizationService = authorizationService;
		this.issueRepository = issueRepository;
		this.commentRepository = commentRepository;
		this.userAccountRepository = userAccountRepository;
		this.entityManager = entityManager;
	}

	/**
	 * Returns every comment (active and tombstones) of the issue in stable
	 * created-at-then-id order, authorizing {@code READ} against the issue's
	 * project. Deleted comments keep their original position. Archived issues
	 * remain readable.
	 */
	@Transactional(readOnly = true)
	public List<CommentResponse> list(String issueKey, MessorUserPrincipal principal) {
		Issue issue = loadIssue(issueKey, principal, ProjectPermission.READ);
		return commentRepository.findByIssueIdOrderByCreatedAtAscIdAsc(issue.getId())
				.stream()
				.map(CommentResponse::from)
				.toList();
	}

	/**
	 * Creates a comment on the issue, authorizing {@code COMMENT}. The author is
	 * derived from the authenticated principal; the issue and project are
	 * resolved from the route key. A whitespace-only body is rejected with
	 * {@code VALIDATION_FAILED}; accepted leading/trailing whitespace is
	 * preserved. Commenting on an archived issue is not allowed and returns a
	 * safe {@code 404 ISSUE_NOT_FOUND}.
	 *
	 * <p>Locking: the issue row is refreshed under a pessimistic write lock and
	 * the archived flag is rechecked against the fresh committed view after any
	 * wait. This serializes create against a concurrent archive/update on the
	 * single issue-row lock; no other lock is taken afterwards, so no reverse
	 * lock cycle is possible (see the class-level concurrency note).</p>
	 */
	@Transactional
	public CommentResponse create(String issueKey, CreateCommentRequest request,
			MessorUserPrincipal principal) {
		Issue issue = loadIssue(issueKey, principal, ProjectPermission.COMMENT);
		// Serialize against archive/update on the issue row, then recheck the
		// archived flag against the fresh committed view after any wait.
		entityManager.refresh(issue, LockModeType.PESSIMISTIC_WRITE);
		if (issue.isArchived()) {
			throw new ApiProblemException(HttpStatus.NOT_FOUND, "ISSUE_NOT_FOUND",
					"İş bulunamadı.");
		}
		String body = requireValidBody(request.body());
		UserAccount author = userAccountRepository.getReferenceById(principal.getId());
		IssueComment comment = commentRepository.save(IssueComment.create(issue, author, body));
		entityManager.flush();
		return CommentResponse.from(comment);
	}

	/**
	 * Edits the body of a comment. Only the original author may edit, and the
	 * author must still hold {@code COMMENT}. {@code PROJECT_LEAD}/{@code ORG_ADMIN}
	 * never edit another author's text. The comment row is locked, then tombstone
	 * state, authorization and {@code expectedVersion} are rechecked before the
	 * body is replaced.
	 */
	@Transactional
	public CommentResponse update(UUID commentId, UpdateCommentRequest request,
			MessorUserPrincipal principal) {
		IssueComment comment = loadAndLockComment(commentId, principal,
				ProjectPermission.COMMENT);
		if (comment.isDeleted()) {
			throw commentNotFound();
		}
		if (!principal.getId().equals(comment.getAuthor().getId())) {
			throw forbidden();
		}
		if (request.expectedVersion() != comment.getVersion()) {
			throw versionConflict();
		}
		String body = requireValidBody(request.body());
		comment.replaceBody(body);
		entityManager.flush();
		return CommentResponse.from(comment);
	}

	/**
	 * Deletes a comment by converting it to a retained tombstone
	 * (body nulled, deleted set). The author may delete their own comment while
	 * still authorized to comment; {@code PROJECT_LEAD} and {@code ORG_ADMIN}
	 * (reported as the effective {@code PROJECT_LEAD} role) may moderate any
	 * comment. A {@code MEMBER} deleting another author's comment is rejected
	 * with {@code 403 FORBIDDEN}, and a {@code VIEWER} with the same code. The
	 * row is locked, then tombstone state, authorization and
	 * {@code expectedVersion} are rechecked. Repeated deletion of an already
	 * tombstoned comment returns a safe {@code 404 COMMENT_NOT_FOUND}.
	 */
	@Transactional
	public CommentResponse delete(UUID commentId, long expectedVersion,
			MessorUserPrincipal principal) {
		IssueComment comment = loadAndLockComment(commentId, principal,
				ProjectPermission.COMMENT);
		if (comment.isDeleted()) {
			throw commentNotFound();
		}

		boolean isAuthor = principal.getId().equals(comment.getAuthor().getId());
		ProjectAccess access = accessFor(comment, principal, ProjectPermission.COMMENT);
		boolean isModerator = access.effectiveRole() == ProjectRole.PROJECT_LEAD;

		if (!isAuthor && !isModerator) {
			throw forbidden();
		}
		if (expectedVersion != comment.getVersion()) {
			throw versionConflict();
		}

		comment.tombstone();
		entityManager.flush();
		return CommentResponse.from(comment);
	}

	/**
	 * Loads the issue by its exact immutable human key and authorizes the given
	 * permission against the issue's project. A missing or unknown key yields
	 * {@code 404 ISSUE_NOT_FOUND}. An inaccessible project/issue (a nonmember, or
	 * an unknown project) is translated into the same {@code 404 ISSUE_NOT_FOUND}
	 * so the endpoint never reveals whether an inaccessible issue or project
	 * exists. A known member who can see the issue but lacks the permission keeps
	 * the {@code 403 FORBIDDEN} response.
	 */
	private Issue loadIssue(String issueKey, MessorUserPrincipal principal,
			ProjectPermission permission) {
		Issue issue = issueRepository.findByHumanKey(issueKey)
				.orElseThrow(() -> new ApiProblemException(HttpStatus.NOT_FOUND,
						"ISSUE_NOT_FOUND", "İş bulunamadı."));
		requireProjectAccess(issue, principal, permission);
		return issue;
	}

	/**
	 * Authorizes the given permission against an issue's project, translating an
	 * inaccessible project into {@code ISSUE_NOT_FOUND} so direct comment
	 * endpoints never leak whether a project exists.
	 */
	private ProjectAccess requireProjectAccess(Issue issue, MessorUserPrincipal principal,
			ProjectPermission permission) {
		try {
			return authorizationService.requireProject(issue.getProject().getKey(),
					principal, permission);
		}
		catch (ApiProblemException ex) {
			if ("PROJECT_NOT_FOUND".equals(ex.getProblem().getProperties().get("code"))) {
				throw issueNotFound();
			}
			throw ex;
		}
	}

	/**
	 * Authorizes {@code READ} against the comment's issue/project and locks the
	 * comment row with a pessimistic write lock, returning the locked entity.
	 * The lock serializes concurrent edits/deletions so the tombstone state,
	 * authorization and expectedVersion checks performed by the caller run
	 * against a fresh, committed view after any wait.
	 */
	private IssueComment loadAndLockComment(UUID commentId, MessorUserPrincipal principal,
			ProjectPermission permission) {
		IssueComment comment = commentRepository.lockById(commentId)
				.orElseThrow(this::commentNotFound);
		accessFor(comment, principal, permission);
		return comment;
	}

	/**
	 * Authorizes the given permission against the project that owns a comment.
	 * An inaccessible project (nonmember) is translated into
	 * {@code COMMENT_NOT_FOUND}; a known member lacking the permission keeps the
	 * {@code 403 FORBIDDEN} response.
	 */
	private ProjectAccess accessFor(IssueComment comment, MessorUserPrincipal principal,
			ProjectPermission permission) {
		return requireProjectAccess(comment.getIssue(), principal, permission);
	}

	private String requireValidBody(String body) {
		if (body == null || body.isBlank()) {
			throw new ApiProblemException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED",
					"Yorum içeriği boş olamaz.");
		}
		if (body.length() > BODY_MAX_LENGTH) {
			throw new ApiProblemException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED",
					"Yorum içeriği en fazla 5000 karakter olabilir.");
		}
		return body;
	}

	private ApiProblemException commentNotFound() {
		return new ApiProblemException(HttpStatus.NOT_FOUND, "COMMENT_NOT_FOUND",
				"Yorum bulunamadı.");
	}

	private ApiProblemException issueNotFound() {
		return new ApiProblemException(HttpStatus.NOT_FOUND, "ISSUE_NOT_FOUND",
				"İş bulunamadı.");
	}

	private ApiProblemException forbidden() {
		return new ApiProblemException(HttpStatus.FORBIDDEN, "FORBIDDEN",
				"Bu işlem için yetkiniz yok.");
	}

	private ApiProblemException versionConflict() {
		return new ApiProblemException(HttpStatus.CONFLICT, "VERSION_CONFLICT",
				"Kayıt başka bir işlem tarafından güncellendi.");
	}

}
