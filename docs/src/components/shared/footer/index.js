import React, { lazy, Suspense } from 'react';

const Footer = lazy(() => import('./footer'));

const FooterWithSuspense = () => (
  <Suspense fallback={null}>
    <Footer />
  </Suspense>
);

export default FooterWithSuspense;
