import { defineSettings } from '@getpaseo/plugin';
import { z } from 'zod';
import { ReportingWindowSchema } from './reporting.ts';

export const preferences = defineSettings({
  id: 'preferences', scope: 'host', version: 1,
  schema: z.object({
    timelineSummaries: z.boolean().default(true),
    openRouterPricing: z.boolean().default(true),
    builtinPricing: z.boolean().default(true),
    refreshInterval: z.enum(['normal', 'relaxed']).default('normal'),
    ...ReportingWindowSchema.shape,
  }).refine((value) => !value.subscriptionStartDate || !value.subscriptionEndDate
    || value.subscriptionStartDate <= value.subscriptionEndDate, {
    message: 'End date must be on or after start date', path: ['subscriptionEndDate'],
  }),
});
export type Preferences = z.infer<typeof preferences.schema>;
export const DEFAULT_PREFERENCES = preferences.schema.parse({});
export function refreshIntervalMs(value: Preferences['refreshInterval'], active: boolean): number {
  return value === 'relaxed' ? (active ? 10000 : 60000) : (active ? 3000 : 30000);
}
