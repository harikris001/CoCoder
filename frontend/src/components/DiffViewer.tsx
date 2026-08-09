export function DiffViewer({ diff, files }: { diff: string; files: string[] }) {
  return (
    <div className="diff-panel">
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((f) => (
            <li key={f}>
              <code>{f}</code>
            </li>
          ))}
        </ul>
      )}
      <pre className="diff">
        {diff
          ? diff.split("\n").map((line, i) => {
              let cls = "";
              if (line.startsWith("+") && !line.startsWith("+++")) cls = "add";
              else if (line.startsWith("-") && !line.startsWith("---"))
                cls = "del";
              else if (line.startsWith("@@")) cls = "hunk";
              return (
                <span key={i} className={cls}>
                  {line}
                  {"\n"}
                </span>
              );
            })
          : "No diff available."}
      </pre>
    </div>
  );
}
