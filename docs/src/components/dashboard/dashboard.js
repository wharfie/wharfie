import React from 'react';
import { css } from 'glamor';
import { Helmet } from 'react-helmet';
import Footer from 'components/shared/footer/';
import Navbar from 'components/shared/navbar/';

const containerStyle = css({
  width: '100%',
});

// const contentStyle = css({
//   height: "50%",
//   paddingTop: "3em",
//   width: "100%",
//   display: "inline-block",
//   backgroundColor: "#fefefe"
// });

// const linkStyle = css({
//   display: "inline-block",
//   width: "40%"
// });

function Dashboard({ event }) {
  return (
    <div {...containerStyle}>
      <Helmet>
        <title>wharfie</title>
        <meta
          name="description"
          content="Wharfie is an experimental table-oriented data application framework built ontop of AWS Athena."
        />
        <link rel="canonical" href="https://wharfie.dev/" />
      </Helmet>
      <Navbar>
        <h1>Welcome to the Documentation</h1>
        <p>
          Resize your browser or click the menu on mobile to open the sidebar.
        </p>
      </Navbar>
      {/* <div {...contentStyle}>
        <h2 {...linkStyle}>
          <a href="/journal/">Journal</a>
        </h2>
      </div> */}
      <Footer />
    </div>
  );
}

export default Dashboard;
