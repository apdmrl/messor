package io.github.apdmrl.messor.project;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import io.github.apdmrl.messor.identity.UserAccount;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

@Entity
@Table(name = "project")
public class Project {

	@Id
	@Column(name = "id", nullable = false, updatable = false)
	private UUID id;

	@Column(name = "key", nullable = false, unique = true, updatable = false, length = 10)
	private String key;

	@Column(name = "name", nullable = false, length = 120)
	private String name;

	@Column(name = "description", length = 2000)
	private String description;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "creator_id", nullable = false, updatable = false)
	private UserAccount creator;

	@OneToMany(mappedBy = "project", fetch = FetchType.LAZY)
	private List<ProjectMember> members = new ArrayList<>();

	@Column(name = "created_at", nullable = false, updatable = false)
	private Instant createdAt;

	@Column(name = "updated_at", nullable = false)
	private Instant updatedAt;

	@Version
	@Column(name = "version", nullable = false)
	private long version;

	protected Project() {
	}

	public static Project create(String key, String name, String description, UserAccount creator) {
		Project project = new Project();
		project.id = UUID.randomUUID();
		project.key = ProjectKeyNormalizer.normalize(key);
		project.name = requireNotBlank(name, "name");
		project.description = description;
		project.creator = creator;
		Instant now = Instant.now();
		project.createdAt = now;
		project.updatedAt = now;
		return project;
	}

	public void update(String name, String description) {
		this.name = requireNotBlank(name, "name");
		this.description = description;
	}

	public UUID getId() {
		return id;
	}

	public String getKey() {
		return key;
	}

	public String getName() {
		return name;
	}

	public String getDescription() {
		return description;
	}

	public UserAccount getCreator() {
		return creator;
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
