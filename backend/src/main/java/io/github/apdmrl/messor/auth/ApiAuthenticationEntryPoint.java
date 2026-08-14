package io.github.apdmrl.messor.auth;

import java.io.IOException;
import java.net.URI;

import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.stereotype.Component;

@Component
public class ApiAuthenticationEntryPoint implements AuthenticationEntryPoint {

	private final SecurityProblemWriter writer;

	public ApiAuthenticationEntryPoint(SecurityProblemWriter writer) {
		this.writer = writer;
	}

	@Override
	public void commence(HttpServletRequest request, HttpServletResponse response,
			AuthenticationException authException) throws IOException, ServletException {
		ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.UNAUTHORIZED);
		problem.setType(URI.create("about:blank"));
		problem.setTitle(HttpStatus.UNAUTHORIZED.getReasonPhrase());
		problem.setDetail("Oturum açmanız gerekiyor.");
		problem.setInstance(URI.create(request.getRequestURI()));
		problem.setProperty("code", "UNAUTHENTICATED");

		writer.write(response, problem);
	}

}
