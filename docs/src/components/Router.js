import React, { useState, useEffect } from 'react';
import { parse as parseQueryString } from 'qs';

import journal from 'assets/journal.json';

import Dashboard from './dashboard/';
import Journal from './journal/';
import JournalEntry from './journal/entry/';
import NotFound from './404';

const ROUTES = journal.entries
  .filter((entry) => entry.published)
  .map((entry) => ({
    test: new RegExp(`^/journal/${entry.slug}/$`),
    props: { entry },
    Component: JournalEntry,
  }))
  .concat([
    {
      test: new RegExp(`^/journal/$`),
      Component: Journal,
    },
    {
      test: new RegExp(`^/$`),
      Component: Dashboard,
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

  useEffect(() => {
    const staticFiles = ['rss.xml']; // Add more if needed
    const isStaticFile = staticFiles.some((ext) =>
      location.pathname.endsWith(ext)
    );

    if (isStaticFile) {
      // Perform a full-page redirect to the static asset
      window.location.href = location.pathname;
    }
  }, [location.pathname]);

  const query = parseQueryString(location.search.substring(1));

  const Route = ROUTES.find(({ test }) => test.test(location.pathname)) || {
    Component: NotFound,
  };

  // Don't render anything if we're redirecting to a static file
  const isStaticFile = ['rss.xml'].some((ext) =>
    location.pathname.endsWith(ext)
  );
  if (isStaticFile) {
    return null; // Prevent rendering during the redirect
  }

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
