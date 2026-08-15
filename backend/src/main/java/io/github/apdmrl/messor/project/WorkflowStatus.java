package io.github.apdmrl.messor.project;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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
@Table(name = "workflow_status", uniqueConstraints = {
		@UniqueConstraint(name = "uq_workflow_status_project_code", columnNames = { "project_id", "code" }),
		@UniqueConstraint(name = "uq_workflow_status_project_position", columnNames = { "project_id", "position" })
})
public class WorkflowStatus {

	@Id
	@Column(name = "id", nullable = false, updatable = false)
	private UUID id;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "project_id", nullable = false, updatable = false)
	private Project project;

	@Column(name = "code", nullable = false, length = 32)
	private String code;

	@Column(name = "display_name", nullable = false, length = 120)
	private String displayName;

	@Column(name = "position", nullable = false)
	private int position;

	@Column(name = "created_at", nullable = false, updatable = false)
	private Instant createdAt;

	@Column(name = "updated_at", nullable = false)
	private Instant updatedAt;

	@Version
	@Column(name = "version", nullable = false)
	private long version;

	protected WorkflowStatus() {
	}

	public static WorkflowStatus create(Project project, String code, String displayName, int position) {
		WorkflowStatus status = new WorkflowStatus();
		status.id = UUID.randomUUID();
		status.project = project;
		status.code = code;
		status.displayName = requireNotBlank(displayName, "displayName");
		status.position = position;
		return status;
	}

	public UUID getId() {
		return id;
	}

	public Project getProject() {
		return project;
	}

	public String getCode() {
		return code;
	}

	public String getDisplayName() {
		return displayName;
	}

	public int getPosition() {
		return position;
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

	private static String requireNotBlank(String value, String field) {
		if (value == null || value.isBlank()) {
			throw new IllegalArgumentException(field + " must not be blank");
		}
		return value;
	}

}
