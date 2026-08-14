package io.github.apdmrl.messor.identity;

import java.util.UUID;

import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityManagerFactory;
import jakarta.persistence.OptimisticLockException;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import io.github.apdmrl.messor.support.PostgresIntegrationTestSupport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class UserAccountRepositoryIT extends PostgresIntegrationTestSupport {

	@Autowired
	private UserAccountRepository repository;

	@Autowired
	private EntityManagerFactory entityManagerFactory;

	@Test
	void createsUserAccountThroughFactory() {
		UserAccount account = UserAccount.create(
				"Member@Demo.Messor.App",
				"fake-password-hash",
				"Ada",
				"Lovelace",
				UserRole.ORG_ADMIN);

		assertThat(account.getId()).isNotNull();
		assertThat(account.getEmail()).isEqualTo("member@demo.messor.app");
		assertThat(account.getPasswordHash()).isEqualTo("fake-password-hash");
		assertThat(account.getFirstName()).isEqualTo("Ada");
		assertThat(account.getLastName()).isEqualTo("Lovelace");
		assertThat(account.getRole()).isEqualTo(UserRole.ORG_ADMIN);
		assertThat(account.getStatus()).isEqualTo(UserStatus.ACTIVE);
	}

	@Test
	void normalizesMixedCaseEmailBeforePersisting() {
		UserAccount account = UserAccount.create(
				" Mixed.Case@Demo.Messor.App ",
				"fake-password-hash",
				"Ada",
				"Lovelace",
				UserRole.USER);

		UserAccount saved = repository.saveAndFlush(account);

		assertThat(saved.getEmail()).isEqualTo("mixed.case@demo.messor.app");
	}

	@Test
	void findsUserByRawOrMixedCaseEmail() {
		repository.saveAndFlush(UserAccount.create(
				"Lookup@Demo.Messor.App",
				"fake-password-hash",
				"Ada",
				"Lovelace",
				UserRole.USER));

		assertThat(repository.findByNormalizedEmail(" LOOKUP@demo.MESSOR.app "))
				.isPresent()
				.get()
				.extracting(UserAccount::getEmail)
				.isEqualTo("lookup@demo.messor.app");
	}

	@Test
	void returnsSavedBasicFields() {
		UserAccount saved = repository.saveAndFlush(UserAccount.create(
				"basic@demo.messor.app",
				"fake-password-hash",
				"Grace",
				"Hopper",
				UserRole.USER));

		UserAccount loaded = repository.findByNormalizedEmail("basic@demo.messor.app").orElseThrow();

		assertThat(loaded.getId()).isEqualTo(saved.getId());
		assertThat(loaded.getPasswordHash()).isEqualTo("fake-password-hash");
		assertThat(loaded.getFirstName()).isEqualTo("Grace");
		assertThat(loaded.getLastName()).isEqualTo("Hopper");
		assertThat(loaded.getRole()).isEqualTo(UserRole.USER);
		assertThat(loaded.getStatus()).isEqualTo(UserStatus.ACTIVE);
	}

	@Test
	void newUserIsActiveByDefault() {
		UserAccount account = UserAccount.create(
				"active@demo.messor.app",
				"fake-password-hash",
				"Ada",
				"Lovelace",
				UserRole.USER);

		assertThat(account.isActive()).isTrue();
		assertThat(account.getStatus()).isEqualTo(UserStatus.ACTIVE);
	}

	@Test
	void disablingUserMarksItDisabled() {
		UserAccount account = UserAccount.create(
				"disabled@demo.messor.app",
				"fake-password-hash",
				"Ada",
				"Lovelace",
				UserRole.USER);

		account.disable();

		assertThat(account.isActive()).isFalse();
		assertThat(account.getStatus()).isEqualTo(UserStatus.DISABLED);
	}

	@Test
	void saveAndFlushPopulatesTimestamps() {
		UserAccount saved = repository.saveAndFlush(UserAccount.create(
				"timestamps@demo.messor.app",
				"fake-password-hash",
				"Ada",
				"Lovelace",
				UserRole.USER));

		assertThat(saved.getCreatedAt()).isNotNull();
		assertThat(saved.getUpdatedAt()).isNotNull();
	}

	@Test
	void versionStartsAtZeroAfterFirstSave() {
		UserAccount saved = repository.saveAndFlush(UserAccount.create(
				"version@demo.messor.app",
				"fake-password-hash",
				"Ada",
				"Lovelace",
				UserRole.USER));

		assertThat(saved.getVersion()).isZero();
	}

	@Test
	void staleUpdateRaisesOptimisticLockException() {
		UUID id = repository.saveAndFlush(UserAccount.create(
				"lock@demo.messor.app",
				"fake-password-hash",
				"Ada",
				"Lovelace",
				UserRole.USER)).getId();

		EntityManager first = entityManagerFactory.createEntityManager();
		EntityManager second = entityManagerFactory.createEntityManager();

		try {
			first.getTransaction().begin();
			UserAccount firstCopy = first.find(UserAccount.class, id);
			second.getTransaction().begin();
			UserAccount secondCopy = second.find(UserAccount.class, id);

			firstCopy.disable();
			first.flush();
			first.getTransaction().commit();

			secondCopy.disable();
			assertThatThrownBy(second::flush)
					.isInstanceOf(OptimisticLockException.class);
			second.getTransaction().rollback();
		}
		finally {
			if (first.getTransaction().isActive()) {
				first.getTransaction().rollback();
			}
			if (second.getTransaction().isActive()) {
				second.getTransaction().rollback();
			}
			first.close();
			second.close();
		}
	}

}
