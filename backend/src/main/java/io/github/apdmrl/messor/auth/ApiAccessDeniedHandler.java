package io.github.apdmrl.messor.auth;

import java.io.IOException;
import java.net.URI;

import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.csrf.InvalidCsrfTokenException;
import org.springframework.security.web.csrf.MissingCsrfTokenException;
import org.springframework.stereotype.Component;

@Component
public class ApiAccessDeniedHandler implements AccessDeniedHandler {

	private static final String CODE_CSRF = "INVALID_CSRF_TOKEN";
	private static final String CODE_FORBIDDEN = "FORBIDDEN";

	private final SecurityProblemWriter writer;

	public ApiAccessDeniedHandler(SecurityProblemWriter writer) {
		this.writer = writer;
	}

	@Override
	public void handle(HttpServletRequest request, HttpServletResponse response,
			AccessDeniedException accessDeniedException) throws IOException, ServletException {
		ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
		problem.setType(URI.create("about:blank"));
		problem.setTitle(HttpStatus.FORBIDDEN.getReasonPhrase());
		problem.setInstance(URI.create(request.getRequestURI()));

		if (accessDeniedException instanceof MissingCsrfTokenException
				|| accessDeniedException instanceof InvalidCsrfTokenException) {
			problem.setDetail("CSRF doğrulaması başarısız.");
			problem.setProperty("code", CODE_CSRF);
		}
		else {
			problem.setDetail("Bu işlem için yetkiniz yok.");
			problem.setProperty("code", CODE_FORBIDDEN);
		}

		writer.write(response, problem);
	}

}
