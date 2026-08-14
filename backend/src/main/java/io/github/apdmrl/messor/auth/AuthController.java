package io.github.apdmrl.messor.auth;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AuthController {

	@GetMapping("/api/auth/csrf")
	public ResponseEntity<CsrfTokenResponse> csrf(CsrfToken token) {
		CsrfTokenResponse response = new CsrfTokenResponse(
				token.getHeaderName(),
				token.getParameterName(),
				token.getToken());

		return ResponseEntity.ok()
				.cacheControl(CacheControl.noStore())
				.body(response);
	}

}
