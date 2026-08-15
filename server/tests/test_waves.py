import unittest

from orchestrator.waves import iter_task_waves, tasks_conflict


class TaskWaveTests(unittest.TestCase):
    def test_backend_and_frontend_run_together(self) -> None:
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
        waves = iter_task_waves(tasks)
        self.assertEqual(len(waves), 1)
        self.assertEqual({t["id"] for t in waves[0]}, {"t1", "t2"})

    def test_overlapping_files_are_serialized(self) -> None:
        tasks = [
            {"id": "t1", "owner": "backend", "target_files": ["app.py"], "depends_on": []},
            {"id": "t2", "owner": "frontend", "target_files": ["app.py"], "depends_on": []},
        ]
        waves = iter_task_waves(tasks)
        self.assertEqual(len(waves), 2)
        self.assertEqual(len(waves[0]), 1)
        self.assertEqual(len(waves[1]), 1)

    def test_depends_on_creates_second_wave(self) -> None:
        tasks = [
            {"id": "t1", "owner": "backend", "target_files": ["api.py"], "depends_on": []},
            {
                "id": "t2",
                "owner": "frontend",
                "target_files": ["ui.tsx"],
                "depends_on": ["t1"],
            },
        ]
        waves = iter_task_waves(tasks)
        self.assertEqual([[t["id"] for t in w] for w in waves], [["t1"], ["t2"]])

    def test_completed_tasks_are_skipped(self) -> None:
        tasks = [
            {"id": "t1", "owner": "backend", "target_files": ["a.py"], "depends_on": []},
            {"id": "t2", "owner": "frontend", "target_files": ["b.tsx"], "depends_on": []},
        ]
        waves = iter_task_waves(tasks, completed=["t1"])
        self.assertEqual(len(waves), 1)
        self.assertEqual(waves[0][0]["id"], "t2")

    def test_same_owner_without_files_does_not_parallelize(self) -> None:
        left = {"id": "t1", "owner": "backend", "target_files": [], "depends_on": []}
        right = {"id": "t2", "owner": "backend", "target_files": [], "depends_on": []}
        self.assertTrue(tasks_conflict(left, right))
        waves = iter_task_waves([left, right])
        self.assertEqual(len(waves), 2)

    def test_different_owners_without_files_can_parallelize(self) -> None:
        left = {"id": "t1", "owner": "backend", "target_files": [], "depends_on": []}
        right = {"id": "t2", "owner": "frontend", "target_files": [], "depends_on": []}
        self.assertFalse(tasks_conflict(left, right))
        waves = iter_task_waves([left, right])
        self.assertEqual(len(waves), 1)


if __name__ == "__main__":
    unittest.main()
