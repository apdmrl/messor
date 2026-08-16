package io.github.apdmrl.messor.project;

import java.time.Instant;
import java.util.UUID;

import io.github.apdmrl.messor.identity.UserAccount;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.persistence.Version;

@Entity
@Table(name = "project_member", uniqueConstraints = {
		@UniqueConstraint(name = "uq_project_member_project_user", columnNames = { "project_id", "user_account_id" })
})
public class ProjectMember {

	@Id
	@Column(name = "id", nullable = false, updatable = false)
	private UUID id;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "project_id", nullable = false, updatable = false)
	private Project project;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "user_account_id", nullable = false, updatable = false)
	private UserAccount user;

	@Enumerated(EnumType.STRING)
	@Column(name = "role", nullable = false, length = 32)
	private ProjectRole role;

	@Column(name = "created_at", nullable = false, updatable = false)
	private Instant createdAt;

	@Column(name = "updated_at", nullable = false)
	private Instant updatedAt;

	@Version
	@Column(name = "version", nullable = false)
	private long version;

	protected ProjectMember() {
	}

	public static ProjectMember create(Project project, UserAccount user, ProjectRole role) {
		ProjectMember member = new ProjectMember();
		member.id = UUID.randomUUID();
		member.project = project;
		member.user = user;
		member.role = role;
		return member;
	}

	/**
	 * Changes this member's role. Business rules such as the final-lead
	 * invariant are enforced by the application service before this method is
	 * invoked; this method only mutates the domain state.
	 */
	public void changeRole(ProjectRole newRole) {
		if (newRole == null) {
			throw new IllegalArgumentException("role must not be null");
		}
		this.role = newRole;
	}

	public UUID getId() {
		return id;
	}

	public Project getProject() {
		return project;
	}

	public UserAccount getUser() {
		return user;
	}

	public ProjectRole getRole() {
		return role;
	}

	public Instant getCreatedAt() {
		return createdAt;
	}

	public Instant getUpdatedAt() {
		return updatedAt;
	}

	public long getVersion() {
		return version;
	}

	@PrePersist
	void onCreate() {
		Instant now = Instant.now();
		this.createdAt = now;
		this.updatedAt = now;
	}

	@PreUpdate
	void onUpdate() {
		this.updatedAt = Instant.now();
	}

}
