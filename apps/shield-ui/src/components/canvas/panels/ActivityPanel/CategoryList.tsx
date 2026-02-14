/**
 * "By Type" tab: events grouped into Filesystem / Network / Bash sections.
 */

import { useState, useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import { FolderLock, Globe, Terminal, ChevronDown, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { SSEEvent } from '../../../../state/events';
import { classifyEventCategory } from '../../utils/eventClassification';
import { getEventDisplay, resolveEventColor, getEventSummary, isNoiseEvent } from '../../../../utils/eventDisplay';
import type { CategorizedEvents } from './ActivityPanel.types';
import {
  CategoryHeader,
  CategoryTitle,
  CategoryCount,
  EventRow,
  EventIconWrap,
  EventContent,
  EventLabel,
  EventSummary,
  EventTime,
  EmptyState,
  FeedContainer,
} from './ActivityPanel.styles';

const CATEGORY_CONFIG = [
  { key: 'filesystem' as const, label: 'Filesystem', icon: FolderLock, color: '#6BAEF2' },
  { key: 'network' as const, label: 'Network', icon: Globe, color: '#6EC2C8' },
  { key: 'bash' as const, label: 'Bash Scripts', icon: Terminal, color: '#EEA45F' },
];

const MAX_PER_CATEGORY = 20;

interface CategoryListProps {
  events: SSEEvent[];
}

export function CategoryList({ events }: CategoryListProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(['filesystem', 'network', 'bash']),
  );

  const categorized = useMemo<CategorizedEvents>(() => {
    const result: CategorizedEvents = { filesystem: [], network: [], bash: [] };
    for (const event of events) {
      if (isNoiseEvent(event)) continue;
      const cat = classifyEventCategory(event);
      if (cat && result[cat].length < MAX_PER_CATEGORY) {
        result[cat].push(event);
      }
    }
    return result;
  }, [events]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalCategorized = categorized.filesystem.length + categorized.network.length + categorized.bash.length;

  if (totalCategorized === 0) {
    return <EmptyState>No categorized events yet</EmptyState>;
  }

  return (
    <FeedContainer>
      {CATEGORY_CONFIG.map(({ key, label, icon: IconComp, color }) => {
        const items = categorized[key];
        const isExpanded = expanded.has(key);

        return (
          <div key={key}>
            <CategoryHeader $expanded={isExpanded} onClick={() => toggle(key)}>
              <IconComp size={14} color={color} />
              <CategoryTitle>{label}</CategoryTitle>
              <CategoryCount>{items.length}</CategoryCount>
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </CategoryHeader>
            {isExpanded &&
              items.map((event) => {
                const display = getEventDisplay(event.type);
                const EvIcon = display.icon;
                const evColor = resolveEventColor(display.color, theme.palette);

                return (
                  <EventRow key={event.id}>
                    <EventIconWrap style={{ color: evColor }}>
                      <EvIcon size={13} />
                    </EventIconWrap>
                    <EventContent>
                      <EventLabel>{display.label}</EventLabel>
                      <EventSummary>{getEventSummary(event)}</EventSummary>
                    </EventContent>
                    <EventTime>
                      {formatDistanceToNow(event.timestamp, { addSuffix: true })}
                    </EventTime>
                  </EventRow>
                );
              })}
          </div>
        );
      })}
    </FeedContainer>
  );
}
