package io.github.apdmrl.messor.common.api;

import java.net.URI;

import jakarta.persistence.OptimisticLockException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * Converts application and framework exceptions into stable RFC 9457 Problem
 * Details responses. Internal exception messages, SQL, constraint names and
 * stack traces are never exposed.
 */
@RestControllerAdvice
public class ApiExceptionHandler {

	private static final String CODE_VALIDATION_FAILED = "VALIDATION_FAILED";
	private static final String CODE_VERSION_CONFLICT = "VERSION_CONFLICT";
	private static final String CODE_PROJECT_KEY_ALREADY_EXISTS = "PROJECT_KEY_ALREADY_EXISTS";
	private static final String CODE_METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED";
	private static final String CODE_CONFLICT = "CONFLICT";

	@ExceptionHandler(ApiProblemException.class)
	public ResponseEntity<ProblemDetail> handleApiProblem(ApiProblemException ex,
			HttpServletRequest request) {
		ProblemDetail problem = ex.getProblem();
		problem.setInstance(URI.create(request.getRequestURI()));
		return problemResponse(problem);
	}

	@ExceptionHandler(MethodArgumentNotValidException.class)
	public ResponseEntity<ProblemDetail> handleMethodArgumentNotValid(
			MethodArgumentNotValidException ex, HttpServletRequest request) {
		return validationFailed(request);
	}

	@ExceptionHandler(HandlerMethodValidationException.class)
	public ResponseEntity<ProblemDetail> handleHandlerMethodValidation(
			HandlerMethodValidationException ex, HttpServletRequest request) {
		return validationFailed(request);
	}

	@ExceptionHandler(ConstraintViolationException.class)
	public ResponseEntity<ProblemDetail> handleConstraintViolation(
			ConstraintViolationException ex, HttpServletRequest request) {
		return validationFailed(request);
	}

	@ExceptionHandler(ObjectOptimisticLockingFailureException.class)
	public ResponseEntity<ProblemDetail> handleOptimisticLocking(
			ObjectOptimisticLockingFailureException ex, HttpServletRequest request) {
		return problemResponse(problem(HttpStatus.CONFLICT, CODE_VERSION_CONFLICT,
				"Kayıt başka bir işlem tarafından güncellendi.", request));
	}

	/**
	 * A flush-time or commit-time optimistic collision may surface as the raw
	 * Jakarta Persistence {@link OptimisticLockException} (e.g. when the versioned
	 * UPDATE affects zero rows) rather than Spring's
	 * {@link ObjectOptimisticLockingFailureException} wrapper. Both families must
	 * map to the exact safe {@code 409 VERSION_CONFLICT} contract. Only the
	 * optimistic-lock exception is translated here; unrelated persistence or data
	 * access failures are never converted to {@code VERSION_CONFLICT}.
	 */
	@ExceptionHandler(OptimisticLockException.class)
	public ResponseEntity<ProblemDetail> handleJpaOptimisticLocking(
			OptimisticLockException ex, HttpServletRequest request) {
		return problemResponse(problem(HttpStatus.CONFLICT, CODE_VERSION_CONFLICT,
				"Kayıt başka bir işlem tarafından güncellendi.", request));
	}

	@ExceptionHandler(DataIntegrityViolationException.class)
	public ResponseEntity<ProblemDetail> handleDataIntegrityViolation(
			DataIntegrityViolationException ex, HttpServletRequest request) {
		// The project key unique constraint is detected and translated to
		// PROJECT_KEY_ALREADY_EXISTS inside ProjectService.create. Any other
		// integrity violation (e.g. a future membership constraint) fails
		// closed to a generic conflict rather than guessing a domain reason.
		return problemResponse(problem(HttpStatus.CONFLICT, CODE_CONFLICT,
				"Kaynak durumu istekle çakışıyor.", request));
	}

	@ExceptionHandler(HttpMessageNotReadableException.class)
	public ResponseEntity<ProblemDetail> handleHttpMessageNotReadable(
			HttpMessageNotReadableException ex, HttpServletRequest request) {
		return validationFailed(request);
	}

	@ExceptionHandler(MethodArgumentTypeMismatchException.class)
	public ResponseEntity<ProblemDetail> handleMethodArgumentTypeMismatch(
			MethodArgumentTypeMismatchException ex, HttpServletRequest request) {
		return validationFailed(request);
	}

	@ExceptionHandler(HttpRequestMethodNotSupportedException.class)
	public ResponseEntity<ProblemDetail> handleHttpRequestMethodNotSupported(
			HttpRequestMethodNotSupportedException ex, HttpServletRequest request) {
		return problemResponse(problem(HttpStatus.METHOD_NOT_ALLOWED, CODE_METHOD_NOT_ALLOWED,
				"Bu HTTP metodu desteklenmiyor.", request));
	}

	@ExceptionHandler(NoResourceFoundException.class)
	public ResponseEntity<ProblemDetail> handleNoResource(NoResourceFoundException ex,
			HttpServletRequest request) {
		return problemResponse(problem(HttpStatus.NOT_FOUND, "NOT_FOUND",
				"Kaynak bulunamadı.", request));
	}

	private ResponseEntity<ProblemDetail> validationFailed(HttpServletRequest request) {
		return problemResponse(problem(HttpStatus.BAD_REQUEST, CODE_VALIDATION_FAILED,
				"İstek doğrulama kurallarını karşılamıyor.", request));
	}

	private ProblemDetail problem(HttpStatus status, String code, String detail,
			HttpServletRequest request) {
		ProblemDetail problem = ProblemDetail.forStatus(status);
		problem.setType(URI.create("about:blank"));
		problem.setTitle(status.getReasonPhrase());
		problem.setDetail(detail);
		problem.setInstance(URI.create(request.getRequestURI()));
		problem.setProperty("code", code);
		return problem;
	}

	private ResponseEntity<ProblemDetail> problemResponse(ProblemDetail problem) {
		return ResponseEntity.status(problem.getStatus())
				.cacheControl(CacheControl.noStore())
				.contentType(org.springframework.http.MediaType.APPLICATION_PROBLEM_JSON)
				.body(problem);
	}

}
