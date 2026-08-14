package io.github.apdmrl.messor.auth;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.security.web.csrf.XorCsrfTokenRequestAttributeHandler;

@Configuration(proxyBeanMethods = false)
public class SecurityConfiguration {

	@Bean
	HttpSessionCsrfTokenRepository csrfTokenRepository() {
		HttpSessionCsrfTokenRepository repository = new HttpSessionCsrfTokenRepository();
		repository.setHeaderName("X-CSRF-TOKEN");
		repository.setParameterName("_csrf");
		return repository;
	}

	@Bean
	XorCsrfTokenRequestAttributeHandler csrfTokenRequestHandler() {
		return new XorCsrfTokenRequestAttributeHandler();
	}

	@Bean
	SecurityFilterChain securityFilterChain(
			HttpSecurity http,
			HttpSessionCsrfTokenRepository csrfTokenRepository,
			XorCsrfTokenRequestAttributeHandler csrfTokenRequestHandler,
			ApiAuthenticationEntryPoint authenticationEntryPoint,
			ApiAccessDeniedHandler accessDeniedHandler,
			JsonAuthenticationSuccessHandler successHandler,
			ProblemAuthenticationFailureHandler failureHandler) throws Exception {

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

		http.authorizeHttpRequests(authorize -> authorize
				.requestMatchers("/api/auth/csrf", "/actuator/health", "/actuator/health/**").permitAll()
				.requestMatchers(HttpMethod.POST, "/api/auth/login").permitAll()
				.anyRequest().authenticated());

		return http.build();
	}

}
