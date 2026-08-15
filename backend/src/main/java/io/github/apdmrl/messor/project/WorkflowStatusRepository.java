package io.github.apdmrl.messor.project;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface WorkflowStatusRepository extends JpaRepository<WorkflowStatus, UUID> {

	List<WorkflowStatus> findByProjectIdOrderByPositionAsc(UUID projectId);

}
