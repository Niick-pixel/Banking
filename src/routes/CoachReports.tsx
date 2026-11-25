/** Reports → Report card (month-end + weekly check-in) and Reports → History replay, from the Coach. */
import { useCoach } from '../app/coach';
import { PageHeader } from '../ui/Sheet';
import { HistoryPage, ReportsPage } from './Coach';

export function CoachReportCard() {
  const { run } = useCoach();
  return (<><PageHeader title="Report card" sub="Your month-end report card and this week's check-in." />{run ? <ReportsPage /> : <p className="muted">The Coach is off (Settings → Coach).</p>}</>);
}

export function CoachHistory() {
  const { run } = useCoach();
  return (<><PageHeader title="History replay" sub="Which alerts would have fired each month." />{run ? <HistoryPage /> : <p className="muted">The Coach is off (Settings → Coach).</p>}</>);
}
