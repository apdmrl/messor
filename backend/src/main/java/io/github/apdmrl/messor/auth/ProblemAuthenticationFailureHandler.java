package io.github.apdmrl.messor.auth;

import java.io.IOException;
import java.net.URI;

import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.stereotype.Component;

@Component
public class ProblemAuthenticationFailureHandler implements AuthenticationFailureHandler {

	private final SecurityProblemWriter writer;

	public ProblemAuthenticationFailureHandler(SecurityProblemWriter writer) {
		this.writer = writer;
	}

	@Override
	public void onAuthenticationFailure(HttpServletRequest request, HttpServletResponse response,
			AuthenticationException exception) throws IOException, ServletException {
		ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.UNAUTHORIZED);
		problem.setType(URI.create("about:blank"));
		problem.setTitle(HttpStatus.UNAUTHORIZED.getReasonPhrase());
		problem.setDetail("E-posta veya parola hatalı.");
		problem.setInstance(URI.create("/api/auth/login"));
		problem.setProperty("code", "AUTHENTICATION_FAILED");

		writer.write(response, problem);
	}

}
