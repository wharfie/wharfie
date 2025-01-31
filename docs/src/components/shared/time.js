import React from 'react';
import { css } from 'glamor';

const DATE_OPTIONS = {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
};

const timeStyle = css({
  fontSize: '0.6rem',
});

const Time = ({ timestamp }) => (
  <time {...timeStyle}>
    {new Date(timestamp).toLocaleDateString('en-US', DATE_OPTIONS)}
  </time>
);

export default Time;
