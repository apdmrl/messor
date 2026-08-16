package io.github.apdmrl.messor.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Optional;

import io.github.apdmrl.messor.common.api.ApiProblemException;
import io.github.apdmrl.messor.identity.MessorUserPrincipal;
import io.github.apdmrl.messor.identity.UserAccount;
import io.github.apdmrl.messor.identity.UserRole;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;

/**
 * Unit tests for the fail-closed {@link ProjectAuthorizationService}.
 *
 * <p>These tests assert the complete permission matrix across every project
 * role and every {@link ProjectPermission}, plus the 404/403 boundary behavior
 * and the guarantee that repository absence never falls through to
 * authorization.</p>
 */
@ExtendWith(MockitoExtension.class)
class ProjectAuthorizationServiceTest {

	private static final String PROJECT_KEY = "TEST";

	@Mock
	private ProjectRepository projectRepository;
	@Mock
	private ProjectMemberRepository memberRepository;

	private ProjectAuthorizationService service;

	private Project project;
	private UserAccount account;

	@BeforeEach
	void setUp() {
		service = new ProjectAuthorizationService(projectRepository, memberRepository);
		account = UserAccount.create("user@demo.messor.app", "stored-hash",
				"Ada", "Lovelace", UserRole.USER);
		project = Project.create(PROJECT_KEY, "Test Project", "A test project.", account);
	}

	// --- Permission matrix ---

	@ParameterizedTest
	@EnumSource(ProjectPermission.class)
	void orgAdminGrantsEveryPermission(ProjectPermission permission) {
		MessorUserPrincipal admin = principal(UserRole.ORG_ADMIN);
		when(projectRepository.findByKey(PROJECT_KEY)).thenReturn(Optional.of(project));

		ProjectAccess access = service.requireProject(PROJECT_KEY, admin, permission);

		assertThat(access.project()).isSameAs(project);
		assertThat(access.effectiveRole()).isEqualTo(ProjectRole.PROJECT_LEAD);
	}

	@ParameterizedTest
	@EnumSource(ProjectPermission.class)
	void projectLeadGrantsEveryPermissionOnTheirProject(ProjectPermission permission) {
		MessorUserPrincipal lead = principal(UserRole.USER);
		when(projectRepository.findByKey(PROJECT_KEY)).thenReturn(Optional.of(project));
		when(memberRepository.findByProjectIdAndUserId(project.getId(), lead.getId()))
				.thenReturn(Optional.of(member(lead, ProjectRole.PROJECT_LEAD)));

		ProjectAccess access = service.requireProject(PROJECT_KEY, lead, permission);

		assertThat(access.project()).isSameAs(project);
		assertThat(access.effectiveRole()).isEqualTo(ProjectRole.PROJECT_LEAD);
	}

	@ParameterizedTest
	@EnumSource(ProjectPermission.class)
	void memberGrantsReadMutateIssuesAndCommentButNotManage(ProjectPermission permission) {
		MessorUserPrincipal member = principal(UserRole.USER);
		when(projectRepository.findByKey(PROJECT_KEY)).thenReturn(Optional.of(project));
		when(memberRepository.findByProjectIdAndUserId(project.getId(), member.getId()))
				.thenReturn(Optional.of(member(member, ProjectRole.MEMBER)));

		if (permission == ProjectPermission.READ
				|| permission == ProjectPermission.MUTATE_ISSUES
				|| permission == ProjectPermission.COMMENT) {
			ProjectAccess access = service.requireProject(PROJECT_KEY, member, permission);
			assertThat(access.project()).isSameAs(project);
			assertThat(access.effectiveRole()).isEqualTo(ProjectRole.MEMBER);
		}
		else {
			assertForbidden(() -> service.requireProject(PROJECT_KEY, member, permission));
		}
	}

	@ParameterizedTest
	@EnumSource(ProjectPermission.class)
	void viewerGrantsReadOnly(ProjectPermission permission) {
		MessorUserPrincipal viewer = principal(UserRole.USER);
		when(projectRepository.findByKey(PROJECT_KEY)).thenReturn(Optional.of(project));
		when(memberRepository.findByProjectIdAndUserId(project.getId(), viewer.getId()))
				.thenReturn(Optional.of(member(viewer, ProjectRole.VIEWER)));

		if (permission == ProjectPermission.READ) {
			ProjectAccess access = service.requireProject(PROJECT_KEY, viewer, permission);
			assertThat(access.project()).isSameAs(project);
			assertThat(access.effectiveRole()).isEqualTo(ProjectRole.VIEWER);
		}
		else {
			assertForbidden(() -> service.requireProject(PROJECT_KEY, viewer, permission));
		}
	}

	@ParameterizedTest
	@EnumSource(ProjectPermission.class)
	void nonmemberGetsNoPermissionOnExistingProject(ProjectPermission permission) {
		MessorUserPrincipal outsider = principal(UserRole.USER);
		when(projectRepository.findByKey(PROJECT_KEY)).thenReturn(Optional.of(project));
		when(memberRepository.findByProjectIdAndUserId(project.getId(), outsider.getId()))
				.thenReturn(Optional.empty());

		assertNotFound(() -> service.requireProject(PROJECT_KEY, outsider, permission));
	}

	// --- Boundary behavior ---

	@Test
	void unknownProjectReturns404ForEveryPermission() {
		MessorUserPrincipal admin = principal(UserRole.ORG_ADMIN);
		when(projectRepository.findByKey(PROJECT_KEY)).thenReturn(Optional.empty());

		for (ProjectPermission permission : ProjectPermission.values()) {
			assertNotFound(() -> service.requireProject(PROJECT_KEY, admin, permission));
		}
	}

	@Test
	void nonmemberMutationAttemptReturns404Not403() {
		MessorUserPrincipal outsider = principal(UserRole.USER);
		when(projectRepository.findByKey(PROJECT_KEY)).thenReturn(Optional.of(project));
		when(memberRepository.findByProjectIdAndUserId(project.getId(), outsider.getId()))
				.thenReturn(Optional.empty());

		assertNotFound(() -> service.requireProject(PROJECT_KEY, outsider, ProjectPermission.MANAGE_MEMBERS));
	}

	@Test
	void knownMemberLackingPermissionReturns403() {
		MessorUserPrincipal member = principal(UserRole.USER);
		when(projectRepository.findByKey(PROJECT_KEY)).thenReturn(Optional.of(project));
		when(memberRepository.findByProjectIdAndUserId(project.getId(), member.getId()))
				.thenReturn(Optional.of(member(member, ProjectRole.MEMBER)));

		assertForbidden(() -> service.requireProject(PROJECT_KEY, member, ProjectPermission.MANAGE_PROJECT));
	}

	@Test
	void repositoryAbsenceNeverFallsThroughToAuthorization() {
		MessorUserPrincipal admin = principal(UserRole.ORG_ADMIN);
		when(projectRepository.findByKey(PROJECT_KEY)).thenReturn(Optional.empty());

		assertNotFound(() -> service.requireProject(PROJECT_KEY, admin, ProjectPermission.READ));

		// The membership repository must never be consulted when the project is absent.
		verify(memberRepository, never()).findByProjectIdAndUserId(any(), any());
	}

	@Test
	void orgAdminDoesNotRequireMembershipLookup() {
		MessorUserPrincipal admin = principal(UserRole.ORG_ADMIN);
		when(projectRepository.findByKey(PROJECT_KEY)).thenReturn(Optional.of(project));

		ProjectAccess access = service.requireProject(PROJECT_KEY, admin, ProjectPermission.MANAGE_MEMBERS);

		assertThat(access.project()).isSameAs(project);
		assertThat(access.effectiveRole()).isEqualTo(ProjectRole.PROJECT_LEAD);
		verify(memberRepository, never()).findByProjectIdAndUserId(any(), any());
	}

	// --- Helpers ---

	private MessorUserPrincipal principal(UserRole role) {
		UserAccount user = UserAccount.create("user-" + role + "@demo.messor.app", "stored-hash",
				"Ada", "Lovelace", role);
		return MessorUserPrincipal.from(user);
	}

	private ProjectMember member(MessorUserPrincipal principal, ProjectRole role) {
		UserAccount user = UserAccount.create(principal.getEmail(), "stored-hash",
				principal.getFirstName(), principal.getLastName(), principal.getRole());
		return ProjectMember.create(project, user, role);
	}

	private void assertForbidden(Runnable action) {
		assertThatThrownBy(action::run)
				.isInstanceOf(ApiProblemException.class)
				.satisfies(ex -> {
					ApiProblemException problem = (ApiProblemException) ex;
					assertThat(problem.getProblem().getStatus())
							.isEqualTo(HttpStatus.FORBIDDEN.value());
					assertThat(problem.getProblem().getProperties())
							.containsEntry("code", "FORBIDDEN");
				});
	}

	private void assertNotFound(Runnable action) {
		assertThatThrownBy(action::run)
				.isInstanceOf(ApiProblemException.class)
				.satisfies(ex -> {
					ApiProblemException problem = (ApiProblemException) ex;
					assertThat(problem.getProblem().getStatus())
							.isEqualTo(HttpStatus.NOT_FOUND.value());
					assertThat(problem.getProblem().getProperties())
							.containsEntry("code", "PROJECT_NOT_FOUND");
				});
	}
}
