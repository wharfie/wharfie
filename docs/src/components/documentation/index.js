import React, { lazy, Suspense } from 'react';

const Documentation = lazy(() => import('./documentation'));

const DocumentationWithSuspense = () => (
  <Suspense fallback={null}>
    <Documentation />
  </Suspense>
);

export default DocumentationWithSuspense;
