'use strict';

// eslint-disable-next-line no-undef
const logging = jest.requireActual('../');

// disable flush to keep loggers open
logging.flush = () => {};

module.exports = logging;
