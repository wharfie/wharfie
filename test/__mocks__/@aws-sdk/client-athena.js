'use strict';
const AWS = jest.requireActual('@aws-sdk/client-athena');
const { mockClient } = require('aws-sdk-client-mock');

let Athena, AthenaMock, paginateGetQueryResults;
if (process.env.AWS_MOCKS) {
  Athena = jest.requireActual('./athena');
  paginateGetQueryResults = Athena.paginateGetQueryResults;
} else {
  Athena = AWS.Athena;
  AthenaMock = mockClient(AWS.Athena);
  paginateGetQueryResults = AWS.paginateGetQueryResults;
}

module.exports = Object.assign(
  {},
  { ...AWS, Athena, AthenaMock, paginateGetQueryResults }
);
