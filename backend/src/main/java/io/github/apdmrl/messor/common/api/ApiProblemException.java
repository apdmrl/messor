package io.github.apdmrl.messor.common.api;

import java.net.URI;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;

/**
 * Application exception that carries a stable RFC 9457 {@link ProblemDetail}.
 *
 * <p>The {@code code} extension is used by clients for programmatic control.
 * Internal exception messages and stack traces are never included.</p>
 */
public class ApiProblemException extends RuntimeException {

	private final ProblemDetail problem;

	public ApiProblemException(HttpStatus status, String code, String detail) {
		super(detail);
		this.problem = ProblemDetail.forStatus(status);
		this.problem.setType(URI.create("about:blank"));
		this.problem.setTitle(status.getReasonPhrase());
		this.problem.setDetail(detail);
		this.problem.setProperty("code", code);
	}

	public ProblemDetail getProblem() {
		return problem;
	}

}
