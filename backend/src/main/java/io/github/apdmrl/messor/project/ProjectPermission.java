package io.github.apdmrl.messor.project;

/**
 * Project-scoped operation permission used by the focused authorization
 * service. Each project operation maps to exactly one permission.
 */
public enum ProjectPermission {

	READ,
	MANAGE_PROJECT,
	MANAGE_MEMBERS,
	MUTATE_ISSUES,
	COMMENT

}
