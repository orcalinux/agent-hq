import type { KanbanTaskCard } from '@/types';

export const STATUS_TONE: Record<KanbanTaskCard['status'], 'neutral' | 'accent' | 'success' | 'warning' | 'danger'> = {
  pending: 'neutral',
  in_progress: 'accent',
  review: 'warning',
  rejected: 'danger',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

export const PRIORITY_ORDER: Record<KanbanTaskCard['priority'], number> = { critical: 0, high: 1, medium: 2, low: 3 };
