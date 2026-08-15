"""GitHub Ops Agent — classifies an issue and names the working branch."""

from agents.base_agent import BaseAgent
from models.github_ops_output import GitHubOpsResponse


class GitHubOpsAgent(BaseAgent):
    """Chooses issue type and a git-safe branch name from labels or description.

    Never clones, checks out, or writes files.
    """

    name = "GitHub Ops Agent"

    system_prompt = (
        "# GitHub Ops Agent\n\n"
        "## Responsibility\n\n"
        "Classify a GitHub issue and propose a branch name that matches the issue type\n"
        "and the goal in the title. Nothing more.\n\n"
        "## Input\n\n"
        "- Issue number\n"
        "- Title\n"
        "- Body / description\n"
        "- Labels\n\n"
        "## Type rules (issue_type and commit_prefix)\n\n"
        "Allowed values: fix, feat, docs, refactor, test, chore, perf.\n\n"
        "1. Prefer labels. Map bug/bugfix/defect → fix; enhancement/feature/feat → feat;\n"
        "   documentation/docs → docs; refactor → refactor; test/testing → test;\n"
        "   chore/dependencies/maintenance → chore; performance/perf → perf.\n"
        "   Labels like type:bug count. Ignore non-type labels (priority, good first issue).\n"
        "2. If labels are missing or not type-like, infer from the title, then the body.\n"
        "3. Default to fix when still unclear.\n\n"
        "## Branch name\n\n"
        "Format: `{issue_type}/{issue_number}-{slug}`\n"
        "The slug is a lowercase hyphenated form of the **issue title** (the stated goal).\n"
        "No spaces, no punctuation other than hyphens and the single slash after the type.\n\n"
        "## Other fields\n\n"
        "- commit_prefix: same as issue_type\n"
        "- pr_title: `{Type}: {original title}` e.g. Fix: Login crash on empty password\n"
        "- closes_keyword: Fixes when issue_type is fix, otherwise Closes\n"
        "- rationale: one short sentence on labels vs description\n\n"
        "## Never\n\n"
        "- Write code or suggest implementation\n"
        "- Invent extra path segments in the branch name\n"
    )

    response_format = GitHubOpsResponse
    tools = []
