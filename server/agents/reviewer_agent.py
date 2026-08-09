"""Reviewer Agent — gates PR creation."""

from agents.base_agent import BaseAgent
from models.review_output import ReviewResponse
from tools.agent_tools import READ_TOOLS


class ReviewerAgent(BaseAgent):
    name = "Reviewer Agent"

    system_prompt = (
        "# Reviewer Agent\n\n"
        "## Responsibility\n\n"
        "Review the proposed changes against acceptance criteria and architecture decisions.\n"
        "Approve only if the change is coherent, scoped, and likely correct.\n\n"
        "## Input\n\n"
        "- Acceptance criteria\n"
        "- Diff / files touched\n"
        "- Hybrid context snippets\n\n"
        "## Output\n\n"
        "- approved: true/false\n"
        "- summary\n"
        "- blocking issues (if any)\n\n"
        "## Never\n\n"
        "- Modify files yourself\n"
        "- Open pull requests\n"
    )

    response_format = ReviewResponse
    tools = READ_TOOLS
