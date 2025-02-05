import React from 'react';
import { css } from 'glamor';
import { Helmet } from 'react-helmet';
import Footer from 'components/shared/footer/';
import Navbar from 'components/shared/navbar/';

const containerStyle = css({
  width: '100%',
});

function Documentation() {
  return (
    <div {...containerStyle}>
      <Helmet>
        <title>wharfie</title>
        <meta
          name="description"
          content="Wharfie is an experimental table-oriented data application framework built ontop of AWS Athena."
        />
        <link rel="canonical" href="https://docs.wharfie.dev/" />
      </Helmet>
      <Navbar></Navbar>
      <Footer />
    </div>
  );
}

export default Documentation;
