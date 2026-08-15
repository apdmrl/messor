package io.github.apdmrl.messor.identity;

import java.io.Serial;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.springframework.security.core.CredentialsContainer;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

/**
 * Immutable, serializable authentication principal for a Messor user.
 *
 * <p>This class copies only the safe identity and profile fields from
 * {@link UserAccount}. It intentionally does not retain a reference to the JPA
 * entity, and it clears the temporary password hash when
 * {@link #eraseCredentials()} is invoked.</p>
 */
public final class MessorUserPrincipal implements UserDetails, CredentialsContainer {

	@Serial
	private static final long serialVersionUID = 1L;

	private final UUID id;
	private final String email;
	private final String firstName;
	private final String lastName;
	private final UserRole role;
	private final boolean enabled;
	private final List<GrantedAuthority> authorities;

	private String passwordHash;

	private MessorUserPrincipal(UUID id, String email, String firstName, String lastName,
			UserRole role, boolean enabled, String passwordHash) {
		this.id = id;
		this.email = email;
		this.firstName = firstName;
		this.lastName = lastName;
		this.role = role;
		this.enabled = enabled;
		this.authorities = List.of(new SimpleGrantedAuthority("ROLE_" + role.name()));
		this.passwordHash = passwordHash;
	}

	public static MessorUserPrincipal from(UserAccount account) {
		return new MessorUserPrincipal(
				account.getId(),
				account.getEmail(),
				account.getFirstName(),
				account.getLastName(),
				account.getRole(),
				account.isActive(),
				account.getPasswordHash());
	}

	public UUID getId() {
		return id;
	}

	public String getEmail() {
		return email;
	}

	public String getFirstName() {
		return firstName;
	}

	public String getLastName() {
		return lastName;
	}

	public UserRole getRole() {
		return role;
	}

	@Override
	public Collection<? extends GrantedAuthority> getAuthorities() {
		return authorities;
	}

	@Override
	public String getPassword() {
		return passwordHash;
	}

	@Override
	public String getUsername() {
		return email;
	}

	@Override
	public boolean isAccountNonExpired() {
		return true;
	}

	@Override
	public boolean isAccountNonLocked() {
		return true;
	}

	@Override
	public boolean isCredentialsNonExpired() {
		return true;
	}

	@Override
	public boolean isEnabled() {
		return enabled;
	}

	@Override
	public void eraseCredentials() {
		this.passwordHash = null;
	}

	@Override
	public String toString() {
		return "MessorUserPrincipal[id=" + id + ", email=" + email
				+ ", firstName=" + firstName + ", lastName=" + lastName
				+ ", role=" + role + ", enabled=" + enabled + "]";
	}

}
