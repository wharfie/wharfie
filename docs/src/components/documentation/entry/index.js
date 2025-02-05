import React from 'react';
import Entry from './entry';

export default class AsyncEntry extends React.Component {
  constructor() {
    super();
    this.state = {
      html: '',
    };
  }
  componentDidMount() {
    import(`assets/markdown/${this.props.entry.path}.md`).then((file) => {
      this.setState({ html: file.default });
    });
  }
  render() {
    const { html } = this.state;
    return <Entry {...this.props} html={html} />;
  }
}
