package io.github.apdmrl.messor.auth;

import java.util.function.Supplier;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.csrf.CsrfTokenRequestHandler;
import org.springframework.security.web.csrf.XorCsrfTokenRequestAttributeHandler;
import org.springframework.util.StringUtils;

/**
 * SPA-friendly CSRF request handler.
 *
 * <p>The frontend reads the CSRF token from the non-HttpOnly {@code XSRF-TOKEN}
 * cookie (set by {@code CookieCsrfTokenRepository}) and echoes it back in the
 * {@code X-XSRF-TOKEN} header. Header values are the raw token, so they are
 * resolved with the plain handler; the masked XOR handler is kept for the
 * {@code _csrf} body/parameter path. Calling {@code csrfToken.get()} in
 * {@link #handle} forces the deferred token to be loaded so the cookie is
 * written on every response, guaranteeing the token is available before the
 * first state-changing request.
 */
public final class SpaCsrfTokenRequestHandler implements CsrfTokenRequestHandler {

	private final CsrfTokenRequestHandler plain = new CsrfTokenRequestAttributeHandler();
	private final CsrfTokenRequestHandler xor = new XorCsrfTokenRequestAttributeHandler();

	@Override
	public void handle(HttpServletRequest request, HttpServletResponse response,
			Supplier<CsrfToken> csrfToken) {
		this.xor.handle(request, response, csrfToken);
		csrfToken.get();
	}

	@Override
	public String resolveCsrfTokenValue(HttpServletRequest request, CsrfToken csrfToken) {
		String headerValue = request.getHeader(csrfToken.getHeaderName());
		return (StringUtils.hasText(headerValue) ? this.plain : this.xor)
				.resolveCsrfTokenValue(request, csrfToken);
	}

}
