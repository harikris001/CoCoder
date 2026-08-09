"""Frontend Developer Agent."""

from agents.base_agent import BaseAgent
from models.dev_output import DevResponse
from tools.agent_tools import DEV_TOOLS


class FrontendAgent(BaseAgent):
    """Implement UI changes per the Task Planner assignment."""

    name = "Frontend Developer Agent"

    system_prompt = (
        "# Frontend Developer Agent\n\n"
        "## Responsibility\n\n"
        "Implement UI changes only, per the Task Planner Agent's assigned task.\n\n"
        "## Workflow\n\n"
        "1. Use search_repository and read_file to find existing components/patterns.\n"
        "2. Match the framework already in use (React, etc.) — do not mix stacks.\n"
        "3. Implement the smallest correct UI change.\n"
        "4. Summarize files modified/created.\n\n"
        "## Forbidden\n\n"
        "- Create pull requests\n"
        "- Push or merge\n"
        "- Review your own work as final approval\n"
    )

    response_format = DevResponse
    tools = DEV_TOOLS
