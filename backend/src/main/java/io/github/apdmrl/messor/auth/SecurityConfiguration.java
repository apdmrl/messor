package io.github.apdmrl.messor.auth;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestHandler;

@Configuration(proxyBeanMethods = false)
public class SecurityConfiguration {

	@Bean
	CookieCsrfTokenRepository csrfTokenRepository() {
		CookieCsrfTokenRepository repository = CookieCsrfTokenRepository.withHttpOnlyFalse();
		repository.setCookiePath("/");
		return repository;
	}

	@Bean
	CsrfTokenRequestHandler csrfTokenRequestHandler() {
		return new SpaCsrfTokenRequestHandler();
	}

	@Bean
	SecurityFilterChain securityFilterChain(
			HttpSecurity http,
			CookieCsrfTokenRepository csrfTokenRepository,
			CsrfTokenRequestHandler csrfTokenRequestHandler,
			ApiAuthenticationEntryPoint authenticationEntryPoint,
			ApiAccessDeniedHandler accessDeniedHandler,
			JsonAuthenticationSuccessHandler successHandler,
			ProblemAuthenticationFailureHandler failureHandler,
			NoContentLogoutSuccessHandler logoutSuccessHandler) throws Exception {

		http.csrf(csrf -> csrf
				.csrfTokenRepository(csrfTokenRepository)
				.csrfTokenRequestHandler(csrfTokenRequestHandler));

		http.exceptionHandling(exceptionHandling -> exceptionHandling
				.authenticationEntryPoint(authenticationEntryPoint)
				.accessDeniedHandler(accessDeniedHandler));

		http.formLogin(formLogin -> formLogin
				.loginProcessingUrl("/api/auth/login")
				.usernameParameter("email")
				.passwordParameter("password")
				.successHandler(successHandler)
				.failureHandler(failureHandler));

		http.logout(logout -> logout
				.logoutUrl("/api/auth/logout")
				.invalidateHttpSession(true)
				.clearAuthentication(true)
				.logoutSuccessHandler(logoutSuccessHandler));

		http.authorizeHttpRequests(authorize -> authorize
				.requestMatchers("/actuator/health", "/actuator/health/**").permitAll()
				.requestMatchers(HttpMethod.POST, "/api/auth/login").permitAll()
				.anyRequest().authenticated());

		return http.build();
	}

}
