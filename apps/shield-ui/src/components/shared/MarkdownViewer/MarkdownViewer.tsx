import { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Root } from './MarkdownViewer.styles';
import type { MarkdownViewerProps } from './MarkdownViewer.types';

/** Strip YAML frontmatter (---\n...\n---) from the start of markdown content. */
function stripFrontmatter(md: string): string {
  return md.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
}

export function MarkdownViewer({ content }: MarkdownViewerProps) {
  const cleaned = useMemo(() => stripFrontmatter(content), [content]);

  return (
    <Root>
      <Markdown remarkPlugins={[remarkGfm]}>{cleaned}</Markdown>
    </Root>
  );
}
