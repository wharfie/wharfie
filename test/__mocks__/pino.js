'use strict';

const pinoMock = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }),
  flush: jest.fn((cb) => cb()),
};

module.exports = {
  pino: jest.fn(() => pinoMock),
};
