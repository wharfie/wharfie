import React, { useState, useEffect } from 'react';
import { parse as parseQueryString } from 'qs';

import documentation from 'assets/documentation.json';

import DocsEntry from './documentation/entry';
import NotFound from './404';

const ROUTES = documentation.entries
  .filter((entry) => entry.published)
  .map((entry) => [
    {
      test: new RegExp(`^${entry.slug}$`),
      props: { entry },
      Component: DocsEntry,
    },
    {
      test: new RegExp(`^${entry.slug}/$`),
      props: { entry },
      Component: DocsEntry,
    },
  ])
  .reduce((acc, val) => acc.concat(val), []);

const Router = ({ history }) => {
  const [location, setLocation] = useState(history.location);

  useEffect(() => {
    const unlisten = history.listen((newLocation) => {
      setLocation(newLocation);
    });
    return () => {
      unlisten();
    };
  }, [history]);

  const query = parseQueryString(location.search.substring(1));

  const Route = ROUTES.find(({ test }) => test.test(location.pathname)) || {
    Component: NotFound,
  };

  return (
    <Route.Component
      path={location.pathname}
      query={query}
      history={history}
      {...Route.props}
    />
  );
};

export default Router;
