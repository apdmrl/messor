package io.github.apdmrl.messor.identity;

import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DatabaseUserDetailsService implements UserDetailsService {

	private final UserAccountRepository repository;

	public DatabaseUserDetailsService(UserAccountRepository repository) {
		this.repository = repository;
	}

	@Override
	@Transactional(readOnly = true)
	public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
		String normalizedEmail = normalize(username);
		return repository.findByEmail(normalizedEmail)
				.map(MessorUserPrincipal::from)
				.orElseThrow(() -> new UsernameNotFoundException("User not found"));
	}

	private String normalize(String username) {
		if (username == null || username.isBlank()) {
			throw new UsernameNotFoundException("User not found");
		}
		return EmailNormalizer.normalize(username);
	}

}
