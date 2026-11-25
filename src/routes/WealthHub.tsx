/** Wealth in one place: overview, the accounts behind it, and the month-by-month table, switched top right. */
import { useState } from 'react';
import { usePersisted } from '../app/persist';
import { Segmented } from '../design/components';
import { PageHeader } from '../ui/Sheet';
import Wealth from './Wealth';
import Accounts from './Accounts';
import NetWorth from './NetWorth';

type View = 'overview' | 'accounts' | 'months';
export default function WealthHub({ initial }: { initial?: View } = {}) {
  const [stored, setView] = usePersisted<View>('wealth.view', 'overview');
  const [first, setFirst] = useState(initial);
  const view = first ?? stored;
  return (
    <div className="fit">
      <PageHeader title="Wealth" sub={view === 'overview' ? 'What you own minus what you owe.' : view === 'accounts' ? 'Every account and fund, and where each balance comes from.' : 'Net worth at each month end.'}>
        <Segmented<View> label="View" value={view} onChange={(v) => { setFirst(undefined); setView(v); }} options={[{ value: 'overview', label: 'Overview' }, { value: 'accounts', label: 'Accounts' }, { value: 'months', label: 'Month table' }]} />
      </PageHeader>
      {view === 'overview' ? <Wealth embedded /> : view === 'accounts' ? <Accounts embedded /> : <NetWorth embedded />}
    </div>
  );
}
