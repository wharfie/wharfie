import React, { lazy, Suspense } from 'react';

const Navbar = lazy(() => import('./navbar'));

const NavbarWithSuspense = (props) => (
  <Suspense fallback={null}>
    <Navbar {...props} />
  </Suspense>
);

export default NavbarWithSuspense;
