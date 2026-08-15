from pathlib import Path

from tools.files.locks import exclusive_path


class FileSystem:
    def __init__(self, workspace: str):
        self.workspace = Path(workspace).resolve()

    def _resolve(self, file_path: str):
        path = (self.workspace / file_path).resolve()
        if path != self.workspace and self.workspace not in path.parents:
            raise PermissionError(
                "Cannot access files outside workspace."
            )

        return path

    def read(self, file_path: str) -> str:
        path = self._resolve(file_path)
        return path.read_text(encoding="utf-8")

    def write(self, file_path: str, content: str):
        path = self._resolve(file_path)
        with exclusive_path(path):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")

    def create(self, file_path: str, content: str = ""):
        path = self._resolve(file_path)
        with exclusive_path(path):
            if path.exists():
                raise FileExistsError(file_path)

            path.parent.mkdir(parents=True, exist_ok=True)

            path.write_text(content)

    def delete(self, file_path: str):
        path = self._resolve(file_path)
        with exclusive_path(path):
            path.unlink()

    def exists(self, file_path: str) -> bool:
        return self._resolve(file_path).exists()

    def list_directory(self, directory: str = "."):
        path = self._resolve(directory)

        return [
            str(p.relative_to(self.workspace))
            for p in path.rglob("*")
        ]

    def edit_lines(self, file_path: str, start_line: int, end_line: int, content: str):
        path = self._resolve(file_path)
        with exclusive_path(path):
            lines = path.read_text().splitlines()
            lines[start_line - 1 : end_line] = content.splitlines()
            path.write_text("\n".join(lines))
