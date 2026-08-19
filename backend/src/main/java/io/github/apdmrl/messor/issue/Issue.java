package io.github.apdmrl.messor.issue;

import java.time.Instant;
import java.util.UUID;

import io.github.apdmrl.messor.identity.UserAccount;
import io.github.apdmrl.messor.project.Project;
import io.github.apdmrl.messor.project.WorkflowStatus;
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
import jakarta.persistence.Version;

/**
 * A project-scoped issue (story, task or bug) backed by the V4 {@code issue}
 * table.
 *
 * <p>The human key, number, reporter, initial workflow status, rank, archived
 * flag and version are all server-derived; the entity never accepts them from a
 * client. The workflow status is referenced by UUID and must belong to the same
 * project as the issue (enforced by the composite foreign key
 * {@code fk_issue_workflow_status}).</p>
 */
@Entity
@Table(name = "issue")
public class Issue {

	@Id
	@Column(name = "id", nullable = false, updatable = false)
	private UUID id;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "project_id", nullable = false, updatable = false)
	private Project project;

	@Column(name = "number", nullable = false, updatable = false)
	private long number;

	@Column(name = "human_key", nullable = false, updatable = false, length = 32)
	private String humanKey;

	@Enumerated(EnumType.STRING)
	@Column(name = "type", nullable = false, length = 32)
	private IssueType type;

	@Column(name = "title", nullable = false, length = 200)
	private String title;

	@Column(name = "description", length = 10000)
	private String description;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "workflow_status_id", nullable = false)
	private WorkflowStatus workflowStatus;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "reporter_id", nullable = false, updatable = false)
	private UserAccount reporter;

	@ManyToOne(fetch = FetchType.LAZY, optional = true)
	@JoinColumn(name = "assignee_id")
	private UserAccount assignee;

	@Column(name = "rank", nullable = false)
	private long rank;

	@Column(name = "archived", nullable = false)
	private boolean archived;

	@Column(name = "created_at", nullable = false, updatable = false)
	private Instant createdAt;

	@Column(name = "updated_at", nullable = false)
	private Instant updatedAt;

	@Version
	@Column(name = "version", nullable = false)
	private long version;

	protected Issue() {
	}

	public static Issue create(Project project, long number, String humanKey, IssueType type,
			String title, String description, WorkflowStatus workflowStatus,
			UserAccount reporter, UserAccount assignee, long rank) {
		Issue issue = new Issue();
		issue.id = UUID.randomUUID();
		issue.project = project;
		issue.number = number;
		issue.humanKey = humanKey;
		issue.type = type;
		issue.title = requireNotBlank(title, "title");
		issue.description = description;
		issue.workflowStatus = workflowStatus;
		issue.reporter = reporter;
		issue.assignee = assignee;
		issue.rank = rank;
		issue.archived = false;
		Instant now = Instant.now();
		issue.createdAt = now;
		issue.updatedAt = now;
		return issue;
	}

	public UUID getId() {
		return id;
	}

	public Project getProject() {
		return project;
	}

	public long getNumber() {
		return number;
	}

	public String getHumanKey() {
		return humanKey;
	}

	public IssueType getType() {
		return type;
	}

	public String getTitle() {
		return title;
	}

	public String getDescription() {
		return description;
	}

	public WorkflowStatus getWorkflowStatus() {
		return workflowStatus;
	}

	public UserAccount getReporter() {
		return reporter;
	}

	public UserAccount getAssignee() {
		return assignee;
	}

	public long getRank() {
		return rank;
	}

	public boolean isArchived() {
		return archived;
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

	/**
	 * Replaces the mutable details of this issue: title, description and
	 * assignee. The project, number, human key, type, reporter, workflow status,
	 * rank, archived flag and createdAt are never changed by this method. The
	 * caller is responsible for validating the assignee and the optimistic
	 * version before invoking this method.
	 */
	public void updateDetails(String newTitle, String newDescription, UserAccount newAssignee) {
		this.title = requireNotBlank(newTitle, "title");
		this.description = newDescription;
		this.assignee = newAssignee;
	}

	/**
	 * Marks this issue as archived. Only the {@code archived} flag changes; the
	 * project, number, key, type, title, description, workflow status, reporter,
	 * assignee, rank and createdAt are preserved. The caller is responsible for
	 * validating the optimistic version and the archived state before invoking
	 * this method.
	 */
	public void archive() {
		this.archived = true;
	}

	/**
	 * Moves this issue to the given workflow status and rank. The caller is
	 * responsible for validating the optimistic version, archived state, target
	 * status and neighbor before invoking this method. Only the workflow status
	 * and rank change; every other field is preserved.
	 */
	public void moveTo(WorkflowStatus newStatus, long newRank) {
		this.workflowStatus = newStatus;
		this.rank = newRank;
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
