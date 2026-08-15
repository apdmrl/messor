package io.github.apdmrl.messor.identity;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Seeds the two demo accounts when the {@code demo} profile is active.
 *
 * <p>The initializer is idempotent: it only creates accounts that do not
 * already exist, keyed by normalized email. Existing accounts are left
 * untouched, so their UUIDs, hashes and version counters are preserved across
 * restarts.</p>
 */
@Component
@Profile("demo")
public class DemoAccountInitializer implements ApplicationRunner {

	private static final Logger log = LoggerFactory.getLogger(DemoAccountInitializer.class);

	private final UserAccountRepository repository;
	private final PasswordEncoder passwordEncoder;
	private final String demoPassword;

	public DemoAccountInitializer(UserAccountRepository repository,
			PasswordEncoder passwordEncoder,
			@Value("${messor.demo.password}") String demoPassword) {
		this.repository = repository;
		this.passwordEncoder = passwordEncoder;
		this.demoPassword = demoPassword;
	}

	@Override
	@Transactional
	public void run(ApplicationArguments args) {
		seed("admin@demo.messor.app", "Messor", "Admin", UserRole.ORG_ADMIN);
		seed("member@demo.messor.app", "Messor", "Member", UserRole.USER);
	}

	private void seed(String email, String firstName, String lastName, UserRole role) {
		if (repository.findByNormalizedEmail(email).isPresent()) {
			log.info("Demo account already exists, skipping: {}", email);
			return;
		}

		String hash = passwordEncoder.encode(demoPassword);
		UserAccount account = UserAccount.create(email, hash, firstName, lastName, role);
		repository.save(account);
		log.info("Created demo account {} with role {} and an Argon2id password hash", email, role);
	}

}
