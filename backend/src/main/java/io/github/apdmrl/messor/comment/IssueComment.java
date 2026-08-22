package io.github.apdmrl.messor.comment;

import java.time.Instant;
import java.util.UUID;

import io.github.apdmrl.messor.identity.UserAccount;
import io.github.apdmrl.messor.issue.Issue;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

/**
 * A project-authorized comment on an issue, backed by the V5
 * {@code issue_comment} table.
 *
 * <p>A comment is either active (body non-null, non-blank, at most 5000
 * characters) or a retained tombstone ({@code deleted = true}, body null). The
 * author and issue are server-derived and immutable; deletion never removes the
 * row so the original position, author and timestamps remain readable. The
 * {@code version} is an optimistic-lock counter that also drives conflict
 * detection for edits and deletion.</p>
 */
@Entity
@Table(name = "issue_comment")
public class IssueComment {

	@Id
	@Column(name = "id", nullable = false, updatable = false)
	private UUID id;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "issue_id", nullable = false, updatable = false)
	private Issue issue;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "author_id", nullable = false, updatable = false)
	private UserAccount author;

	@Column(name = "body")
	private String body;

	@Column(name = "deleted", nullable = false)
	private boolean deleted;

	@Column(name = "created_at", nullable = false, updatable = false)
	private Instant createdAt;

	@Column(name = "updated_at", nullable = false)
	private Instant updatedAt;

	@Version
	@Column(name = "version", nullable = false)
	private long version;

	protected IssueComment() {
	}

	/**
	 * Creates an active comment for the given issue and author. The caller is
	 * responsible for validating the body and the authorization before invoking
	 * this method.
	 */
	public static IssueComment create(Issue issue, UserAccount author, String body) {
		IssueComment comment = new IssueComment();
		comment.id = UUID.randomUUID();
		comment.issue = issue;
		comment.author = author;
		comment.body = body;
		comment.deleted = false;
		Instant now = Instant.now();
		comment.createdAt = now;
		comment.updatedAt = now;
		return comment;
	}

	public UUID getId() {
		return id;
	}

	public Issue getIssue() {
		return issue;
	}

	public UserAccount getAuthor() {
		return author;
	}

	public String getBody() {
		return body;
	}

	public boolean isDeleted() {
		return deleted;
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
	 * Replaces the body of an active comment. The caller is responsible for
	 * validating the body and the optimistic version before invoking this
	 * method. The author, issue and createdAt are preserved.
	 */
	public void replaceBody(String newBody) {
		this.body = newBody;
	}

	/**
	 * Converts this comment into a retained tombstone: body nulled, deleted set,
	 * author/issue/createdAt preserved. The caller is responsible for validating
	 * the optimistic version and current state before invoking this method.
	 */
	public void tombstone() {
		this.body = null;
		this.deleted = true;
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
