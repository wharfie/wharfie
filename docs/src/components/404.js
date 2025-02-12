import React from 'react';
import { css } from 'glamor';
import { Helmet } from 'react-helmet';

const containerStyle = css({
  width: '100%',
});

const headerStyle = css({
  height: '50vh',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-end',
  backgroundColor: '#dedede',
  paddingBottom: '3em',
});

const contentStyle = css({
  height: '50%',
  paddingTop: '3em',
  width: '100%',
  display: 'inline-block',
  backgroundColor: '#fefefe',
});

function NotFound() {
  return (
    <div {...containerStyle}>
      <Helmet>
        <title>404 - Page Not Found</title>
      </Helmet>
      <header {...headerStyle}>
        <h1>404</h1>
        <h3>
          <a href="/">back to home</a>
        </h3>
      </header>
      <div {...contentStyle} />
    </div>
  );
}

export default NotFound;
