import React, { lazy, Suspense } from 'react';

const Search = lazy(() => import('./search'));

const SearchWithSuspense = (props) => (
  <Suspense fallback={null}>
    <Search {...props} />
  </Suspense>
);

export default SearchWithSuspense;
