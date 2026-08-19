package io.github.apdmrl.messor.issue;

import java.util.List;

import io.github.apdmrl.messor.identity.MessorUserPrincipal;

import jakarta.validation.Valid;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Direct issue lifecycle endpoints under {@code /api/issues/{issueKey}}.
 *
 * <p>Every endpoint authorizes against the issue's project and never returns
 * {@code PROJECT_NOT_FOUND}; an inaccessible issue or project is reported as
 * {@code 404 ISSUE_NOT_FOUND}.</p>
 */
@RestController
@RequestMapping("/api/issues")
@Validated
public class IssueLifecycleController {

	private final IssueService issueService;

	public IssueLifecycleController(IssueService issueService) {
		this.issueService = issueService;
	}

	@GetMapping("/{issueKey}")
	public ResponseEntity<IssueResponse> get(
			@AuthenticationPrincipal MessorUserPrincipal principal,
			@PathVariable String issueKey) {
		IssueResponse response = issueService.get(issueKey, principal);
		return ResponseEntity.ok()
				.cacheControl(CacheControl.noStore())
				.body(response);
	}

	@PatchMapping("/{issueKey}")
	public ResponseEntity<IssueResponse> update(
			@AuthenticationPrincipal MessorUserPrincipal principal,
			@PathVariable String issueKey,
			@Valid @RequestBody UpdateIssueRequest request) {
		IssueResponse response = issueService.update(issueKey, request, principal);
		return ResponseEntity.ok()
				.cacheControl(CacheControl.noStore())
				.body(response);
	}

	@PatchMapping("/{issueKey}/move")
	public ResponseEntity<IssueResponse> move(
			@AuthenticationPrincipal MessorUserPrincipal principal,
			@PathVariable String issueKey,
			@Valid @RequestBody MoveIssueRequest request) {
		IssueResponse response = issueService.move(issueKey, request, principal);
		return ResponseEntity.ok()
				.cacheControl(CacheControl.noStore())
				.body(response);
	}

	@PostMapping("/{issueKey}/archive")
	public ResponseEntity<IssueResponse> archive(
			@AuthenticationPrincipal MessorUserPrincipal principal,
			@PathVariable String issueKey,
			@Valid @RequestBody ArchiveIssueRequest request) {
		IssueResponse response = issueService.archive(issueKey, request, principal);
		return ResponseEntity.ok()
				.cacheControl(CacheControl.noStore())
				.body(response);
	}

	@GetMapping("/{issueKey}/activity")
	public ResponseEntity<List<IssueActivityResponse>> activity(
			@AuthenticationPrincipal MessorUserPrincipal principal,
			@PathVariable String issueKey) {
		List<IssueActivityResponse> response = issueService.activity(issueKey, principal);
		return ResponseEntity.ok()
				.cacheControl(CacheControl.noStore())
				.body(response);
	}

}
