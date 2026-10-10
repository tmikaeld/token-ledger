import { z } from 'zod';

/** Calendar dates, rather than UTC instants, so every server uses the same window. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const CalendarDateSchema = z.string().refine(isCalendarDate, 'Use a valid date in YYYY-MM-DD format');
export const ReportingWindowSchema = z.object({
  subscriptionStartDate: CalendarDateSchema.nullable().default(null),
  subscriptionEndDate: CalendarDateSchema.nullable().default(null),
}).refine((value) => !value.subscriptionStartDate || !value.subscriptionEndDate
  || value.subscriptionStartDate <= value.subscriptionEndDate, {
  message: 'End date must be on or after start date', path: ['subscriptionEndDate'],
});

export const OverviewQuerySchema = z.object({
  startDate: CalendarDateSchema.nullable().default(null),
  endDate: CalendarDateSchema.nullable().default(null),
  granularity: z.enum(['day', 'month', 'year']).default('day'),
  // Omitted means all models; null explicitly selects unknown model usage.
  model: z.string().nullable().optional(),
  timeZone: z.string().max(100).default('UTC').refine((timeZone) => {
    try { new Intl.DateTimeFormat('en', { timeZone }); return true; } catch { return false; }
  }, 'Unknown time zone'),
}).refine((value) => !value.startDate || !value.endDate || value.startDate <= value.endDate, {
  message: 'End date must be on or after start date', path: ['endDate'],
});
export type OverviewQuery = z.infer<typeof OverviewQuerySchema>;
