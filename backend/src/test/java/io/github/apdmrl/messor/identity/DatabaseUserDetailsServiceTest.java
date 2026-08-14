package io.github.apdmrl.messor.identity;

import java.util.Optional;
import java.util.stream.Collectors;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UsernameNotFoundException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class DatabaseUserDetailsServiceTest {

	private static final String PASSWORD_HASH = "stored-argon2-hash";

	@Mock
	private UserAccountRepository repository;

	private DatabaseUserDetailsService service;

	private ListAppender<ILoggingEvent> logAppender;
	private Logger rootLogger;

	@BeforeEach
	void setUp() {
		service = new DatabaseUserDetailsService(repository);
		logAppender = new ListAppender<>();
		logAppender.start();
		rootLogger = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
		rootLogger.addAppender(logAppender);
	}

	@AfterEach
	void tearDown() {
		rootLogger.detachAppender(logAppender);
		logAppender.stop();
	}

	@Test
	void normalizesMixedCaseAndWhitespaceEmailBeforeRepositoryLookup() {
		UserAccount account = activeAccount("member@demo.messor.app", UserRole.USER);
		when(repository.findByEmail(any())).thenReturn(Optional.of(account));

		service.loadUserByUsername(" Member@Demo.Messor.App ");

		ArgumentCaptor<String> emailCaptor = ArgumentCaptor.forClass(String.class);
		verify(repository).findByEmail(emailCaptor.capture());
		assertThat(emailCaptor.getValue()).isEqualTo("member@demo.messor.app");
	}

	@Test
	void doesNotSendRawMixedCaseEmailToRepository() {
		when(repository.findByEmail(any())).thenReturn(Optional.empty());

		assertThatThrownBy(() -> service.loadUserByUsername(" Member@Demo.Messor.App "))
				.isInstanceOf(UsernameNotFoundException.class);

		verify(repository).findByEmail("member@demo.messor.app");
		verify(repository, never()).findByEmail(" Member@Demo.Messor.App ");
	}

	@Test
	void returnsPrincipalForActiveUser() {
		UserAccount account = activeAccount("member@demo.messor.app", UserRole.USER);
		when(repository.findByEmail("member@demo.messor.app")).thenReturn(Optional.of(account));

		UserDetails userDetails = service.loadUserByUsername("member@demo.messor.app");

		assertThat(userDetails).isInstanceOf(MessorUserPrincipal.class);
		assertThat(userDetails.getUsername()).isEqualTo("member@demo.messor.app");
		assertThat(userDetails.isEnabled()).isTrue();
	}

	@Test
	void returnsPrincipalWithDisabledFlagForDisabledUser() {
		UserAccount account = activeAccount("member@demo.messor.app", UserRole.USER);
		account.disable();
		when(repository.findByEmail("member@demo.messor.app")).thenReturn(Optional.of(account));

		UserDetails userDetails = service.loadUserByUsername("member@demo.messor.app");

		assertThat(userDetails).isInstanceOf(MessorUserPrincipal.class);
		assertThat(userDetails.isEnabled()).isFalse();
	}

	@Test
	void unknownEmailRaisesUsernameNotFoundException() {
		when(repository.findByEmail(any())).thenReturn(Optional.empty());

		assertThatThrownBy(() -> service.loadUserByUsername("unknown@demo.messor.app"))
				.isInstanceOf(UsernameNotFoundException.class)
				.hasMessage("User not found");
	}

	@Test
	void nullUsernameRaisesUsernameNotFoundException() {
		assertThatThrownBy(() -> service.loadUserByUsername(null))
				.isInstanceOf(UsernameNotFoundException.class)
				.hasMessage("User not found");
	}

	@Test
	void blankUsernameRaisesUsernameNotFoundException() {
		assertThatThrownBy(() -> service.loadUserByUsername("   "))
				.isInstanceOf(UsernameNotFoundException.class)
				.hasMessage("User not found");
	}

	@Test
	void unknownNullAndBlankUseTheSameGenericMessage() {
		when(repository.findByEmail(any())).thenReturn(Optional.empty());

		assertThatThrownBy(() -> service.loadUserByUsername("unknown@demo.messor.app"))
				.hasMessage("User not found");
		assertThatThrownBy(() -> service.loadUserByUsername(null))
				.hasMessage("User not found");
		assertThatThrownBy(() -> service.loadUserByUsername("   "))
				.hasMessage("User not found");
	}

	@Test
	void exceptionMessageDoesNotContainTheRawSubmittedEmail() {
		when(repository.findByEmail(any())).thenReturn(Optional.empty());

		assertThatThrownBy(() -> service.loadUserByUsername(" Raw.User@Demo.Messor.App "))
				.isInstanceOf(UsernameNotFoundException.class)
				.satisfies(exception -> assertThat(exception.getMessage())
						.doesNotContain("Raw.User@Demo.Messor.App")
						.doesNotContain("Raw.User")
						.doesNotContain("raw.user"));
	}

	@Test
	void doesNotLogPasswordHashOrUsername() {
		when(repository.findByEmail(any())).thenReturn(Optional.empty());

		assertThatThrownBy(() -> service.loadUserByUsername("Secret.User@Demo.Messor.App"))
				.isInstanceOf(UsernameNotFoundException.class);

		String logOutput = logAppender.list.stream()
				.map(ILoggingEvent::getFormattedMessage)
				.collect(Collectors.joining("\n"));

		assertThat(logOutput).doesNotContain(PASSWORD_HASH);
		assertThat(logOutput).doesNotContain("Secret.User@Demo.Messor.App");
		assertThat(logOutput).doesNotContain("secret.user@demo.messor.app");
	}

	private static UserAccount activeAccount(String email, UserRole role) {
		return UserAccount.create(email, PASSWORD_HASH, "Ada", "Lovelace", role);
	}

}
