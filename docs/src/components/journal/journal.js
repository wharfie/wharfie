import React from 'react';
import { css } from 'glamor';
import journal from 'assets/journal.json';
import Footer from 'components/shared/footer/';
import Preview from './preview';
import { Helmet } from 'react-helmet';

const containerStyle = css({
  width: '100%',
});

const headerStyle = css({
  height: '33vh',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-end',
  backgroundColor: '#dedede',
});

const contentStyle = css({
  minHeight: '66%',
  paddingTop: '3em',
  display: 'flex',
  width: '80%',
  maxWidth: 710,
  textAlign: 'left',
  marginRight: 'auto',
  marginLeft: 'auto',
  flexDirection: 'column',
  justifyContent: 'space-between',
});

function Journal({ event }) {
  return (
    <div {...containerStyle}>
      <Helmet>
        <title>Journal - Wharfie</title>
        <meta
          name="description"
          content="Writing about: Software, Graphics, Tech and some other random business"
        />
        <link rel="canonical" href="https://wharfie.dev/journal/" />
      </Helmet>
      <header {...headerStyle}>
        <h1>Journal</h1>
      </header>
      <main {...contentStyle}>
        {journal.entries
          .filter((entry) => entry.published)
          .map((entry) => (
            <Preview key={entry.id} {...entry} />
          ))}
      </main>
      <Footer />
    </div>
  );
}

export default Journal;
