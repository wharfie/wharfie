import React from 'react';
import { css } from 'glamor';
import Time from 'components/shared/time';

const titleStyle = css({
  display: 'flex',
  flexDirection: 'column',
});

const Preview = ({ title, slug, updated_at, description }) => (
  <article>
    <header>
      <h2 {...titleStyle}>
        <a href={`/journal/${slug}/`}>{title}</a>
        <Time timestamp={updated_at} />
      </h2>
    </header>
    <section>
      <p>
        {description}
        <a href={`/journal/${slug}/`}> »</a>
      </p>
    </section>
    <hr />
    <footer />
  </article>
);

export default Preview;
