from typing import Literal

from pydantic import BaseModel, Field

IssueType = Literal["fix", "feat", "docs", "refactor", "test", "chore", "perf"]


class GitHubOpsResponse(BaseModel):
    """Structured output from the GitHub Ops Agent."""

    issue_type: IssueType = Field(
        ...,
        description="Issue category used as the branch prefix and conventional-commit type.",
    )
    branch_name: str = Field(
        ...,
        description="Git branch name as {issue_type}/{number}-{slug-from-title}.",
    )
    commit_prefix: IssueType = Field(
        ...,
        description="Conventional-commit prefix; must match issue_type.",
    )
    pr_title: str = Field(
        ...,
        description="Pull request title, e.g. 'Fix: Login crash on empty password'.",
    )
    closes_keyword: Literal["Fixes", "Closes"] = Field(
        ...,
        description="GitHub keyword to close the issue. Use Fixes for bugs, Closes otherwise.",
    )
    rationale: str = Field(
        ...,
        description="Short explanation of how type was chosen (labels vs description).",
    )
