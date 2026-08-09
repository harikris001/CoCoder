"""Base agent class for all CoCoder agents."""

from abc import ABC
from typing import Any

from langchain.agents import create_agent
from langchain.agents.structured_output import ToolStrategy
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.tools import BaseTool
from pydantic import BaseModel

from llm.factory import build_chat_model

# Appended to every agent prompt so cheaper models reliably emit schema JSON
# via the structured-output tool rather than free-form prose.
_STRUCTURED_OUTPUT_HINT = (
    "\n\n## Structured output (required)\n\n"
    "When you are done, you MUST finish by calling the structured response tool "
    "with valid JSON arguments that match the required schema. "
    "Do not end with empty content or plain prose only — the final step is always "
    "that structured JSON tool call."
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

    def __init__(self) -> None:
        self._validate_class_attrs()
        self.agent = create_agent(
            name=self.name,
            model=self.get_llm(),
            system_prompt=self.system_prompt.rstrip() + _STRUCTURED_OUTPUT_HINT,
            tools=self.tools,
            response_format=ToolStrategy(
                self.response_format,
                handle_errors=True,
            ),
        )

    # overridable
    def get_llm(self) -> BaseChatModel:
        """Return the LLM instance to use.

        Defaults to the active BYOK provider (Settings), falling back to
        OpenRouter via ``OPENROUTER_API_KEY`` / ``LLM_MODEL`` in .env.
        """
        return build_chat_model(temperature=0.2)

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
