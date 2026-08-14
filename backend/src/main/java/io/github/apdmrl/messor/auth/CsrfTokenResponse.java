package io.github.apdmrl.messor.auth;

public record CsrfTokenResponse(String headerName, String parameterName, String token) {
}
