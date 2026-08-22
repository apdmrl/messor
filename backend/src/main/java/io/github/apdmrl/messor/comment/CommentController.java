package io.github.apdmrl.messor.comment;

import java.util.UUID;

import io.github.apdmrl.messor.common.api.ApiProblemException;
import io.github.apdmrl.messor.identity.MessorUserPrincipal;

import jakarta.validation.Valid;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Comment-scoped endpoints under {@code /api/comments/{commentId}}.
 *
 * <p>Edit and delete authorize against the comment's project and lock the
 * comment row before rechecking tombstone state, authorization and
 * {@code expectedVersion}. Inaccessible or unknown comments return a safe
 * {@code 404 COMMENT_NOT_FOUND}; {@code PROJECT_NOT_FOUND} is never returned.</p>
 */
@RestController
@RequestMapping("/api/comments")
@Validated
public class CommentController {

	private final CommentService commentService;

	public CommentController(CommentService commentService) {
		this.commentService = commentService;
	}

	@PatchMapping("/{commentId}")
	public ResponseEntity<CommentResponse> update(
			@AuthenticationPrincipal MessorUserPrincipal principal,
			@PathVariable UUID commentId,
			@Valid @RequestBody UpdateCommentRequest request) {
		CommentResponse response = commentService.update(commentId, request, principal);
		return ResponseEntity.ok()
				.cacheControl(CacheControl.noStore())
				.body(response);
	}

	@DeleteMapping("/{commentId}")
	public ResponseEntity<CommentResponse> delete(
			@AuthenticationPrincipal MessorUserPrincipal principal,
			@PathVariable UUID commentId,
			@RequestParam(value = "expectedVersion", required = false) Long expectedVersion) {
		// Validate the version at the binding/controller boundary so a missing or
		// negative value is a well-formed RFC 9457 problem+json VALIDATION_FAILED,
		// never a framework binding error or a leaked exception detail. A value of
		// zero is valid (the initial comment version).
		if (expectedVersion == null || expectedVersion < 0) {
			throw new ApiProblemException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED",
					"İstek doğrulama kurallarını karşılamıyor.");
		}
		CommentResponse response = commentService.delete(commentId, expectedVersion, principal);
		return ResponseEntity.ok()
				.cacheControl(CacheControl.noStore())
				.body(response);
	}

}
