"""Reviewer agent structured output."""

from typing import Optional

from pydantic import BaseModel, Field


class ReviewResponse(BaseModel):
    approved: bool = Field(..., description="Whether the change is ready to open a PR")
    summary: str = Field(..., description="Short review summary")
    issues: list[str] = Field(default_factory=list, description="Blocking issues if not approved")
    suggestions: Optional[list[str]] = Field(default=None, description="Non-blocking suggestions")
