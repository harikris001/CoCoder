from typing import Optional
from pydantic import BaseModel, Field


class PMResponse(BaseModel):
    """Structured output from the Product Manager Agent."""

    goal: str = Field(
        ...,
        description="A clear, concise statement of the project goal derived from the GitHub issue.",
    )
    requirements: list[str] = Field(
        ...,
        description="List of functional and non-functional requirements needed to achieve the goal.",
    )
    acceptance_criteria: list[str] = Field(
        ...,
        description="List of measurable criteria that must be met for the work to be considered complete.",
    )
    constraints: list[str] = Field(
        default_factory=list,
        description="Any constraints or limitations that must be respected (e.g., backward compatibility, performance budgets).",
    )
    open_questions: Optional[list[str]] = Field(
        default=None,
        description="Questions flagged when the issue is ambiguous, for a human or the Architecture Agent to resolve.",
    )