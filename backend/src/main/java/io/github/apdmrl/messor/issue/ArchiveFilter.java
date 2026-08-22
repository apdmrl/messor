package io.github.apdmrl.messor.issue;

/**
 * Exact archive filter contract for My Work.
 *
 * <p>The value is controlled by a single enum so the allowed set is fixed and
 * never coerced from arbitrary client text: {@code ACTIVE} (the default, only
 * non-archived issues), {@code ARCHIVED} (only archived issues) and {@code ALL}
 * (both). The enum name is the canonical serialized form (lower-cased in the
 * query string).</p>
 */
public enum ArchiveFilter {
	ACTIVE,
	ARCHIVED,
	ALL
}
