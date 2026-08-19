package io.github.apdmrl.messor.issue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import io.github.apdmrl.messor.identity.UserAccount;
import io.github.apdmrl.messor.identity.UserRole;
import io.github.apdmrl.messor.project.Project;
import io.github.apdmrl.messor.project.WorkflowStatus;
import org.junit.jupiter.api.Test;

/**
 * RED-phase unit tests for the deep immutability of the controlled activity
 * summary.
 *
 * <p>The summary is a controlled JSONB document whose nested {@code changedFields}
 * list must be defensively copied and frozen so a caller cannot mutate the
 * persisted/returned data after construction. These tests construct a mutable
 * source map containing a mutable {@code changedFields} {@link ArrayList},
 * build the entity/response, mutate the original source list, and prove the
 * stored/output data did not change and that the returned nested list is
 * unmodifiable. {@code null} assigneeId support is preserved.</p>
 */
class IssueActivityTest {

	@Test
	void activityDefensivelyCopiesAndFreezesNestedChangedFields() {
		UserAccount actor = UserAccount.create(
				"activity-actor@example.com",
				"correct horse battery staple",
				"Ada",
				"Lovelace",
				UserRole.USER);
		Project project = Project.create("ACT", "Activity project", null, actor);
		WorkflowStatus status = WorkflowStatus.create(project, "TO_DO", "To Do", 0);
		Issue issue = Issue.create(project, 1L, "ACT-1", IssueType.STORY, "Title", "desc",
				status, actor, null, 1024L);

		// A mutable source map containing a mutable changedFields ArrayList.
		List<String> changedFields = new ArrayList<>(List.of("title"));
		Map<String, Object> source = new LinkedHashMap<>();
		source.put("changedFields", changedFields);
		source.put("assigneeId", null);

		IssueActivity activity = IssueActivity.create(issue, actor, IssueActivityType.UPDATED,
				source);

		// Mutating the original source list must not change the stored data.
		changedFields.add("description");
		changedFields.set(0, "tampered");
		source.put("assigneeId", UUID.randomUUID());

		Map<String, Object> summary = activity.getSummary();
		assertThat(summary.get("assigneeId")).isNull();
		@SuppressWarnings("unchecked")
		List<String> storedChanged = (List<String>) summary.get("changedFields");
		assertThat(storedChanged).containsExactly("title");

		// The returned nested changedFields list must be unmodifiable.
		assertThatThrownBy(() -> storedChanged.add("description"))
				.isInstanceOf(UnsupportedOperationException.class);
		assertThatThrownBy(() -> storedChanged.set(0, "tampered"))
				.isInstanceOf(UnsupportedOperationException.class);
	}

	@Test
	void activityResponseDefensivelyCopiesAndFreezesNestedChangedFields() {
		UserAccount actor = UserAccount.create(
				"activity-response-actor@example.com",
				"correct horse battery staple",
				"Ada",
				"Lovelace",
				UserRole.USER);
		Project project = Project.create("RESP", "Response project", null, actor);
		WorkflowStatus status = WorkflowStatus.create(project, "TO_DO", "To Do", 0);
		Issue issue = Issue.create(project, 1L, "RESP-1", IssueType.TASK, "Title", "desc",
				status, actor, null, 1024L);

		// A mutable source map containing a mutable changedFields ArrayList.
		List<String> changedFields = new ArrayList<>(List.of("title", "assigneeId"));
		Map<String, Object> source = new LinkedHashMap<>();
		source.put("changedFields", changedFields);
		source.put("assigneeId", null);

		IssueActivity activity = IssueActivity.create(issue, actor, IssueActivityType.UPDATED,
				source);
		IssueActivityResponse response = IssueActivityResponse.from(activity);

		// Mutating the original source list must not change the output data.
		changedFields.add("description");
		changedFields.set(0, "tampered");
		source.put("assigneeId", UUID.randomUUID());

		Map<String, Object> summary = response.summary();
		assertThat(summary.get("assigneeId")).isNull();
		@SuppressWarnings("unchecked")
		List<String> outputChanged = (List<String>) summary.get("changedFields");
		assertThat(outputChanged).containsExactly("title", "assigneeId");

		// The returned nested changedFields list must be unmodifiable.
		assertThatThrownBy(() -> outputChanged.add("description"))
				.isInstanceOf(UnsupportedOperationException.class);
		assertThatThrownBy(() -> outputChanged.set(0, "tampered"))
				.isInstanceOf(UnsupportedOperationException.class);
	}

}
