import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

type Props = {
  children?: string | null;
  className?: string;
  emptyFallback?: string;
};

export function Markdown({
  children,
  className = "",
  emptyFallback = "No issue body provided.",
}: Props) {
  const text = children?.trim();
  if (!text) {
    return (
      <p className={`markdown-body markdown-body--empty ${className}`.trim()}>
        {emptyFallback}
      </p>
    );
  }

  return (
    <div className={`markdown-body ${className}`.trim()}>
      <ReactMarkdown components={components}>{text}</ReactMarkdown>
    </div>
  );
}
