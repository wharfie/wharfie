import React, { Component } from 'react';
import Router from './Router';
import { css } from 'glamor';
import { createBrowserHistory } from 'history';
import { PAGE_BG } from './shared/color';

// import "assets/styles/typography.css";

import Typography from 'typography';

const typography = new Typography({
  baseFontSize: '16px',
  baseLineHeight: 1.63,
  scaleRatio: 2.0,
  headerFontFamily: ['Menlo', 'Monaco', 'Lucida Console', 'monospace'],
  bodyFontFamily: ['monospace'],
});
typography.injectStyles();

const containerStyle = css({
  height: '100%',
  width: '100%',
  display: 'flex',
  textAlign: 'center',
  justifyContent: 'space-between',
  position: 'relative',
  backgroundColor: PAGE_BG,
});

class App extends Component {
  constructor(props) {
    super(props);
    // Initialize history once to prevent mismatches
    this.history = createBrowserHistory();
  }

  render() {
    return (
      <div {...containerStyle}>
        <Router history={this.history} />
      </div>
    );
  }
}

export default App;
