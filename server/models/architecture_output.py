from typing import Optional
from pydantic import Field, BaseModel

class ArchitectureResponse(BaseModel):
    """Structured output from the Architecture Agent."""

    files_to_modify: list[str] = Field(
        ..., description="List of file paths to modify"
    )
    new_files: list[str] = Field(
        ..., description="List of file paths to create"
    )
    risks: Optional[list[str]] = Field(
        default=None, description="List of risks that are possible to happen during the development"
    )
    dependencies: Optional[list[str]] = Field(
        default=None, description="List of dependencies that are required to implement the feature"
    )
    architecture_decisions: str = Field(
        ..., description="Architecture decisions that are required to implement the feature"
    )