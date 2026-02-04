import Markdown from 'react-markdown';
import { Root } from './MarkdownViewer.styles';
import type { MarkdownViewerProps } from './MarkdownViewer.types';

export function MarkdownViewer({ content }: MarkdownViewerProps) {
  return (
    <Root>
      <Markdown>{content}</Markdown>
    </Root>
  );
}
