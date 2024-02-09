'use strict';

const wharfie = require('../../../../client');

const SemaphoreTable = require('./semaphore-table');
const ResourceTable = require('./resource-table');
const LocationTable = require('./location-table');
const EventTable = require('./event-table');
const DependencyTable = require('./dependency-table');

module.exports = wharfie.util.merge(
  SemaphoreTable,
  ResourceTable,
  LocationTable,
  EventTable,
  DependencyTable
);
