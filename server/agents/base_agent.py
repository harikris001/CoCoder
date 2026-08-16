"""Base agent class for all CoCoder agents."""

from abc import ABC
from typing import Any

from langchain.agents import create_agent
from langchain.agents.middleware import (
    SummarizationMiddleware,
    ToolCallLimitMiddleware,
    ToolErrorMiddleware,
)
from langchain.agents.middleware.types import ToolCallRequest
from langchain.agents.structured_output import ToolStrategy
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.tools import BaseTool
from pydantic import BaseModel

from config import get_settings
from agents.checkpointer import get_checkpointer
from llm.factory import build_chat_model, build_summary_chat_model

# Appended to every agent prompt so cheaper models reliably emit schema JSON
# via the structured-output tool rather than free-form prose.
_STRUCTURED_OUTPUT_HINT = (
    "\n\n## Structured output (required)\n\n"
    "When you are done — and no later than the moment your changes are written — "
    "you MUST finish by calling the structured response tool with valid JSON "
    "arguments that match the required schema. "
    "Do not re-read or re-verify files after editing; trust the tool results you "
    "already received. "
    "Do not end with empty content or plain prose only — the final step is always "
    "that structured JSON tool call."
)

_TOOL_ERROR_HINT = (
    "\n\n## Tool errors\n\n"
    "If a tool returns an error (for example FileNotFoundError or a bad path), "
    "fix the arguments and retry once. If it fails again, stop retrying and "
    "finish with the structured response tool."
)

_MEMORY_HINT = (
    "\n\n## Conversation memory\n\n"
    "You have full visibility of every tool call and its result earlier in this "
    "conversation. Before calling a tool, check whether an earlier call already "
    "returned what you need, and reuse it. Never call a tool twice for the same "
    "file, query, or directory."
)

_TOOL_LIMIT_HINT = (
    "\n\n## Tool budget\n\n"
    "Your tool budget is limited. If you receive a 'Tool call limit exceeded' "
    "message, stop calling tools immediately and call the structured response "
    "tool with the results you already have."
)

_RECOVERABLE_TOOL_ERRORS = (
    FileNotFoundError,
    FileExistsError,
    IsADirectoryError,
    PermissionError,
    OSError,
    ValueError,
)


def _on_tool_error(exc: Exception, request: ToolCallRequest) -> str | None:
    """Return a ToolMessage for recoverable FS/arg errors; propagate the rest."""
    if not isinstance(exc, _RECOVERABLE_TOOL_ERRORS):
        return None
    tool_name = request.tool_call.get("name") or (
        request.tool.name if request.tool else "tool"
    )
    return (
        f"`{tool_name}` failed with {type(exc).__name__}: {exc}. "
        "Fix the arguments or find the correct path (list_files / search_repository), "
        "retry once, then finish. Do not loop."
    )


class BaseAgent(ABC):
    """Abstract base class that all CoCoder agents inherit from.

    Subclasses must define name, system_prompt, and
    response_format.  They may optionally override tools and
    get_llm() to customise behaviour.

    Structured output uses ``ToolStrategy`` so any tool-capable model
    (including low-cost OpenRouter models) returns JSON via a final tool
    call instead of fragile native JSON-mode content.
    """

    # abstract properties (children MUST set these)
    name: str
    system_prompt: str
    response_format: type[BaseModel]

    # virtual property (children CAN override)
    tools: list[BaseTool] = []

    def __init__(self, user_id: int | None = None, *, checkpointer: Any | None = None) -> None:
        self.user_id = user_id
        self._validate_class_attrs()
        system_prompt = self.system_prompt.rstrip() + _STRUCTURED_OUTPUT_HINT
        middleware = []
        if self.tools:
            settings = get_settings()
            system_prompt += _TOOL_ERROR_HINT
            system_prompt += _MEMORY_HINT
            system_prompt += _TOOL_LIMIT_HINT
            middleware.append(ToolErrorMiddleware(on_error=_on_tool_error))
            middleware.append(
                ToolCallLimitMiddleware(
                    run_limit=settings.agent_tool_call_limit,
                    exit_behavior="error",
                )
            )
            middleware.append(
                SummarizationMiddleware(
                    model=self.get_summary_llm(),
                    trigger=[
                        ("tokens", 50000),
                        ("fraction", 0.8),
                    ],
                    keep=("messages", 16),
                )
            )
        self.checkpointer = checkpointer if checkpointer is not None else get_checkpointer()
        self.agent = create_agent(
            name=self.name,
            model=self.get_llm(),
            system_prompt=system_prompt,
            tools=self.tools,
            middleware=middleware,
            response_format=ToolStrategy(
                self.response_format,
                handle_errors=True,
            ),
            checkpointer=self.checkpointer,
        )

    # overridable
    def get_llm(self) -> BaseChatModel:
        """Return the LLM instance to use.

        Defaults to the active BYOK provider (Settings), falling back to
        OpenRouter via ``OPENROUTER_API_KEY`` / ``LLM_MODEL`` in .env.
        """
        settings = get_settings()
        return build_chat_model(
            temperature=0.2,
            user_id=self.user_id,
            context_window=settings.agent_context_window_tokens,
        )

    def get_summary_llm(self) -> BaseChatModel:
        """Return the LLM used for conversation compaction (SummarizationMiddleware)."""
        settings = get_settings()
        return build_summary_chat_model(
            user_id=self.user_id,
            context_window=settings.agent_context_window_tokens,
        )

    # delegate methods to the underlying agent graph
    def invoke(self, *args: Any, **kwargs: Any) -> Any:
        """Run the agent synchronously."""
        return self.agent.invoke(*args, **kwargs)

    async def ainvoke(self, *args: Any, **kwargs: Any) -> Any:
        """Run the agent asynchronously."""
        return await self.agent.ainvoke(*args, **kwargs)

    def stream(self, *args: Any, **kwargs: Any) -> Any:
        """Stream the agent output synchronously."""
        return self.agent.stream(*args, **kwargs)

    def astream(self, *args: Any, **kwargs: Any) -> Any:
        """Stream the agent output asynchronously."""
        return self.agent.astream(*args, **kwargs)

    # internals
    def _validate_class_attrs(self) -> None:
        for attr in ("name", "system_prompt", "response_format"):
            if not getattr(self, attr, None):
                raise TypeError(
                    f"{type(self).__name__} must define a '{attr}' class attribute."
                )

    def __repr__(self) -> str:
        return f"<{type(self).__name__}(name={self.name!r})>"
