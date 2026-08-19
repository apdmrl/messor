package io.github.apdmrl.messor.issue;

import java.util.List;

import org.springframework.data.domain.Page;

/**
 * Safe flat projection of a paginated active issue listing.
 *
 * <p>Contains exactly the locked fields: {@code items} (safe
 * {@link IssueResponse}s), {@code page}, {@code size}, {@code totalItems} and
 * {@code totalPages}. JPA entities are never serialized directly; each item is
 * mapped through the exact safe {@link IssueResponse} projection.</p>
 */
public record IssuePageResponse(
		List<IssueResponse> items,
		int page,
		int size,
		long totalItems,
		int totalPages) {

	public static IssuePageResponse from(Page<Issue> result) {
		return new IssuePageResponse(
				result.getContent().stream().map(IssueResponse::from).toList(),
				result.getNumber(),
				result.getSize(),
				result.getTotalElements(),
				result.getTotalPages());
	}

}
