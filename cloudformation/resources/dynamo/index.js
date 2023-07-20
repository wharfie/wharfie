'use strict';

const wharfie = require('../../../client');

const CounterTable = require('./counter-table');
const SemaphoreTable = require('./semaphore-table');
const ResourceTable = require('./resource-table');
const LocationTable = require('./location-table');
const EventTable = require('./event-table');

module.exports = wharfie.util.merge(
  CounterTable,
  SemaphoreTable,
  ResourceTable,
  LocationTable,
  EventTable
);
