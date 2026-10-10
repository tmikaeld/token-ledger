import type { PluginTheme } from '@getpaseo/plugin';
import { useHosts, useSettings, type PluginSurfaceProps } from '@getpaseo/plugin/client';
import { ScrollView } from '@getpaseo/plugin/client/react-native';
import { SettingsCard, SettingsSelect, SettingsSection } from '@getpaseo/plugin/client/ui';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Summary } from '../shared/ledger.ts';
import { preferences } from '../shared/preferences.ts';
import { totalTokens } from '../shared/overview.ts';
import type { OverviewQuery } from '../shared/reporting.ts';
import { useOverview } from './data.ts';
import { useDenseLayout } from './layout.ts';
import { ReportingWindow } from './reporting-window.tsx';
import { labelOverviewSource } from './overview-sources.ts';
import { fmtCost, fmtTokens, SummaryRow, UsageCoverageNote } from './ui.tsx';

function UsageRow({ label, summary, peak, theme }: { label: string; summary: Summary; peak?: number; theme: PluginTheme }) {
  const cost = fmtCost(summary.effectiveCostUsd);
  return (
    <View style={{ paddingVertical: 10, gap: 7, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={{ flex: 1, color: theme.colors.foreground, fontSize: 13 }}>{label}</Text>
        <Text style={{ color: theme.colors.foreground, fontSize: 13, fontVariant: ['tabular-nums'] }}>{fmtTokens(totalTokens(summary))} tok</Text>
        <Text style={{ minWidth: 64, textAlign: 'right', color: theme.colors.foreground, fontSize: 13, fontVariant: ['tabular-nums'] }}>{cost ? `${summary.estimatedTurns ? '≈' : ''}${cost}` : '—'}</Text>
      </View>
      {peak !== undefined ? (
        <View accessibilityLabel={`${label}: ${totalTokens(summary).toLocaleString()} tokens`} style={{ height: 4, backgroundColor: theme.colors.surface1, borderRadius: 2 }}>
          <View style={{ height: 4, width: `${peak > 0 ? totalTokens(summary) / peak * 100 : 0}%`, backgroundColor: theme.colors.accent, borderRadius: 2 }} />
        </View>
      ) : null}
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
        {summary.turns} turn{summary.turns === 1 ? '' : 's'} · {fmtTokens(summary.input)} input · {fmtTokens(summary.cached)} cache{summary.cacheWrite != null ? ` · ${fmtTokens(summary.cacheWrite)} cache write` : ''} · {fmtTokens(summary.output)} output{summary.unpricedTurns ? ` · ${summary.unpricedTurns} unpriced` : ''}
      </Text>
    </View>
  );
}

function periodLabel(period: string): string {
  if (period.length === 4) return period;
  const date = new Date(`${period.length === 7 ? `${period}-01` : period}T12:00:00Z`);
  return date.toLocaleDateString(undefined, { timeZone: 'UTC', year: 'numeric', month: 'short', ...(period.length === 10 ? { day: 'numeric' } : {}) });
}

export function TokenLedgerOverview({ theme, layout, host }: PluginSurfaceProps) {
  const settings = useSettings(preferences);
  const hosts = useHosts();
  const { dense, setWidth } = useDenseLayout(layout.compact);
  const [granularity, setGranularity] = useState<OverviewQuery['granularity']>('day');
  const [modelValue, setModelValue] = useState('all');
  const [visiblePeriods, setVisiblePeriods] = useState(24);
  const [editingDates, setEditingDates] = useState(false);
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const startDate = settings.status === 'ready' ? settings.values.subscriptionStartDate : null;
  const endDate = settings.status === 'ready' ? settings.values.subscriptionEndDate : null;
  const input = useMemo<OverviewQuery>(() => ({ startDate, endDate, granularity, timeZone,
    ...(modelValue === 'all' ? {} : { model: JSON.parse(modelValue) as string | null }),
  }), [startDate, endDate, granularity, timeZone, modelValue]);
  const { data, error, isFetching, refetch } = useOverview(input, settings.status === 'ready');
  useEffect(() => { labelOverviewSource(host.label); }, [host.label]);
  useEffect(() => { setVisiblePeriods(24); }, [input]);

  const models = data?.availableModels ?? [];
  const options = [{ label: 'All models', value: 'all' }, ...models.map((model) => ({ label: model ?? 'Unknown model', value: JSON.stringify(model) }))];
  if (!options.some((option) => option.value === modelValue)) options.push({ label: JSON.parse(modelValue) ?? 'Unknown model', value: modelValue });
  const unavailable = hosts.filter((server) => server.status !== 'online');
  const peak = Math.max(0, ...(data?.periods.map((row) => totalTokens(row.summary)) ?? []));
  const sectionLabel = { color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const };
  const muted = { color: theme.colors.foregroundMuted, fontSize: 12 };
  const button = { paddingVertical: 8, paddingHorizontal: 12, backgroundColor: theme.colors.surface1, borderRadius: 6 };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ padding: dense ? 12 : 20, gap: 20 }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <Text style={{ flex: 1, color: theme.colors.foreground, fontSize: 18, fontWeight: '600' }}>TokenLedger Overview</Text>
          {settings.status === 'ready' ? <Pressable accessibilityRole="button" style={button} onPress={() => setEditingDates((open) => !open)}><Text style={{ color: theme.colors.foreground, fontSize: 12 }}>{editingDates ? 'Close dates' : 'Subscription dates'}</Text></Pressable> : null}
        </View>
        <Text style={muted}>Token usage across your connected Paseo servers.</Text>
      </View>
      {settings.status === 'ready' && data ? (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ ...sectionLabel, flex: 1 }}>Selected usage · {data.servers.length} server{data.servers.length === 1 ? '' : 's'}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Refresh usage" disabled={isFetching} style={button} onPress={() => { void refetch(); }}><Text style={{ color: theme.colors.foreground, fontSize: 12 }}>{isFetching ? 'Updating…' : 'Refresh'}</Text></Pressable>
            </View>
            <Text style={muted}>{startDate ?? 'First recorded usage'} → {endDate ?? 'Now'} · {timeZone}</Text>
            <SummaryRow summary={data.totals} theme={theme} dense={dense} />
            <UsageCoverageNote theme={theme} />
            {data.activeTurns ? <Text style={muted}>{data.activeTurns} turn{data.activeTurns === 1 ? '' : 's'} in progress. Totals include finished turns.</Text> : null}
            {data.partialTurns || data.gapTurns ? <Text style={muted}>{data.partialTurns} turn{data.partialTurns === 1 ? '' : 's'} with incomplete usage{data.gapTurns ? ` · ${data.gapTurns} with a tracking gap` : ''}.</Text> : null}
          </View>
      ) : null}
      {settings.status === 'ready' ? editingDates ? (
        <ReportingWindow values={settings.values} saving={settings.saving} onSave={(patch) => { if (!settings.saving) void settings.save({ ...settings.values, ...patch }, settings.revision).then((saved) => { if (saved) setEditingDates(false); }); }} />
      ) : null : (
        <View style={{ gap: 8 }}>
          <Text style={muted}>{settings.status === 'loading' ? 'Loading subscription settings…' : settings.error}</Text>
          {settings.status !== 'loading' ? <Pressable accessibilityRole="button" style={button} onPress={() => { void settings.reload(); }}><Text style={{ color: theme.colors.foreground }}>Retry settings</Text></Pressable> : null}
        </View>
      )}
      {settings.saveError ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>{settings.saveError}</Text> : null}
      <SettingsSection title="Usage filters">
        <SettingsCard>
          <SettingsSelect label="Group by" value={granularity} options={[{ label: 'Daily usage', value: 'day' }, { label: 'Monthly usage', value: 'month' }, { label: 'Yearly usage', value: 'year' }]} onValueChange={(value) => setGranularity(value as OverviewQuery['granularity'])} />
          <SettingsSelect label="Model" value={modelValue} options={options} onValueChange={setModelValue} />
        </SettingsCard>
      </SettingsSection>
      {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>{String(error)}</Text> : null}
      {settings.status === 'ready' && data ? (
        <>
          {data.failures.length ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger, fontSize: 12 }}>Totals exclude unavailable servers: {data.failures.map((failure) => `${failure.label} (${failure.error})`).join('; ')}</Text> : null}
          {unavailable.length ? <Text style={muted}>Disconnected Paseo servers: {unavailable.map((server) => server.label).join(', ')}. Their usage is excluded.</Text> : null}
          <View style={{ gap: 4 }}>
            <Text style={sectionLabel}>Usage by {granularity}</Text>
            {data.periods.length ? data.periods.slice(-visiblePeriods).reverse().map((row) => <UsageRow key={row.period} label={periodLabel(row.period)} summary={row.summary} peak={peak} theme={theme} />) : <Text style={muted}>{data.servers.length ? 'No usage matches these dates and model.' : 'No TokenLedger servers are available. Enable this plugin version on your connected servers.'}</Text>}
            {data.periods.length > visiblePeriods ? <Pressable accessibilityRole="button" style={button} onPress={() => setVisiblePeriods((count) => count + 24)}><Text style={{ color: theme.colors.foreground }}>Show earlier periods ({data.periods.length - visiblePeriods} remaining)</Text></Pressable> : null}
          </View>
          {data.models.length ? <View style={{ gap: 4 }}><Text style={sectionLabel}>Usage by model</Text>{data.models.map((row) => <UsageRow key={JSON.stringify(row.model)} label={row.model ?? 'Unknown model'} summary={row.summary} theme={theme} />)}</View> : null}
          <View style={{ gap: 4 }}>
            <Text style={sectionLabel}>Included servers</Text>
            {data.servers.map((server) => <View key={server.server.id} style={{ gap: 3, paddingVertical: 8 }}>
              <UsageRow label={server.server.label} summary={server.totals} theme={theme} />
              <Text style={muted}>Recorded history: {server.firstRecordedAt?.slice(0, 10) ?? 'none'} → {server.lastRecordedAt?.slice(0, 10) ?? 'none'}</Text>
            </View>)}
            <Text style={muted}>Servers need this plugin version loaded to contribute. Previously trimmed history cannot be recovered.</Text>
          </View>
        </>
      ) : settings.status === 'ready' && !error ? <Text style={muted}>Loading server usage…</Text> : null}
    </ScrollView>
  );
}
