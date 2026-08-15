package io.github.apdmrl.messor.common.api;

import java.util.List;

/**
 * Stable, bounded pagination envelope for list responses.
 *
 * @param items      the page contents
 * @param page       zero-based page index
 * @param size       page size
 * @param totalItems total number of matching items
 * @param totalPages total number of pages
 * @param <T>        item type
 */
public record PageResponse<T>(List<T> items, int page, int size, long totalItems, int totalPages) {

	public static <T> PageResponse<T> of(List<T> items, int page, int size, long totalItems) {
		int totalPages = size == 0 ? 0 : (int) Math.ceil((double) totalItems / size);
		return new PageResponse<>(items, page, size, totalItems, totalPages);
	}

}
