"""Developer agent structured output."""

from typing import Optional

from pydantic import BaseModel, Field


class DevResponse(BaseModel):
    summary: str = Field(..., description="What was changed")
    files_modified: list[str] = Field(default_factory=list)
    files_created: list[str] = Field(default_factory=list)
    notes: Optional[str] = Field(default=None)
