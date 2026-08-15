package io.github.apdmrl.messor.project;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProjectRepository extends JpaRepository<Project, UUID> {

	Optional<Project> findByKey(String key);

	boolean existsByKey(String key);

	Page<Project> findAllByMembersUserId(UUID userId, Pageable pageable);

}
