import unittest

from orchestrator.tasks import remaining_tasks, task_owner


class RemainingTaskTests(unittest.TestCase):
    def test_tasks_run_one_after_another_in_planner_order(self) -> None:
        tasks = [
            {
                "id": "t1",
                "owner": "backend",
                "target_files": ["api/auth.py"],
                "depends_on": [],
            },
            {
                "id": "t2",
                "owner": "frontend",
                "target_files": ["src/Login.tsx"],
                "depends_on": [],
            },
        ]
        leftover = remaining_tasks(tasks)
        self.assertEqual([t["id"] for t in leftover], ["t1", "t2"])

    def test_depends_on_runs_dependency_first(self) -> None:
        tasks = [
            {
                "id": "t2",
                "owner": "frontend",
                "target_files": ["ui.tsx"],
                "depends_on": ["t1"],
            },
            {"id": "t1", "owner": "backend", "target_files": ["api.py"], "depends_on": []},
        ]
        leftover = remaining_tasks(tasks)
        self.assertEqual([t["id"] for t in leftover], ["t1", "t2"])

    def test_completed_tasks_are_skipped(self) -> None:
        tasks = [
            {"id": "t1", "owner": "backend", "target_files": ["a.py"], "depends_on": []},
            {"id": "t2", "owner": "frontend", "target_files": ["b.tsx"], "depends_on": []},
        ]
        leftover = remaining_tasks(tasks, completed=["t1"])
        self.assertEqual([t["id"] for t in leftover], ["t2"])

    def test_default_owner_is_backend(self) -> None:
        self.assertEqual(task_owner({}), "backend")


if __name__ == "__main__":
    unittest.main()
