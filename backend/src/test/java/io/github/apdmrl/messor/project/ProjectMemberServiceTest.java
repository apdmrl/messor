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
 * Unit tests for the {@link ProjectMemberService#add} constraint
 * classification.
 *
 * <p>The {@code ProjectMembershipApiIT} duplicate-key scenario stops at the
 * {@code findByProjectIdAndUserId} pre-check, so it never exercises the
 * {@code DataIntegrityViolationException} cause-chain classification that runs
 * after {@code memberRepository.saveAndFlush()}. These tests drive the public
 * {@code add} method all the way to the flush and assert how the cause chain is
 * classified, without reflection into private helpers.</p>
 */
@ExtendWith(MockitoExtension.class)
class ProjectMemberServiceTest {

	private static final String PROJECT_KEY = "TEST";

	@Mock
	private ProjectAuthorizationService authorizationService;
	@Mock
	private ProjectMemberRepository memberRepository;
	@Mock
	private UserAccountRepository userAccountRepository;
	@Mock
	private EntityManager entityManager;

	private ProjectMemberService service;

	private Project project;
	private UserAccount actor;
	private UserAccount target;
	private MessorUserPrincipal principal;

	@BeforeEach
	void setUp() {
		service = new ProjectMemberService(authorizationService, memberRepository,
				userAccountRepository, entityManager);
		actor = UserAccount.create("actor@demo.messor.app", "stored-hash",
				"Actor", "User", UserRole.USER);
		principal = MessorUserPrincipal.from(actor);
		target = UserAccount.create("target@demo.messor.app", "stored-hash",
				"Target", "User", UserRole.USER);
		project = Project.create(PROJECT_KEY, "Test Project", "A test project.", actor);
	}

	@Test
	void memberUniqueViolationMapsToMemberAlreadyExists() {
		when(authorizationService.requireProject(PROJECT_KEY, principal, ProjectPermission.MANAGE_MEMBERS))
				.thenReturn(new ProjectAccess(project, ProjectRole.PROJECT_LEAD));
		when(userAccountRepository.findByNormalizedEmail(target.getEmail()))
				.thenReturn(Optional.of(target));
		when(memberRepository.findByProjectIdAndUserId(project.getId(), target.getId()))
				.thenReturn(Optional.empty());
		doThrow(memberUniqueViolation()).when(memberRepository).saveAndFlush(any(ProjectMember.class));

		assertThatThrownBy(() -> service.add(PROJECT_KEY, request(), principal))
				.isInstanceOf(ApiProblemException.class)
				.satisfies(ex -> {
					ApiProblemException problem = (ApiProblemException) ex;
					assertThat(problem.getProblem().getStatus())
							.isEqualTo(HttpStatus.CONFLICT.value());
					assertThat(problem.getProblem().getProperties())
							.containsEntry("code", "MEMBER_ALREADY_EXISTS");
					// The SQL message and constraint name must not leak to the client.
					assertThat(problem.getProblem().getDetail())
							.doesNotContain("uq_project_member_project_user")
							.doesNotContain("duplicate key");
				});

		// The pre-check was passed and the flush was actually reached.
		verify(memberRepository).findByProjectIdAndUserId(project.getId(), target.getId());
		verify(memberRepository).saveAndFlush(any(ProjectMember.class));
	}

	@Test
	void unrelatedConstraintViolationIsRethrown() {
		when(authorizationService.requireProject(PROJECT_KEY, principal, ProjectPermission.MANAGE_MEMBERS))
				.thenReturn(new ProjectAccess(project, ProjectRole.PROJECT_LEAD));
		when(userAccountRepository.findByNormalizedEmail(target.getEmail()))
				.thenReturn(Optional.of(target));
		when(memberRepository.findByProjectIdAndUserId(project.getId(), target.getId()))
				.thenReturn(Optional.empty());
		DataIntegrityViolationException violation = unrelatedViolation();
		doThrow(violation).when(memberRepository).saveAndFlush(any(ProjectMember.class));

		assertThatThrownBy(() -> service.add(PROJECT_KEY, request(), principal))
				.isSameAs(violation);

		// The pre-check was passed and the flush was actually reached.
		verify(memberRepository).findByProjectIdAndUserId(project.getId(), target.getId());
		verify(memberRepository).saveAndFlush(any(ProjectMember.class));
	}

	private AddProjectMemberRequest request() {
		return new AddProjectMemberRequest(target.getEmail(), ProjectRole.MEMBER);
	}

	/**
	 * Builds a {@link DataIntegrityViolationException} whose cause chain contains
	 * a Hibernate {@link ConstraintViolationException} for
	 * {@code uq_project_member_project_user} wrapped behind an intermediate
	 * {@link PersistenceException}.
	 */
	private DataIntegrityViolationException memberUniqueViolation() {
		SQLException sql = new SQLException(
				"ERROR: duplicate key value violates unique constraint \"uq_project_member_project_user\"");
		ConstraintViolationException cve = new ConstraintViolationException(
				"could not execute statement", sql, "uq_project_member_project_user");
		PersistenceException intermediate = new PersistenceException("JDBC execution failed", cve);
		return new DataIntegrityViolationException(
				"could not execute statement; SQL [n/a]; constraint [uq_project_member_project_user]",
				intermediate);
	}

	/**
	 * Builds a {@link DataIntegrityViolationException} whose cause chain contains
	 * a Hibernate {@link ConstraintViolationException} for an unrelated
	 * constraint ({@code uq_project_key}).
	 */
	private DataIntegrityViolationException unrelatedViolation() {
		SQLException sql = new SQLException(
				"ERROR: duplicate key value violates unique constraint \"uq_project_key\"");
		ConstraintViolationException cve = new ConstraintViolationException(
				"could not execute statement", sql, "uq_project_key");
		PersistenceException intermediate = new PersistenceException("JDBC execution failed", cve);
		return new DataIntegrityViolationException(
				"could not execute statement; SQL [n/a]; constraint [uq_project_key]",
				intermediate);
	}
}
