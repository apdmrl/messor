package io.github.apdmrl.messor.project;

/**
 * Result of a successful project authorization check: the authorized
 * {@link Project} and the effective {@link ProjectRole} of the acting
 * principal. An {@code ORG_ADMIN} is reported with the effective
 * {@code PROJECT_LEAD} role to preserve the existing response convention.
 */
public record ProjectAccess(Project project, ProjectRole effectiveRole) {
}
