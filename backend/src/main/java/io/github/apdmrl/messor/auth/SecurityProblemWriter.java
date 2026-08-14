package io.github.apdmrl.messor.auth;

import java.io.IOException;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.json.ProblemDetailJacksonMixin;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

@Component
public class SecurityProblemWriter {

	private final ObjectMapper objectMapper;

	public SecurityProblemWriter() {
		this.objectMapper = JsonMapper.builder()
				.addMixIn(ProblemDetail.class, ProblemDetailJacksonMixin.class)
				.build();
	}

	public void write(HttpServletResponse response, ProblemDetail problem) throws IOException {
		if (response.isCommitted()) {
			return;
		}

		response.setStatus(problem.getStatus());
		response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
		response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
		objectMapper.writeValue(response.getWriter(), problem);
	}

}
