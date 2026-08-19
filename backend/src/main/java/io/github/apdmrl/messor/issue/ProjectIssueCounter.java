package io.github.apdmrl.messor.issue;

import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

/**
 * Per-project atomic issue number counter backed by the V4
 * {@code project_issue_counter} table.
 *
 * <p>The primary key is the owning project id, so each project has exactly one
 * counter row and independent projects never share a counter or a lock. The
 * {@code next_number} is the next issue number to allocate; it is advanced
 * under a pessimistic write lock inside the same transaction that inserts the
 * issue and its CREATED activity.</p>
 */
@Entity
@Table(name = "project_issue_counter")
public class ProjectIssueCounter {

	@Id
	@Column(name = "project_id", nullable = false, updatable = false)
	private UUID projectId;

	@Column(name = "next_number", nullable = false)
	private long nextNumber;

	@Version
	@Column(name = "version", nullable = false)
	private long version;

	protected ProjectIssueCounter() {
	}

	public static ProjectIssueCounter create(UUID projectId) {
		ProjectIssueCounter counter = new ProjectIssueCounter();
		counter.projectId = projectId;
		counter.nextNumber = 1L;
		return counter;
	}

	public UUID getProjectId() {
		return projectId;
	}

	public long getNextNumber() {
		return nextNumber;
	}

	public void setNextNumber(long nextNumber) {
		this.nextNumber = nextNumber;
	}

	public long getVersion() {
		return version;
	}

}
