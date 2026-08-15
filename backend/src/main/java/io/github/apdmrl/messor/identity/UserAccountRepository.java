package io.github.apdmrl.messor.identity;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface UserAccountRepository extends JpaRepository<UserAccount, UUID> {

	Optional<UserAccount> findByEmail(String normalizedEmail);

	default Optional<UserAccount> findByNormalizedEmail(String rawEmail) {
		return findByEmail(EmailNormalizer.normalize(rawEmail));
	}

}
