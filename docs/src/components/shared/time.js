import React from 'react';
import { css } from 'glamor';

const DATE_OPTIONS = {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
};

const timeStyle = css({
  display: 'inline-block',
  width: '100%',
  fontSize: '0.8rem',
  color: '#f8f8f2' /* light text */,
});

const Time = ({ timestamp }) => (
  <time {...timeStyle}>
    {new Date(timestamp).toLocaleDateString('en-US', DATE_OPTIONS)}
  </time>
);

export default Time;
