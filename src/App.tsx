/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { DashboardMetrics, IntegrationStatus } from '../shared/types';
import { IngestMeetingPanel } from './components/IngestMeetingPanel';
import { Layout, type NavCounts } from './components/Layout';
import { RunDemoModal } from './components/RunDemoModal';
import { api } from './lib/api';
import { ConflictsPage } from './pages/ConflictsPage';
import { DecisionsPage } from './pages/DecisionsPage';
import { DigestsPage } from './pages/DigestsPage';
import { MeetingDetailPage } from './pages/MeetingDetailPage';
import { MeetingsPage } from './pages/MeetingsPage';
import { OverviewPage } from './pages/OverviewPage';
import { RemindersPage } from './pages/RemindersPage';
import { ReviewPage } from './pages/ReviewPage';
import { SettingsPage } from './pages/SettingsPage';
import { TasksPage } from './pages/TasksPage';

function getPageMeta(pathname: string): { breadcrumb: string[]; title: string } {
  if (pathname === '/') return { breadcrumb: ['Nova', 'Overview'], title: 'Overview' };
  if (pathname === '/meetings') return { breadcrumb: ['Nova', 'Meetings'], title: 'Meetings' };
  if (pathname.startsWith('/meetings/')) {
    return { breadcrumb: ['Nova', 'Meetings', 'Detail'], title: 'Meeting Details' };
  }
  if (pathname === '/decisions') return { breadcrumb: ['Nova', 'Decisions'], title: 'Decisions' };
  if (pathname === '/conflicts') return { breadcrumb: ['Nova', 'Conflicts'], title: 'Conflicts' };
  if (pathname === '/review') {
    return { breadcrumb: ['Nova', 'Review & Post'], title: 'Review & Post' };
  }
  if (pathname === '/tasks') return { breadcrumb: ['Nova', 'Tasks'], title: 'Task Board' };
  if (pathname === '/reminders') return { breadcrumb: ['Nova', 'Reminders'], title: 'Reminders' };
  if (pathname === '/digests') return { breadcrumb: ['Nova', 'Digests'], title: 'Weekly Digests' };
  if (pathname === '/settings') return { breadcrumb: ['Nova', 'Settings'], title: 'Settings' };
  return { breadcrumb: ['Nova', 'Overview'], title: 'Overview' };
}

export default function App() {
  const [pathname, setPathname] = useState<string>(() => window.location.pathname || '/');
  const [refreshKey, setRefreshKey] = useState(0);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [ingestSampleKey, setIngestSampleKey] = useState<string | null>(null);
  const [demoModalOpen, setDemoModalOpen] = useState(false);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus | null>(null);

  const navigate = useCallback((nextPath: string) => {
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
    setPathname(nextPath);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname || '/');
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const triggerRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    api
      .getDashboard()
      .then((res) => setMetrics(res.metrics))
      .catch(() => {});
    api
      .getStatus()
      .then((res) => setIntegrationStatus(res.status))
      .catch(() => {});
  }, [refreshKey]);

  const handleOpenIngest = (sampleKey?: string) => {
    setIngestSampleKey(sampleKey || null);
    setIngestOpen(true);
  };

  const handleResetDemo = async () => {
    await api.resetDemo();
    triggerRefresh();
  };

  const counts: NavCounts = {
    conflicts: metrics?.unresolvedConflicts ?? 0,
    pendingReviews: metrics?.pendingApprovals ?? 0,
    overdue: metrics?.overdueTasks ?? 0,
  };

  const meta = getPageMeta(pathname);
  const meetingDetailMatch = pathname.match(/^\/meetings\/([^/]+)$/);

  let pageContent: React.ReactNode;
  if (meetingDetailMatch) {
    pageContent = (
      <MeetingDetailPage
        meetingId={decodeURIComponent(meetingDetailMatch[1])}
        refreshKey={refreshKey}
        navigate={navigate}
      />
    );
  } else if (pathname === '/meetings') {
    pageContent = (
      <MeetingsPage
        refreshKey={refreshKey}
        navigate={navigate}
        onOpenIngest={handleOpenIngest}
      />
    );
  } else if (pathname === '/decisions') {
    pageContent = <DecisionsPage refreshKey={refreshKey} navigate={navigate} />;
  } else if (pathname === '/conflicts') {
    pageContent = (
      <ConflictsPage
        refreshKey={refreshKey}
        navigate={navigate}
        onDataMutated={triggerRefresh}
      />
    );
  } else if (pathname === '/review') {
    pageContent = (
      <ReviewPage
        refreshKey={refreshKey}
        navigate={navigate}
        onDataMutated={triggerRefresh}
      />
    );
  } else if (pathname === '/tasks') {
    pageContent = (
      <TasksPage
        refreshKey={refreshKey}
        navigate={navigate}
        onDataMutated={triggerRefresh}
      />
    );
  } else if (pathname === '/reminders') {
    pageContent = <RemindersPage refreshKey={refreshKey} onDataMutated={triggerRefresh} />;
  } else if (pathname === '/digests') {
    pageContent = <DigestsPage refreshKey={refreshKey} />;
  } else if (pathname === '/settings') {
    pageContent = (
      <SettingsPage
        refreshKey={refreshKey}
        onStatusUpdated={setIntegrationStatus}
        onResetDemo={handleResetDemo}
      />
    );
  } else {
    pageContent = (
      <OverviewPage
        refreshKey={refreshKey}
        integrationStatus={integrationStatus}
        navigate={navigate}
        onOpenIngest={handleOpenIngest}
        onRunFullDemo={() => setDemoModalOpen(true)}
        onResetDemo={handleResetDemo}
      />
    );
  }

  return (
    <Layout
      currentPath={pathname}
      navigate={navigate}
      breadcrumb={meta.breadcrumb}
      pageTitle={meta.title}
      onNewMeeting={() => handleOpenIngest()}
      counts={counts}
      metrics={metrics}
      storageMode={integrationStatus?.supabase.storageMode}
    >
      {pageContent}

      <IngestMeetingPanel
        open={ingestOpen}
        initialSampleKey={ingestSampleKey}
        onClose={() => {
          setIngestOpen(false);
          setIngestSampleKey(null);
        }}
        onProcessed={(meetingId) => {
          setIngestOpen(false);
          setIngestSampleKey(null);
          triggerRefresh();
          navigate(`/meetings/${meetingId}`);
        }}
        onNavigateSettings={() => navigate('/settings')}
      />

      <RunDemoModal
        open={demoModalOpen}
        onClose={() => setDemoModalOpen(false)}
        onComplete={triggerRefresh}
        onNavigateSettings={() => navigate('/settings')}
        onNavigateConflicts={() => navigate('/conflicts')}
      />
    </Layout>
  );
}
