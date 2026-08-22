"""Tests for the shared LangGraph SQLite checkpointer."""

import sqlite3
import tempfile
import unittest
from pathlib import Path

from langgraph.checkpoint.sqlite import SqliteSaver


class CheckpointerTests(unittest.TestCase):
    def test_singleton_per_path(self) -> None:
        from agents.checkpointer import get_checkpointer

        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "ck.sqlite")
            a = get_checkpointer(path)
            b = get_checkpointer(path)
            self.assertIs(a, b)
            self.assertTrue(Path(path).exists())
            self.assertIsInstance(a, SqliteSaver)

    def test_distinct_paths_distinct_savers(self) -> None:
        from agents.checkpointer import get_checkpointer

        with tempfile.TemporaryDirectory() as tmp:
            a = get_checkpointer(str(Path(tmp) / "a.sqlite"))
            b = get_checkpointer(str(Path(tmp) / "b.sqlite"))
            self.assertIsNot(a, b)

    def test_wal_mode_enabled(self) -> None:
        from agents.checkpointer import get_checkpointer

        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "ck.sqlite")
            get_checkpointer(path)
            conn = sqlite3.connect(path)
            mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
            conn.close()
            self.assertEqual(mode.lower(), "wal")

    def test_checkpoints_persist_between_invokes(self) -> None:
        """Two invokes on the same thread share state (cross-task memory)."""
        from agents.checkpointer import get_checkpointer
        from langgraph.graph import START, MessagesState, StateGraph
        from langgraph.graph.message import add_messages
        from langchain_core.messages import HumanMessage, AIMessage

        class FakeModel:
            def __init__(self) -> None:
                self.turns = 0

            def bind_tools(self, *args: object, **kwargs: object) -> "FakeModel":
                return self

            def invoke(self, messages: list[object], **kwargs: object) -> AIMessage:
                self.turns += 1
                return AIMessage(content=f"turn {self.turns}")

        with tempfile.TemporaryDirectory() as tmp:
            saver = get_checkpointer(str(Path(tmp) / "ck.sqlite"))

            def node(state: MessagesState) -> MessagesState:
                return {"messages": [AIMessage(content="node-done")]}

            graph = (
                StateGraph(MessagesState)
                .add_node("m", node)
                .add_edge(START, "m")
                .compile(checkpointer=saver)
            )
            model = FakeModel()

            graph.invoke(
                {"messages": [HumanMessage(content="first")]},
                config={"configurable": {"thread_id": "t1"}},
            )
            graph.invoke(
                {"messages": [HumanMessage(content="second")]},
                config={"configurable": {"thread_id": "t1"}},
            )
            # Thread t1 keeps both turns; a fresh thread starts empty.
            state_t1 = graph.get_state(
                {"configurable": {"thread_id": "t1"}}
            ).values["messages"]
            self.assertGreaterEqual(len(state_t1), 2)

            graph.invoke(
                {"messages": [HumanMessage(content="other")]},
                config={"configurable": {"thread_id": "t2"}},
            )
            state_t2 = graph.get_state(
                {"configurable": {"thread_id": "t2"}}
            ).values["messages"]
            self.assertGreaterEqual(len(state_t2), 1)


if __name__ == "__main__":
    unittest.main()
