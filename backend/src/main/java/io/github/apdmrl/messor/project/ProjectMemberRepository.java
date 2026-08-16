package io.github.apdmrl.messor.project;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

public interface ProjectMemberRepository extends JpaRepository<ProjectMember, UUID> {

	Optional<ProjectMember> findByProjectIdAndUserId(UUID projectId, UUID userId);

	/**
	 * Returns all members of a project ordered by the normalized user email for
	 * a deterministic list response.
	 */
	@Query("""
			select pm from ProjectMember pm
			join fetch pm.user u
			where pm.project.id = :projectId
			order by u.email asc
			""")
	List<ProjectMember> findAllByProjectIdOrderByUserEmailAsc(@Param("projectId") UUID projectId);

	/**
	 * Counts the {@code PROJECT_LEAD} memberships of a project. Used to enforce
	 * the final-lead invariant.
	 */
	@Query("""
			select count(pm) from ProjectMember pm
			where pm.project.id = :projectId and pm.role = io.github.apdmrl.messor.project.ProjectRole.PROJECT_LEAD
			""")
	long countLeadsByProjectId(@Param("projectId") UUID projectId);

	/**
	 * Locks the membership rows of a project so the final-lead invariant can be
	 * checked and mutated atomically under concurrency.
	 */
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("""
			select pm from ProjectMember pm
			where pm.project.id = :projectId
			""")
	List<ProjectMember> lockAllByProjectId(@Param("projectId") UUID projectId);

}
