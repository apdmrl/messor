package io.github.apdmrl.messor.identity;

import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.security.core.GrantedAuthority;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MessorUserPrincipalTest {

	private static final String PASSWORD_HASH = "stored-argon2-hash";

	@Test
	void createsSafePrincipalFromUserAccount() {
		UserAccount account = activeAccount("Member@Demo.Messor.App", UserRole.USER);

		MessorUserPrincipal principal = MessorUserPrincipal.from(account);

		assertThat(principal.getId()).isEqualTo(account.getId());
		assertThat(principal.getEmail()).isEqualTo("member@demo.messor.app");
		assertThat(principal.getFirstName()).isEqualTo("Ada");
		assertThat(principal.getLastName()).isEqualTo("Lovelace");
	}

	@Test
	void usernameIsTheNormalizedEmail() {
		MessorUserPrincipal principal = MessorUserPrincipal.from(
				activeAccount(" Member@Demo.Messor.App ", UserRole.USER));

		assertThat(principal.getUsername()).isEqualTo("member@demo.messor.app");
	}

	@Test
	void passwordInitiallyHoldsTheStoredArgon2Hash() {
		MessorUserPrincipal principal = MessorUserPrincipal.from(
				activeAccount("member@demo.messor.app", UserRole.USER));

		assertThat(principal.getPassword()).isEqualTo(PASSWORD_HASH);
	}

	@Test
	void mapsOrgAdminRoleToRoleOrgAdminAuthority() {
		MessorUserPrincipal principal = MessorUserPrincipal.from(
				activeAccount("admin@demo.messor.app", UserRole.ORG_ADMIN));

		assertThat(authoritiesOf(principal)).containsExactly("ROLE_ORG_ADMIN");
	}

	@Test
	void mapsUserRoleToRoleUserAuthority() {
		MessorUserPrincipal principal = MessorUserPrincipal.from(
				activeAccount("member@demo.messor.app", UserRole.USER));

		assertThat(authoritiesOf(principal)).containsExactly("ROLE_USER");
	}

	@Test
	void authoritiesAreImmutable() {
		MessorUserPrincipal principal = MessorUserPrincipal.from(
				activeAccount("member@demo.messor.app", UserRole.USER));

		assertThatThrownBy(() -> principal.getAuthorities().clear())
				.isInstanceOf(UnsupportedOperationException.class);
	}

	@Test
	void activeUserIsEnabled() {
		MessorUserPrincipal principal = MessorUserPrincipal.from(
				activeAccount("member@demo.messor.app", UserRole.USER));

		assertThat(principal.isEnabled()).isTrue();
	}

	@Test
	void disabledUserIsNotEnabled() {
		UserAccount account = activeAccount("member@demo.messor.app", UserRole.USER);
		account.disable();

		MessorUserPrincipal principal = MessorUserPrincipal.from(account);

		assertThat(principal.isEnabled()).isFalse();
	}

	@Test
	void accountIsNeverExpiredLockedOrCredentialExpired() {
		MessorUserPrincipal principal = MessorUserPrincipal.from(
				activeAccount("member@demo.messor.app", UserRole.USER));

		assertThat(principal.isAccountNonExpired()).isTrue();
		assertThat(principal.isAccountNonLocked()).isTrue();
		assertThat(principal.isCredentialsNonExpired()).isTrue();
	}

	@Test
	void eraseCredentialsClearsPassword() {
		MessorUserPrincipal principal = MessorUserPrincipal.from(
				activeAccount("member@demo.messor.app", UserRole.USER));

		principal.eraseCredentials();

		assertThat(principal.getPassword()).isNull();
	}

	@Test
	void eraseCredentialsKeepsProfileFieldsIdAndAuthority() {
		UserAccount account = activeAccount("member@demo.messor.app", UserRole.USER);
		MessorUserPrincipal principal = MessorUserPrincipal.from(account);

		principal.eraseCredentials();

		assertThat(principal.getId()).isEqualTo(account.getId());
		assertThat(principal.getUsername()).isEqualTo("member@demo.messor.app");
		assertThat(principal.getFirstName()).isEqualTo("Ada");
		assertThat(principal.getLastName()).isEqualTo("Lovelace");
		assertThat(authoritiesOf(principal)).containsExactly("ROLE_USER");
	}

	@Test
	void doesNotHoldAReferenceToTheUserAccountEntity() {
		boolean holdsEntityReference = Arrays.stream(MessorUserPrincipal.class.getDeclaredFields())
				.anyMatch(field -> UserAccount.class.isAssignableFrom(field.getType()));

		assertThat(holdsEntityReference).isFalse();
	}

	@Test
	void toStringDoesNotExposePasswordOrHash() {
		MessorUserPrincipal principal = MessorUserPrincipal.from(
				activeAccount("member@demo.messor.app", UserRole.USER));

		assertThat(principal.toString()).doesNotContain(PASSWORD_HASH);
		assertThat(principal.toString()).doesNotContain("password");
	}

	private static List<String> authoritiesOf(MessorUserPrincipal principal) {
		return principal.getAuthorities().stream()
				.map(GrantedAuthority::getAuthority)
				.toList();
	}

	private static UserAccount activeAccount(String email, UserRole role) {
		return UserAccount.create(email, PASSWORD_HASH, "Ada", "Lovelace", role);
	}

}
