package io.github.apdmrl.messor.project;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface ProjectMemberRepository extends JpaRepository<ProjectMember, UUID> {

	Optional<ProjectMember> findByProjectIdAndUserId(UUID projectId, UUID userId);

}
