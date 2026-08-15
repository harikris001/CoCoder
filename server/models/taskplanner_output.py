from typing import Optional

from pydantic import BaseModel, Field


class TaskItem(BaseModel):
    id: str = Field(..., description="Stable task id, e.g. t1")
    title: str = Field(..., description="Short task title")
    description: str = Field(..., description="What to implement")
    owner: str = Field(
        ...,
        description="Owning agent: backend | frontend | testing | docs",
    )
    target_files: list[str] = Field(
        default_factory=list,
        description=(
            "Repo-relative files this task may create or modify. "
            "Tasks that run in parallel MUST have disjoint target_files."
        ),
    )
    depends_on: list[str] = Field(default_factory=list, description="Task ids this depends on")


class TaskPlannerResponse(BaseModel):
    tasks: list[TaskItem] = Field(..., description="Ordered task list")
    notes: Optional[str] = Field(default=None, description="Cross-cutting notes")
