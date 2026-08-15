package io.github.apdmrl.messor.project;

import java.util.List;

import io.github.apdmrl.messor.common.api.ApiProblemException;
import io.github.apdmrl.messor.common.api.PageResponse;
import io.github.apdmrl.messor.identity.MessorUserPrincipal;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/projects")
@Validated
public class ProjectController {

	private static final List<String> ALLOWED_SORT_FIELDS =
			List.of("key", "name", "createdAt", "updatedAt");

	private final ProjectService projectService;

	public ProjectController(ProjectService projectService) {
		this.projectService = projectService;
	}

	@GetMapping
	public ResponseEntity<PageResponse<ProjectSummaryResponse>> list(
			@AuthenticationPrincipal MessorUserPrincipal principal,
			@RequestParam(defaultValue = "0") @Min(0) int page,
			@RequestParam(defaultValue = "20") @Min(1) @Max(100) int size,
			@RequestParam(defaultValue = "key") String sort) {

		String sortField = sort;
		String direction = "asc";
		if (sort.startsWith("-")) {
			sortField = sort.substring(1);
			direction = "desc";
		}
		else if (sort.contains(",")) {
			String[] parts = sort.split(",", 2);
			sortField = parts[0];
			direction = parts[1];
		}
		if (!ALLOWED_SORT_FIELDS.contains(sortField)
				|| !(direction.equals("asc") || direction.equals("desc"))) {
			throw new ApiProblemException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED",
					"İstek doğrulama kurallarını karşılamıyor.");
		}

		PageResponse<ProjectSummaryResponse> response =
				projectService.list(principal, page, size, sortField, direction);

		return ResponseEntity.ok()
				.cacheControl(CacheControl.noStore())
				.body(response);
	}

	@PostMapping
	public ResponseEntity<ProjectDetailResponse> create(
			@AuthenticationPrincipal MessorUserPrincipal principal,
			@Valid @RequestBody CreateProjectRequest request) {
		ProjectDetailResponse response = projectService.create(request, principal);
		return ResponseEntity.status(HttpStatus.CREATED)
				.cacheControl(CacheControl.noStore())
				.body(response);
	}

	@GetMapping("/{projectKey}")
	public ResponseEntity<ProjectDetailResponse> get(
			@AuthenticationPrincipal MessorUserPrincipal principal,
			@PathVariable String projectKey) {
		ProjectDetailResponse response = projectService.get(projectKey, principal);
		return ResponseEntity.ok()
				.cacheControl(CacheControl.noStore())
				.body(response);
	}

	@PatchMapping("/{projectKey}")
	public ResponseEntity<ProjectDetailResponse> update(
			@AuthenticationPrincipal MessorUserPrincipal principal,
			@PathVariable String projectKey,
			@Valid @RequestBody UpdateProjectRequest request) {
		ProjectDetailResponse response = projectService.update(projectKey, request, principal);
		return ResponseEntity.ok()
				.cacheControl(CacheControl.noStore())
				.body(response);
	}

}
