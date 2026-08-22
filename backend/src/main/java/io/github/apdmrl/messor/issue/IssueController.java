package io.github.apdmrl.messor.issue;

import java.net.URI;
import java.util.Set;
import java.util.UUID;

import io.github.apdmrl.messor.common.api.ApiProblemException;
import io.github.apdmrl.messor.identity.MessorUserPrincipal;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/projects/{projectKey}/issues")
@Validated
public class IssueController {

	private static final Set<String> ALLOWED_SORT_FIELDS = Set.of(
			"createdAt", "updatedAt", "number", "title");
	private static final Set<String> ALLOWED_SORT_DIRECTIONS = Set.of("asc", "desc");
	private static final String DEFAULT_SORT = "number,asc";

	private final IssueService issueService;

	public IssueController(IssueService issueService) {
		this.issueService = issueService;
	}

	@PostMapping
	public ResponseEntity<IssueResponse> create(
			@AuthenticationPrincipal MessorUserPrincipal principal,
			@PathVariable String projectKey,
			@Valid @RequestBody CreateIssueRequest request) {
		IssueResponse response = issueService.create(projectKey, request, principal);
		return ResponseEntity.status(HttpStatus.CREATED)
				.location(URI.create("/api/issues/" + response.issueKey()))
				.cacheControl(CacheControl.noStore())
				.body(response);
	}

	@GetMapping
	public ResponseEntity<IssuePageResponse> list(
			@AuthenticationPrincipal MessorUserPrincipal principal,
			@PathVariable String projectKey,
			@RequestParam(value = "page", required = false) Integer page,
			@RequestParam(value = "size", required = false) Integer size,
			@RequestParam(value = "type", required = false) IssueType type,
			@RequestParam(value = "status", required = false) String status,
			@RequestParam(value = "assignee", required = false) UUID assignee,
			@RequestParam(value = "archive", required = false) String archive,
			HttpServletRequest request) {
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
		// Read raw sort values from the request so Spring's List binding never
		// comma-splits a single "field,direction" value, and so repeated sort
		// parameters can be rejected explicitly.
		String[] sortSpec = parseSort(resolveSort(request.getParameterValues("sort")));
		IssuePageResponse response = issueService
				.list(projectKey, principal, pageNum, sizeNum, sortSpec[0], sortSpec[1],
						type, status, assignee, archiveFilter);
		return ResponseEntity.ok()
				.cacheControl(CacheControl.noStore())
				.body(response);
	}

	/**
		* Resolves the {@code sort} query parameter. Exactly one value is accepted;
		* repeated {@code sort} parameters (or any malformed value) yield
		* {@code VALIDATION_FAILED}. When absent, the default {@code number,asc} is
		* used.
		*/
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
