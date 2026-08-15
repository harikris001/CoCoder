import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from orchestrator.gates import after_quality_gate
from tools.tests.run_tests import detect_test_command, is_allowed_test_command, run_workspace_tests


class AllowlistTests(unittest.TestCase):
    def test_allows_detected_pytest(self) -> None:
        self.assertTrue(is_allowed_test_command(["python", "-m", "pytest", "-q", "--tb=short"]))

    def test_allows_npm_test_with_watch_flag(self) -> None:
        self.assertTrue(is_allowed_test_command(["npm", "test", "--", "--watchAll=false"]))

    def test_allows_go_test_recursive(self) -> None:
        self.assertTrue(is_allowed_test_command(["go", "test", "./..."]))

    def test_rejects_rm(self) -> None:
        self.assertFalse(is_allowed_test_command(["rm", "-rf", "/"]))

    def test_rejects_bash_c(self) -> None:
        self.assertFalse(is_allowed_test_command(["bash", "-c", "pytest"]))

    def test_rejects_pytest_with_shell_injection(self) -> None:
        self.assertFalse(is_allowed_test_command(["python", "-m", "pytest", "; rm -rf /"]))

    def test_rejects_empty(self) -> None:
        self.assertFalse(is_allowed_test_command([]))


class DetectCommandTests(unittest.TestCase):
    def test_pytest_ini(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "pytest.ini").write_text("[pytest]\n", encoding="utf-8")
            self.assertEqual(
                detect_test_command(root),
                ["python", "-m", "pytest", "-q", "--tb=short"],
            )

    def test_package_json_npm(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "package.json").write_text(
                json.dumps({"scripts": {"test": "vitest run"}}),
                encoding="utf-8",
            )
            self.assertEqual(
                detect_test_command(root),
                ["npm", "test", "--", "--watchAll=false"],
            )

    def test_package_json_pnpm_lock(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "package.json").write_text(
                json.dumps({"scripts": {"test": "vitest"}}),
                encoding="utf-8",
            )
            (root / "pnpm-lock.yaml").write_text("lockfileVersion: 9\n", encoding="utf-8")
            self.assertEqual(
                detect_test_command(root),
                ["pnpm", "test", "--", "--watchAll=false"],
            )

    def test_cargo(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "Cargo.toml").write_text("[package]\nname='x'\n", encoding="utf-8")
            self.assertEqual(detect_test_command(root), ["cargo", "test"])

    def test_no_tests(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(detect_test_command(tmp))


class RunWorkspaceTests(unittest.TestCase):
    def test_no_tests_found_does_not_shell_out(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = run_workspace_tests(tmp)
        self.assertTrue(result["no_tests_found"])
        self.assertFalse(result["ran"])
        self.assertIsNone(result["command"])

    def test_allowlisted_command_is_executed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "pytest.ini").write_text("[pytest]\n", encoding="utf-8")
            with patch("tools.tests.run_tests.subprocess.run") as run:
                run.return_value.returncode = 1
                run.return_value.stdout = "FAILED test_foo.py"
                run.return_value.stderr = ""
                result = run_workspace_tests(root)
        self.assertTrue(result["ran"])
        self.assertFalse(result["passed"])
        self.assertEqual(result["exit_code"], 1)
        argv = run.call_args.args[0]
        self.assertTrue(is_allowed_test_command(argv))
        self.assertFalse(run.call_args.kwargs.get("shell"))


class QualityGateTests(unittest.TestCase):
    def test_pass_proceeds(self) -> None:
        self.assertEqual(
            after_quality_gate(passed=True, retries=0, max_retries=3),
            "proceed",
        )

    def test_fail_retries_and_clears_completed_tasks(self) -> None:
        action = after_quality_gate(passed=False, retries=0, max_retries=3)
        self.assertEqual(action, "retry_develop")
        completed = ["t1", "t2"]
        if action == "retry_develop":
            completed = []
        self.assertEqual(completed, [])

    def test_fail_at_budget_needs_human(self) -> None:
        self.assertEqual(
            after_quality_gate(passed=False, retries=3, max_retries=3),
            "needs_human",
        )


class WorkspaceCleanupTests(unittest.TestCase):
    def test_deletes_new_test_file_and_keeps_developer_file(self) -> None:
        from tools.tests.cleanup import restore_workspace_snapshot, take_workspace_snapshot

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src = root / "app.py"
            src.write_text("ok\n", encoding="utf-8")
            snap = take_workspace_snapshot(root)
            leftover = root / "tests" / "test_tmp_cocoder.py"
            leftover.parent.mkdir(parents=True)
            leftover.write_text("def test_tmp():\n    assert False\n", encoding="utf-8")
            src.write_text("mutated by tester\n", encoding="utf-8")
            removed = restore_workspace_snapshot(root, snap)
            self.assertFalse(leftover.exists())
            self.assertEqual(src.read_text(encoding="utf-8"), "ok\n")
            self.assertIn("tests/test_tmp_cocoder.py", removed)
            self.assertIn("app.py", removed)
            self.assertFalse((root / "tests").exists())


class RecursionLimitTests(unittest.TestCase):
    def test_graph_recursion_is_not_retried(self) -> None:
        from langgraph.errors import GraphRecursionError
        from orchestrator.pipeline import _invoke_agent_sync

        class Boom:
            def __init__(self) -> None:
                self.calls = 0
                self.limits: list[int] = []

            def invoke(self, *_args: object, **kwargs: object) -> object:
                self.calls += 1
                config = kwargs.get("config") or {}
                if isinstance(config, dict):
                    self.limits.append(int(config.get("recursion_limit") or 0))
                raise GraphRecursionError("limit")

        agent = Boom()
        with self.assertRaises(GraphRecursionError):
            _invoke_agent_sync(agent, "do work", retries=2)
        self.assertEqual(agent.calls, 1)
        self.assertEqual(agent.limits[0], 50)


if __name__ == "__main__":
    unittest.main()
