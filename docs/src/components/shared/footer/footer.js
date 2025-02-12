import React from 'react';
import { css } from 'glamor';

import githubSvg from 'assets/svgs/github.svg';
import wharfieLogo from 'assets/images/beanie.png?as=webp';
import { COLOR_BLUE } from '../color';
import Time from '../time';

const footerStyle = css({
  paddingTop: 20,
  marginBottom: 20,
  display: 'inline-block',
  width: '100%',
  borderTop: `1px solid ${COLOR_BLUE}`,
});

const linkStyle = css({
  display: 'inline-block',
  width: '40%',
});

const homeIconStyle = css({
  marginBottom: 0,
  width: 50,
});

const githubIconStyle = css({
  marginBottom: 0,
  width: 50,
});

function Footer({ timestamp }) {
  return (
    <footer {...footerStyle}>
      <section {...linkStyle}>
        <a href="/">
          <img
            {...homeIconStyle}
            width="50"
            height="50"
            alt="Home"
            src={wharfieLogo.src}
          />
        </a>
      </section>
      <section {...linkStyle}>
        <a
          href="https://github.com/wharfie/wharfie"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            {...githubIconStyle}
            width="50"
            height="50"
            alt="Github"
            src={githubSvg.src}
          />
        </a>
      </section>
      <Time timestamp={timestamp} />
    </footer>
  );
}

export default Footer;
