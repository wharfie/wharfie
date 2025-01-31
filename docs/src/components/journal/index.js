import React, { lazy, Suspense } from 'react';

const Journal = lazy(() => import('./journal'));

const JournalWithSuspense = () => (
  <Suspense fallback={null}>
    <Journal />
  </Suspense>
);

export default JournalWithSuspense;
