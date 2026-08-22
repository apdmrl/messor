package io.github.apdmrl.messor.issue;

import io.github.apdmrl.messor.identity.MessorUserPrincipal;
import io.github.apdmrl.messor.identity.UserRole;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Application service for the authenticated principal's assigned work.
 *
 * <p>My Work always scopes results to the principal derived from the
 * authentication context; it never accepts a target user or assignee
 * identifier. An {@code ORG_ADMIN} sees their assigned issues across every
 * project (admins may access all projects), while a regular user sees only
 * issues in projects where they currently hold a membership, so issues in
 * nonmember or membership-removed projects are safely excluded. The archived
 * predicate is driven by the single {@link ArchiveFilter} contract. Ordering is
 * a validated allowlist field plus a deterministic {@code number ASC}
 * tie-breaker, so pagination never duplicates or drops rows.</p>
 */
@Service
public class MyWorkService {

	private final IssueRepository issueRepository;

	public MyWorkService(IssueRepository issueRepository) {
		this.issueRepository = issueRepository;
	}

	/**
	 * Returns a page of the principal's assigned issues matching the given
	 * filters. {@code projectKey}, {@code type} and {@code statusCode} are
	 * optional; {@code archive} defaults to {@link ArchiveFilter#ACTIVE}. The
	 * sort field/direction are already validated by the controller allowlist.
	 */
	@Transactional(readOnly = true)
	public IssuePageResponse myWork(MessorUserPrincipal principal, String projectKey,
			IssueType type, String statusCode, ArchiveFilter archive, int page, int size,
			String field, String direction) {
		Boolean archived = switch (archive) {
			case ACTIVE -> Boolean.FALSE;
			case ARCHIVED -> Boolean.TRUE;
			case ALL -> null;
		};
		Pageable pageable = PageRequest.of(page, size, buildSort(field, direction));
		Page<Issue> result;
		if (principal.getRole() == UserRole.ORG_ADMIN) {
			result = issueRepository.findMyWork(principal.getId(), projectKey, type,
					statusCode, archived, pageable);
		}
		else {
			result = issueRepository.findMyWorkInMemberProjects(principal.getId(),
					projectKey, type, statusCode, archived, pageable);
		}
		return IssuePageResponse.from(result);
	}

	private Sort buildSort(String field, String direction) {
		Sort.Direction primary = "desc".equals(direction) ? Sort.Direction.DESC
				: Sort.Direction.ASC;
		Sort sort = Sort.by(primary, field);
		if (!"number".equals(field)) {
			sort = sort.and(Sort.by(Sort.Direction.ASC, "number"));
		}
		return sort;
	}

}
