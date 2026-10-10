import { useEffect, useState } from 'react';
import { SettingsAction, SettingsCard, SettingsInput, SettingsSection } from '@getpaseo/plugin/client/ui';
import type { Preferences } from '../shared/preferences.ts';
import { ReportingWindowSchema } from '../shared/reporting.ts';

export function ReportingWindow({ values, saving, onSave }: {
  values: Preferences;
  saving: boolean;
  onSave(patch: Pick<Preferences, 'subscriptionStartDate' | 'subscriptionEndDate'>): void;
}) {
  const [start, setStart] = useState(values.subscriptionStartDate ?? '');
  const [end, setEnd] = useState(values.subscriptionEndDate ?? '');
  useEffect(() => { setStart(values.subscriptionStartDate ?? ''); setEnd(values.subscriptionEndDate ?? ''); },
    [values.subscriptionStartDate, values.subscriptionEndDate]);
  const parsed = ReportingWindowSchema.safeParse({
    subscriptionStartDate: start.trim() || null, subscriptionEndDate: end.trim() || null,
  });
  const changed = parsed.success && (parsed.data.subscriptionStartDate !== values.subscriptionStartDate
    || parsed.data.subscriptionEndDate !== values.subscriptionEndDate);
  return (
    <SettingsSection title="Subscription window">
      <SettingsCard>
        <SettingsInput key={`start:${values.subscriptionStartDate}`} label="Start date" hint="Inclusive · leave blank for all recorded history." initialValue={values.subscriptionStartDate ?? ''} placeholder="YYYY-MM-DD" disabled={saving} onChangeText={setStart} />
        <SettingsInput key={`end:${values.subscriptionEndDate}`} label="End date" hint="Inclusive · leave blank to include ongoing usage." initialValue={values.subscriptionEndDate ?? ''} placeholder="YYYY-MM-DD" disabled={saving} onChangeText={setEnd} />
        <SettingsAction label="Apply to all servers" hint="One reporting window across every included server." actionLabel={saving ? 'Saving…' : 'Apply dates'} error={parsed.success ? null : parsed.error.issues[0]?.message} disabled={saving || !changed} onPress={() => { if (parsed.success) onSave(parsed.data); }} />
      </SettingsCard>
    </SettingsSection>
  );
}
