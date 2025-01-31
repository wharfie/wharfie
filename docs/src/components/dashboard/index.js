import React, { lazy, Suspense } from 'react';

const Dashboard = lazy(() => import('./dashboard'));

const DashboardWithSuspense = () => (
  <Suspense fallback={null}>
    <Dashboard />
  </Suspense>
);

export default DashboardWithSuspense;
