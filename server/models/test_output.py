"""Tester agent structured output."""

from typing import Optional

from pydantic import BaseModel, Field


class TestResponse(BaseModel):
    passed: bool = Field(..., description="Whether existing tests and expected behavior look good")
    summary: str = Field(..., description="Short test / verification summary")
    command: Optional[list[str]] = Field(
        default=None, description="Allowlisted command that was run, if any"
    )
    exit_code: Optional[int] = Field(default=None, description="Test process exit code")
    failing_tests: list[str] = Field(
        default_factory=list, description="Names or descriptions of failing tests"
    )
    bugs: list[str] = Field(
        default_factory=list,
        description="Actionable bugs for developers when passed is false",
    )
    notes: Optional[str] = Field(
        default=None,
        description="Extra notes, including no_tests_found when no runner was detected",
    )
    files_created: list[str] = Field(
        default_factory=list,
        description="Temporary test files created during this run (must be deleted before finish)",
    )
