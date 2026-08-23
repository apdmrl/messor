package io.github.apdmrl.messor.auth;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import io.github.apdmrl.messor.identity.MessorUserPrincipal;

@RestController
public class AuthController {
	@GetMapping("/api/auth/me")
	public ResponseEntity<UserSummary> me(
			@AuthenticationPrincipal MessorUserPrincipal principal) {
		UserSummary response = UserSummary.from(principal);

		return ResponseEntity.ok()
				.cacheControl(CacheControl.noStore())
				.body(response);
	}

}
