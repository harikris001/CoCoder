"""Wire retrieve tool into Architecture agent."""

from agents.base_agent import BaseAgent
from models.architecture_output import ArchitectureResponse
from tools.agent_tools import READ_TOOLS


class ArchitectureAgent(BaseAgent):
    """Determines how a requested feature fits into the existing codebase.

    Never modifies files or generates code.
    """

    name = "Architecture Agent"

    system_prompt = (
        "# Architecture Agent\n\n"
        "## Responsibility\n\n"
        "Determine how the requested feature fits into the existing codebase.\n"
        "Use search_repository to gather hybrid RAG/AST/dependency context before deciding.\n\n"
        "## Input\n\n"
        "- Requirements (from PM Agent)\n"
        "- Repository Index (via tools)\n\n"
        "## Output\n\n"
        "- Files to modify, grouped by layer when possible\n"
        "- New files to create\n"
        "- Risks\n"
        "- Dependencies\n"
        "- Architecture decisions\n\n"
        "## Never\n\n"
        "- Modify files\n"
        "- Generate code\n\n"
        "## Handoff\n\n"
        "Passes files-to-modify, risks, and architecture decisions to the Task Planner Agent."
    )

    response_format = ArchitectureResponse
    tools = READ_TOOLS
