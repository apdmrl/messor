package io.github.apdmrl.messor.issue;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Shared deep-freezing utility for the controlled activity summary JSONB
 * document.
 *
 * <p>The summary is a controlled shape: an outer {@link Map} whose values are
 * scalar {@link String}/{@link java.util.UUID}/{@code null} values or a nested
 * {@link List} of {@link String}s (the {@code changedFields} array). This
 * utility defensively copies the outer map and every nested list so a caller
 * cannot mutate the persisted/returned data after construction, and returns a
 * deeply unmodifiable structure. {@code Map.copyOf} is intentionally not used
 * because the {@code assigneeId} value may legitimately be JSON {@code null},
 * which {@code Map.copyOf} rejects.</p>
 */
final class IssueActivitySummary {

	private IssueActivitySummary() {
	}

	/**
	 * Returns a deeply unmodifiable copy of the supplied controlled summary map.
	 * The outer map is copied into a new insertion-ordered map and wrapped
	 * unmodifiable; every nested {@link List} value is copied with
	 * {@link List#copyOf} so the nested {@code changedFields} array is frozen.
	 * Scalar values (including JSON {@code null}) are preserved as-is.
	 */
	static Map<String, Object> deepFreeze(Map<String, Object> source) {
		Map<String, Object> copy = new LinkedHashMap<>();
		for (Map.Entry<String, Object> entry : source.entrySet()) {
			Object value = entry.getValue();
			if (value instanceof List<?> list) {
				copy.put(entry.getKey(), List.copyOf(list));
			}
			else {
				copy.put(entry.getKey(), value);
			}
		}
		return Collections.unmodifiableMap(copy);
	}

}
