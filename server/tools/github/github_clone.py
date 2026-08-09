from git import Repo
from langchain.tools import tool

@tool
def clone_github_repo(url: str, dir: str="./workspace"):
    """Clone a GitHub repository to a workspace(./workspace) folder."""
    try:
        repo = Repo.clone_from(url, dir)
        return f"Successfully cloned repository to {dir}"
    except Exception as e:
        return f"Error cloning repository: {str(e)}"


