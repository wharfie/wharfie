/* eslint-disable jest/no-large-snapshots */
'use strict';
const cron = require('../../../lambdas/resources/wharfie/lib/cron');

const mockMath = Object.create(global.Math);
mockMath.random = () => 0.5;
global.Math = mockMath;

describe('tests for cron functions', () => {
  it('generateSchedule', async () => {
    expect.assertions(5);
    expect(cron.generateSchedule(100)).toMatchInlineSnapshot(
      `"cron(30 1/1 ? * * *)"`
    );
    expect(cron.generateSchedule(14)).toMatchInlineSnapshot(
      `"cron(1/14 * ? * * *)"`
    );
    expect(cron.generateSchedule(1440)).toMatchInlineSnapshot(
      `"cron(30 12 ? * 1/1 *)"`
    );
    expect(cron.generateSchedule(1450)).toMatchInlineSnapshot(
      `"cron(30 12 ? * 1/1 *)"`
    );
    expect(cron.generateSchedule(14500)).toMatchInlineSnapshot(
      `"cron(30 12 ? * 1/10 *)"`
    );
  });
  it('getScheduleOffset', async () => {
    expect.assertions(6);
    expect(cron.getScheduleOffset(1632822300, 60)).toMatchInlineSnapshot(`45`);
    expect(cron.getScheduleOffset(1632822300, 1440)).toMatchInlineSnapshot(
      `585`
    );
    expect(cron.getScheduleOffset(1632872656, 1440)).toMatchInlineSnapshot(
      `1424`
    );
    expect(cron.getScheduleOffset(1632872656, 5)).toMatchInlineSnapshot(`0`);
    expect(cron.getScheduleOffset(1632872656, 59)).toMatchInlineSnapshot(`0`);
    expect(cron.getScheduleOffset(1632872656, 61)).toMatchInlineSnapshot(`44`);
  });
});
