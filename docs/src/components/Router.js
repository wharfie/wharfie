import React, { useState, useEffect } from 'react';
import { parse as parseQueryString } from 'qs';

import journal from 'assets/documentation.json';

import Documentation from './documentation/';
import DocsEntry from './documentation/entry';
import NotFound from './404';

const ROUTES = journal.entries
  .filter((entry) => entry.published)
  .map((entry) => ({
    test: new RegExp(`^/${entry.slug}/$`),
    props: { entry },
    Component: DocsEntry,
  }))
  .concat([
    {
      test: new RegExp(`^/$`),
      Component: Documentation,
    },
  ]);

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
