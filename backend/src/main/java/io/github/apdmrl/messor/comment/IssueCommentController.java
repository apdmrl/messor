package io.github.apdmrl.messor.comment;

import java.net.URI;
import java.util.List;

import io.github.apdmrl.messor.identity.MessorUserPrincipal;

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
import org.springframework.web.bind.annotation.RestController;

/**
 * Issue-scoped comment endpoints under {@code /api/issues/{issueKey}/comments}.
 *
 * <p>Every endpoint authorizes against the issue's project and never returns
 * {@code PROJECT_NOT_FOUND}; an inaccessible issue or project is reported as
 * {@code 404 ISSUE_NOT_FOUND}.</p>
 */
@RestController
@RequestMapping("/api/issues/{issueKey}/comments")
@Validated
public class IssueCommentController {

	private final CommentService commentService;

	public IssueCommentController(CommentService commentService) {
		this.commentService = commentService;
	}

	@GetMapping
	public ResponseEntity<List<CommentResponse>> list(
			@AuthenticationPrincipal MessorUserPrincipal principal,
			@PathVariable String issueKey) {
		List<CommentResponse> response = commentService.list(issueKey, principal);
		return ResponseEntity.ok()
				.cacheControl(CacheControl.noStore())
				.body(response);
	}

	@PostMapping
	public ResponseEntity<CommentResponse> create(
			@AuthenticationPrincipal MessorUserPrincipal principal,
			@PathVariable String issueKey,
			@Valid @RequestBody CreateCommentRequest request) {
		CommentResponse response = commentService.create(issueKey, request, principal);
		return ResponseEntity.status(HttpStatus.CREATED)
				.location(URI.create("/api/comments/" + response.id()))
				.cacheControl(CacheControl.noStore())
				.body(response);
	}

}
