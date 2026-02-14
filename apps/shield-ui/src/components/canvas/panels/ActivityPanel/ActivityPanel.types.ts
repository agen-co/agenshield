import type { SSEEvent } from '../../../../state/events';
import type { EventCategory } from '../../utils/eventClassification';

export interface CategorizedEvents {
  filesystem: SSEEvent[];
  network: SSEEvent[];
  bash: SSEEvent[];
}

export interface CategorySectionProps {
  category: EventCategory;
  label: string;
  events: SSEEvent[];
}
