import { Fragment, memo, type ReactNode } from 'react';

const FENCE = /\u0060{3}/;

function inline(text: string): ReactNode[] {
  const parts = text.split(/(\u0060[^\u0060]+\u0060|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('\u0060') && part.endsWith('\u0060') && part.length > 1) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** Small, safe markdown renderer for chat: fenced code, headings, lists, inline code and bold. No raw HTML. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const segments = text.split(FENCE);
  segments.forEach((segment, i) => {
    if (i % 2 === 1) {
      const newline = segment.indexOf('\n');
      const info = newline >= 0 ? segment.slice(0, newline).trim() : '';
      const code = newline >= 0 ? segment.slice(newline + 1) : segment;
      blocks.push(
        <pre key={`c${i}`} title={info || undefined}>
          <code>{code.replace(/\n$/, '')}</code>
        </pre>
      );
      return;
    }
    const paragraphs = segment.split(/\n{2,}/);
    paragraphs.forEach((para, j) => {
      const lines = para.split('\n').filter((l) => l.trim() !== '');
      if (lines.length === 0) return;
      const key = `p${i}-${j}`;
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
        blocks.push(<ul key={key}>{lines.map((l, k) => <li key={k}>{inline(l.replace(/^\s*[-*]\s+/, ''))}</li>)}</ul>);
      } else if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
        blocks.push(<ol key={key}>{lines.map((l, k) => <li key={k}>{inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>)}</ol>);
      } else if (/^#{1,3}\s/.test(lines[0])) {
        blocks.push(<h3 key={key}>{inline(lines[0].replace(/^#{1,3}\s+/, ''))}</h3>);
        if (lines.length > 1) blocks.push(<p key={`${key}b`}>{inline(lines.slice(1).join(' '))}</p>);
      } else {
        blocks.push(<p key={key}>{inline(lines.join('\n'))}</p>);
      }
    });
  });
  return <div className="prose-chat break-words">{blocks}</div>;
});
