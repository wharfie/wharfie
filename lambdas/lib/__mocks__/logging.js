'use strict';

// eslint-disable-next-line no-undef
const logging = jest.requireActual('../logging');

// disable flush to keep loggers open
logging.flush = () => {};

module.exports = logging;
