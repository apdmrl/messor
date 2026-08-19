package io.github.apdmrl.messor.issue;

import java.time.Instant;
import java.util.Map;
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
import jakarta.persistence.Table;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * An immutable activity record for an issue backed by the V4
 * {@code issue_activity} table.
 *
 * <p>The {@code summary} is a controlled JSONB document built by the service
 * from server-derived values only. It is mapped with Hibernate's explicit JSON
 * type ({@link JdbcTypeCode} + {@link SqlTypes#JSON}) so it is serialized by
 * the framework's Jackson integration rather than by string concatenation.</p>
 */
@Entity
@Table(name = "issue_activity")
public class IssueActivity {

	@Id
	@Column(name = "id", nullable = false, updatable = false)
	private UUID id;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "issue_id", nullable = false, updatable = false)
	private Issue issue;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "actor_id", nullable = false, updatable = false)
	private UserAccount actor;

	@Enumerated(EnumType.STRING)
	@Column(name = "type", nullable = false, length = 32)
	private IssueActivityType type;

	@JdbcTypeCode(SqlTypes.JSON)
	@Column(name = "summary", nullable = false, columnDefinition = "jsonb")
	private Map<String, Object> summary;

	@Column(name = "created_at", nullable = false, updatable = false)
	private Instant createdAt;

	protected IssueActivity() {
	}

	public static IssueActivity create(Issue issue, UserAccount actor, IssueActivityType type,
			Map<String, Object> summary) {
		IssueActivity activity = new IssueActivity();
		activity.id = UUID.randomUUID();
		activity.issue = issue;
		activity.actor = actor;
		activity.type = type;
		activity.summary = IssueActivitySummary.deepFreeze(summary);
		activity.createdAt = Instant.now();
		return activity;
	}

	public UUID getId() {
		return id;
	}

	public Issue getIssue() {
		return issue;
	}

	public UserAccount getActor() {
		return actor;
	}

	public IssueActivityType getType() {
		return type;
	}

	/**
	 * Returns a deeply unmodifiable copy of the summary. The field is frozen on
	 * construction via {@link IssueActivitySummary#deepFreeze}, but Hibernate may
	 * hydrate the JSONB column directly into a mutable map/list, so the field is
	 * deep-frozen again before exposure to guarantee the returned structure is
	 * always deeply unmodifiable.
	 */
	public Map<String, Object> getSummary() {
		return IssueActivitySummary.deepFreeze(summary);
	}

	public Instant getCreatedAt() {
		return createdAt;
	}

	@PrePersist
	void onCreate() {
		this.createdAt = Instant.now();
	}

}
