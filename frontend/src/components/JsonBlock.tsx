export function JsonBlock({
  title,
  data,
}: {
  title: string;
  data: unknown;
}) {
  if (data == null) return null;
  return (
    <details className="json-block" open={false}>
      <summary>{title}</summary>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </details>
  );
}
