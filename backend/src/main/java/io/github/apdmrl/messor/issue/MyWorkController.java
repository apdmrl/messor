package io.github.apdmrl.messor.issue;

import java.util.Set;

import io.github.apdmrl.messor.common.api.ApiProblemException;
import io.github.apdmrl.messor.identity.MessorUserPrincipal;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Controller for the authenticated principal's assigned work.
 *
 * <p>{@code GET /api/my-work} derives the principal from the authentication
 * context. The controller validates bounded pagination, a strict sort
 * allowlist, the single {@link ArchiveFilter} contract, and rejects any attempt
 * to select another user through {@code userId} or {@code assigneeId}. Raw sort
 * values are read from the request so Spring never comma-splits them and
 * repeated sort parameters are rejected explicitly. The response reuses the
 * existing safe {@link IssuePageResponse}/{@link IssueResponse} contract.</p>
 */
@RestController
@RequestMapping("/api/my-work")
@Validated
public class MyWorkController {

	private static final Set<String> ALLOWED_SORT_FIELDS = Set.of(
			"createdAt", "updatedAt", "number", "title");
	private static final Set<String> ALLOWED_SORT_DIRECTIONS = Set.of("asc", "desc");
	private static final String DEFAULT_SORT = "number,asc";
	private static final Set<String> FORBIDDEN_TARGET_PARAMS =
			Set.of("userId", "assigneeId", "assignee");

	private final MyWorkService myWorkService;

	public MyWorkController(MyWorkService myWorkService) {
		this.myWorkService = myWorkService;
	}

	@GetMapping
	public ResponseEntity<IssuePageResponse> myWork(
			@AuthenticationPrincipal MessorUserPrincipal principal,
			@RequestParam(value = "page", required = false) Integer page,
			@RequestParam(value = "size", required = false) Integer size,
			@RequestParam(value = "project", required = false) String project,
			@RequestParam(value = "type", required = false) IssueType type,
			@RequestParam(value = "status", required = false) String status,
			@RequestParam(value = "archive", required = false) String archive,
			HttpServletRequest request) {

		// Never accept a target user/assignee identifier: My Work is always scoped
		// to the authenticated principal.
		for (String param : FORBIDDEN_TARGET_PARAMS) {
			if (request.getParameter(param) != null) {
				throw validationFailed();
			}
		}

		int pageNum = page == null ? 0 : page;
		int sizeNum = size == null ? 20 : size;
		if (pageNum < 0 || pageNum > 10000) {
			throw validationFailed();
		}
		if (sizeNum < 1 || sizeNum > 100) {
			throw validationFailed();
		}

		ArchiveFilter archiveFilter;
		if (archive == null || archive.isBlank()) {
			archiveFilter = ArchiveFilter.ACTIVE;
		}
		else {
			try {
				archiveFilter = ArchiveFilter.valueOf(archive.trim().toUpperCase());
			}
			catch (IllegalArgumentException ex) {
				throw validationFailed();
			}
		}

		String[] sortSpec = parseSort(resolveSort(request.getParameterValues("sort")));

		IssuePageResponse response = myWorkService.myWork(principal, project, type,
				status, archiveFilter, pageNum, sizeNum, sortSpec[0], sortSpec[1]);
		return ResponseEntity.ok()
				.cacheControl(CacheControl.noStore())
				.body(response);
	}

	private String resolveSort(String[] sortValues) {
		if (sortValues == null || sortValues.length == 0) {
			return DEFAULT_SORT;
		}
		if (sortValues.length > 1) {
			throw validationFailed();
		}
		return sortValues[0];
	}

	private String[] parseSort(String sort) {
		String[] parts = sort.split(",");
		if (parts.length != 2) {
			throw validationFailed();
		}
		String field = parts[0];
		String direction = parts[1];
		if (field.startsWith("-") || !ALLOWED_SORT_FIELDS.contains(field)) {
			throw validationFailed();
		}
		if (!ALLOWED_SORT_DIRECTIONS.contains(direction)) {
			throw validationFailed();
		}
		return parts;
	}

	private ApiProblemException validationFailed() {
		return new ApiProblemException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED",
				"İstek doğrulama kurallarını karşılamıyor.");
	}

}
