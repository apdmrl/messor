package io.github.apdmrl.messor.common.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;

/**
 * Unit tests for {@link ApiExceptionHandler} mapping of framework and
 * persistence exceptions. These verify that a data-integrity violation that is
 * not the project key unique constraint is never mislabeled as
 * {@code PROJECT_KEY_ALREADY_EXISTS}.
 */
class ApiExceptionHandlerTest {

	private final ApiExceptionHandler handler = new ApiExceptionHandler();

	private HttpServletRequest request(String uri) {
		HttpServletRequest request = mock(HttpServletRequest.class);
		when(request.getRequestURI()).thenReturn(uri);
		return request;
	}

	@Test
	void dataIntegrityViolationNotProjectKeyMapsToGenericConflict() {
		// A violation caused by a constraint other than the project key unique
		// constraint (e.g. a future membership constraint) must not be reported
		// as PROJECT_KEY_ALREADY_EXISTS.
		DataIntegrityViolationException ex =
				new DataIntegrityViolationException("could not execute statement",
						new org.hibernate.exception.ConstraintViolationException(
								"could not execute statement",
								new java.sql.SQLException("duplicate key value violates unique constraint"),
								"uq_project_member_project_user"));

		ResponseEntity<ProblemDetail> response =
				handler.handleDataIntegrityViolation(ex, request("/api/projects"));

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
		ProblemDetail problem = response.getBody();
		assertThat(problem).isNotNull();
		assertThat(problem.getProperties().get("code")).isEqualTo("CONFLICT");
		assertThat(problem.getProperties().get("code"))
				.isNotEqualTo("PROJECT_KEY_ALREADY_EXISTS");
	}

	@Test
	void dataIntegrityViolationWithoutConstraintNameMapsToGenericConflict() {
		// Even when no constraint name is available, the handler must fail
		// closed to a generic conflict rather than guessing a domain reason.
		DataIntegrityViolationException ex =
				new DataIntegrityViolationException("could not execute statement");

		ResponseEntity<ProblemDetail> response =
				handler.handleDataIntegrityViolation(ex, request("/api/projects"));

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
		ProblemDetail problem = response.getBody();
		assertThat(problem).isNotNull();
		assertThat(problem.getProperties().get("code")).isEqualTo("CONFLICT");
		assertThat(problem.getProperties().get("code"))
				.isNotEqualTo("PROJECT_KEY_ALREADY_EXISTS");
	}

}
