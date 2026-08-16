package io.github.apdmrl.messor.project;

import java.util.List;
import java.util.UUID;

import io.github.apdmrl.messor.identity.MessorUserPrincipal;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Membership endpoints. Controllers delegate to the application service; they
 * never contain business or authorization rules and never return JPA entities.
 */
@RestController
@RequestMapping("/api/projects/{projectKey}/members")
@Validated
public class ProjectMemberController {

	private final ProjectMemberService memberService;

	public ProjectMemberController(ProjectMemberService memberService) {
		this.memberService = memberService;
	}

	@GetMapping
	public ResponseEntity<List<ProjectMemberResponse>> list(
			@AuthenticationPrincipal MessorUserPrincipal principal,
			@PathVariable String projectKey) {
		List<ProjectMemberResponse> members = memberService.list(projectKey, principal);
		return ResponseEntity.ok()
				.cacheControl(CacheControl.noStore())
				.body(members);
	}

	@PostMapping
	public ResponseEntity<ProjectMemberResponse> add(
			@AuthenticationPrincipal MessorUserPrincipal principal,
			@PathVariable String projectKey,
			@Valid @RequestBody AddProjectMemberRequest request) {
		ProjectMemberResponse response = memberService.add(projectKey, request, principal);
		return ResponseEntity.status(HttpStatus.CREATED)
				.cacheControl(CacheControl.noStore())
				.body(response);
	}

	@PatchMapping("/{userId}")
	public ResponseEntity<ProjectMemberResponse> changeRole(
			@AuthenticationPrincipal MessorUserPrincipal principal,
			@PathVariable String projectKey,
			@PathVariable UUID userId,
			@Valid @RequestBody ChangeProjectMemberRoleRequest request) {
		ProjectMemberResponse response = memberService.changeRole(projectKey, userId, request, principal);
		return ResponseEntity.ok()
				.cacheControl(CacheControl.noStore())
				.body(response);
	}

	@DeleteMapping("/{userId}")
	public ResponseEntity<Void> remove(
			@AuthenticationPrincipal MessorUserPrincipal principal,
			@PathVariable String projectKey,
			@PathVariable UUID userId,
			@RequestParam @NotNull @PositiveOrZero Long expectedVersion) {
		memberService.remove(projectKey, userId, expectedVersion, principal);
		return ResponseEntity.noContent()
				.cacheControl(CacheControl.noStore())
				.build();
	}

}
