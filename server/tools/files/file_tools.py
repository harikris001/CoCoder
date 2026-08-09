from langchain.tools import tool
from .filesystem import FileSystem

fs = FileSystem('./workspace')

@tool
def read_file(file_path: str):
    ''' Read a file.
    Use this when you want to inspect a file.'''
    return fs.read(file_path)


@tool
def write_file(file_path: str, content: str):
    """Write content to a file.
    Use this only when you want to create or overwrite a file."
    """
    return fs.write(file_path, content)

@tool
def create_file(file_path:str, content:str):
    """Creates a file.
    Use this when you want to create a file.
    """
    fs.create(file_path, content)
    return "Successfully file created."

@tool
def list_files(directory: str = ".") -> list[str]:
    """
    List all files under a directory.
    """
    return fs.list_directory(directory)    

@tool
def edit_file(file_path:str, content:str, start_line: int, end_line: int):
    ''' Edit a file.
    Use this when you want to edit a file. Must specify the start line, end line indices along with the content that you want to write in content with proper splitline "\n". '''
    fs.edit_lines(file_path, start_line, end_line, content)
    return "Successfully file edited."