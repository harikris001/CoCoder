"""Tests for the agent harness: tool output caps, prompt hints, finalize retry."""

import tempfile
import unittest
from pathlib import Path

from langchain.agents.middleware.tool_call_limit import ToolCallLimitExceededError


class ToolCapsTests(unittest.TestCase):
    def setUp(self) -> None:
        from tools.agent_tools import configure_tools, list_files, read_file

        self.read_file = read_file
        self.list_files = list_files
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        configure_tools(self.root, 1)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_read_file_truncates_large_files(self) -> None:
        big = "x" * 50000
        (self.root / "big.py").write_text(big, encoding="utf-8")
        result = self.read_file.invoke({"file_path": "big.py"})
        self.assertLess(len(result), 50000)
        self.assertIn("truncated", result)

    def test_read_file_keeps_small_files(self) -> None:
        (self.root / "small.py").write_text("ok", encoding="utf-8")
        self.assertEqual(self.read_file.invoke({"file_path": "small.py"}), "ok")

    def test_list_files_ignores_build_dirs(self) -> None:
        (self.root / "src").mkdir()
        (self.root / "src" / "app.js").write_text("x", encoding="utf-8")
        (self.root / "node_modules").mkdir()
        (self.root / "node_modules" / "dep").mkdir()
        (self.root / "node_modules" / "dep" / "index.js").write_text("x", encoding="utf-8")
        (self.root / ".git").mkdir()
        (self.root / ".git" / "HEAD").write_text("x", encoding="utf-8")
        entries = self.list_files.invoke({"directory": "."})
        self.assertIn("src/app.js", entries)
        self.assertNotIn("node_modules/dep/index.js", entries)
        self.assertNotIn(".git/HEAD", entries)

    def test_list_files_caps_entries(self) -> None:
        for i in range(300):
            (self.root / f"f{i}.py").write_text("x", encoding="utf-8")
        entries = self.list_files.invoke({"directory": "."})
        self.assertTrue(any("more entries" in e for e in entries))


class PromptHintTests(unittest.TestCase):
    def test_tool_error_hint_limits_retries(self) -> None:
        from agents.base_agent import _TOOL_ERROR_HINT

        self.assertIn("retry once", _TOOL_ERROR_HINT)
        self.assertNotIn("do not stop", _TOOL_ERROR_HINT.lower())

    def test_memory_hint_present(self) -> None:
        from agents.base_agent import _MEMORY_HINT

        self.assertIn("Never call a tool twice", _MEMORY_HINT)

    def test_tool_limit_escape_hint_present(self) -> None:
        from agents.base_agent import _TOOL_LIMIT_HINT

        self.assertIn("Tool call limit exceeded", _TOOL_LIMIT_HINT)
        self.assertIn("stop calling tools immediately", _TOOL_LIMIT_HINT)

    def test_structured_output_hint_forbids_rewrites(self) -> None:
        from agents.base_agent import _STRUCTURED_OUTPUT_HINT

        self.assertIn("Do not re-read or re-verify files", _STRUCTURED_OUTPUT_HINT)


class FinalizeRetryTests(unittest.TestCase):
    def test_tool_budget_exhausted_finalizes_structured_output(self) -> None:
        from orchestrator.pipeline import _invoke_agent_sync

        calls: list[str] = []

        class Budgeted:
            def invoke(self, *args: object, **kwargs: object) -> object:
                calls.append(str(args))
                if len(calls) == 1:
                    raise ToolCallLimitExceededError(
                        thread_count=15,
                        run_count=15,
                        thread_limit=None,
                        run_limit=15,
                    )
                return {"structured_response": {"files_modified": ["a.py"]}}

        result = _invoke_agent_sync(Budgeted(), "do work")
        self.assertEqual(result, {"files_modified": ["a.py"]})
        self.assertEqual(len(calls), 2)
        self.assertIn("Do NOT call any tools", calls[1])

    def test_tool_budget_finalize_keeps_thread_id(self) -> None:
        """The finalize (no-tool) call runs on the same checkpoint thread."""
        from orchestrator.pipeline import _invoke_agent_sync

        configs: list[dict] = []

        class Budgeted:
            def invoke(self, *args: object, **kwargs: object) -> object:
                configs.append(dict(kwargs.get("config") or {}))
                if len(configs) == 1:
                    raise ToolCallLimitExceededError(
                        thread_count=15,
                        run_count=15,
                        thread_limit=None,
                        run_limit=15,
                    )
                return {"structured_response": {"ok": True}}

        _invoke_agent_sync(Budgeted(), "do work", thread_id="run4-frontend-0")
        self.assertEqual(len(configs), 2)
        self.assertEqual(configs[0]["thread_id"], "run4-frontend-0")
        self.assertEqual(configs[1]["thread_id"], "run4-frontend-0")

    def test_finalize_with_invalid_output_raises(self) -> None:
        from orchestrator.pipeline import _invoke_agent_sync

        class BadFinalize:
            def invoke(self, *args: object, **kwargs: object) -> object:
                return {"messages": [{"content": "just prose"}]}

        with self.assertRaises(ValueError):
            _invoke_agent_sync(BadFinalize(), "do work")


class ThreadIdTests(unittest.TestCase):
    def test_thread_id_passed_to_invoke_config(self) -> None:
        from orchestrator.pipeline import _invoke_agent_sync

        seen: list[dict] = []

        class Capture:
            def invoke(self, *args: object, **kwargs: object) -> object:
                seen.append(dict(kwargs.get("config") or {}))
                return {"structured_response": {"ok": True}}

        _invoke_agent_sync(Capture(), "task", thread_id="run4-frontend-0")
        self.assertEqual(seen[0]["thread_id"], "run4-frontend-0")

    def test_no_thread_id_omits_key(self) -> None:
        from orchestrator.pipeline import _invoke_agent_sync

        seen: list[dict] = []

        class Capture:
            def invoke(self, *args: object, **kwargs: object) -> object:
                seen.append(dict(kwargs.get("config") or {}))
                return {"structured_response": {"ok": True}}

        _invoke_agent_sync(Capture(), "task")
        self.assertNotIn("thread_id", seen[0])


class DevTaskPromptTests(unittest.TestCase):
    def _prompt(self, *, review=None, test=None) -> str:
        from orchestrator.pipeline import _build_dev_task_prompt

        return _build_dev_task_prompt(
            task={"title": "T", "description": "D", "target_files": ["a.js"]},
            pm={"acceptance_criteria": ["c1"]},
            architecture={"files_to_modify": ["a.js"]},
            review=review or {},
            test=test or {},
            owner="frontend",
        )

    def test_first_attempt_omits_feedback_placeholders(self) -> None:
        """No tester/reviewer output yet -> no feedback sections at all."""
        prompt = self._prompt(review={"approved": False}, test={"passed": False})
        self.assertNotIn("Prior tester feedback", prompt)
        self.assertNotIn("Prior review feedback", prompt)
        self.assertNotIn('"passed": false', prompt)
        self.assertNotIn('"approved": false', prompt)

    def test_real_feedback_included(self) -> None:
        """Actual tester/reviewer outputs (schema requires summary) are included."""
        prompt = self._prompt(
            review={"approved": False, "summary": "Navbar missing", "issues": ["x"]},
            test={"passed": False, "summary": "3 tests failing", "bugs": ["b1"]},
        )
        self.assertIn("Prior tester feedback", prompt)
        self.assertIn("3 tests failing", prompt)
        self.assertIn("Prior review feedback", prompt)
        self.assertIn("Navbar missing", prompt)

    def test_feedback_requires_summary(self) -> None:
        """Empty-ish dicts without summary never produce a feedback section."""
        prompt = self._prompt(test={"passed": True, "failing_tests": []})
        self.assertNotIn("Prior tester feedback", prompt)

    def test_continuity_nudge_present(self) -> None:
        prompt = self._prompt()
        self.assertIn("already completed earlier frontend tasks", prompt)


if __name__ == "__main__":
    unittest.main()
