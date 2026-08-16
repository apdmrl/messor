package io.github.apdmrl.messor.project;

import java.sql.SQLException;
import java.util.Optional;

import io.github.apdmrl.messor.common.api.ApiProblemException;
import io.github.apdmrl.messor.identity.MessorUserPrincipal;
import io.github.apdmrl.messor.identity.UserAccount;
import io.github.apdmrl.messor.identity.UserAccountRepository;
import io.github.apdmrl.messor.identity.UserRole;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceException;

import org.hibernate.exception.ConstraintViolationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for the {@link ProjectService#create} constraint classification.
 *
 * <p>The {@code ProjectApiIT} duplicate-key scenario stops at the
 * {@code existsByKey} pre-check, so it never exercises the
 * {@code DataIntegrityViolationException} cause-chain classification that runs
 * after {@code entityManager.flush()}. These tests drive the public
 * {@code create} method all the way to the flush and assert how the cause chain
 * is classified, without reflection into private helpers.</p>
 */
@ExtendWith(MockitoExtension.class)
class ProjectServiceTest {

	private static final String PROJECT_KEY = "TEST";

	@Mock
	private ProjectRepository projectRepository;
	@Mock
	private ProjectMemberRepository memberRepository;
	@Mock
	private WorkflowStatusRepository statusRepository;
	@Mock
	private UserAccountRepository userAccountRepository;
	@Mock
	private ProjectAuthorizationService authorizationService;
	@Mock
	private EntityManager entityManager;

	private ProjectService service;

	private UserAccount creator;
	private MessorUserPrincipal principal;

	@BeforeEach
	void setUp() {
		service = new ProjectService(projectRepository, memberRepository, statusRepository,
				userAccountRepository, authorizationService, entityManager);
		creator = UserAccount.create("creator@demo.messor.app", "stored-hash",
				"Creator", "User", UserRole.USER);
		principal = MessorUserPrincipal.from(creator);
	}

	@Test
	void projectKeyConstraintViolationMapsToProjectKeyAlreadyExists() {
		when(projectRepository.existsByKey(PROJECT_KEY)).thenReturn(false);
		when(userAccountRepository.findById(principal.getId())).thenReturn(Optional.of(creator));
		doThrow(projectKeyViolation()).when(entityManager).flush();

		assertThatThrownBy(() -> service.create(request(), principal))
				.isInstanceOf(ApiProblemException.class)
				.satisfies(ex -> {
					ApiProblemException problem = (ApiProblemException) ex;
					assertThat(problem.getProblem().getStatus())
							.isEqualTo(HttpStatus.CONFLICT.value());
					assertThat(problem.getProblem().getProperties())
							.containsEntry("code", "PROJECT_KEY_ALREADY_EXISTS");
					// The SQL message and constraint name must not leak to the client.
					assertThat(problem.getProblem().getDetail())
							.doesNotContain("uq_project_key")
							.doesNotContain("duplicate key");
				});

		// The pre-check was passed and the flush was actually reached.
		verify(projectRepository).existsByKey(PROJECT_KEY);
		verify(entityManager).flush();
	}

	@Test
	void unrelatedConstraintViolationIsRethrown() {
		when(projectRepository.existsByKey(PROJECT_KEY)).thenReturn(false);
		when(userAccountRepository.findById(principal.getId())).thenReturn(Optional.of(creator));
		DataIntegrityViolationException violation = unrelatedViolation();
		doThrow(violation).when(entityManager).flush();

		assertThatThrownBy(() -> service.create(request(), principal))
				.isSameAs(violation);

		// The pre-check was passed and the flush was actually reached.
		verify(projectRepository).existsByKey(PROJECT_KEY);
		verify(entityManager).flush();
	}

	private CreateProjectRequest request() {
		return new CreateProjectRequest(PROJECT_KEY, "Test Project", "A test project.");
	}

	/**
	 * Builds a {@link DataIntegrityViolationException} whose cause chain contains
	 * a Hibernate {@link ConstraintViolationException} for {@code uq_project_key}
	 * wrapped behind an intermediate {@link PersistenceException}.
	 */
	private DataIntegrityViolationException projectKeyViolation() {
		SQLException sql = new SQLException(
				"ERROR: duplicate key value violates unique constraint \"uq_project_key\"");
		ConstraintViolationException cve =
				new ConstraintViolationException("could not execute statement", sql, "uq_project_key");
		PersistenceException intermediate = new PersistenceException("JDBC execution failed", cve);
		return new DataIntegrityViolationException(
				"could not execute statement; SQL [n/a]; constraint [uq_project_key]", intermediate);
	}

	/**
	 * Builds a {@link DataIntegrityViolationException} whose cause chain contains
	 * a Hibernate {@link ConstraintViolationException} for an unrelated
	 * constraint ({@code uq_project_member_project_user}).
	 */
	private DataIntegrityViolationException unrelatedViolation() {
		SQLException sql = new SQLException(
				"ERROR: duplicate key value violates unique constraint \"uq_project_member_project_user\"");
		ConstraintViolationException cve = new ConstraintViolationException(
				"could not execute statement", sql, "uq_project_member_project_user");
		PersistenceException intermediate = new PersistenceException("JDBC execution failed", cve);
		return new DataIntegrityViolationException(
				"could not execute statement; SQL [n/a]; constraint [uq_project_member_project_user]",
				intermediate);
	}
}
