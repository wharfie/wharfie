import React, { lazy, Suspense } from 'react';

const Footer = lazy(() => import('./footer'));

const FooterWithSuspense = (props) => (
  <Suspense fallback={null}>
    <Footer {...props} />
  </Suspense>
);

export default FooterWithSuspense;
