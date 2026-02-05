import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Root } from './MarkdownViewer.styles';
import type { MarkdownViewerProps } from './MarkdownViewer.types';

export function MarkdownViewer({ content }: MarkdownViewerProps) {
  return (
    <Root>
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </Root>
  );
}
