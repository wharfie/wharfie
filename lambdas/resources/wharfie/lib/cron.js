'use strict';

/**
 * @param {number} min -
 * @param {number} max -
 * @returns {number} - a random number between min and max
 */
function between(min, max) {
  return Math.floor(Math.random() * (max - min) + min);
}

/**
 * @param {number} operationTime -
 * @param {number} schedule -
 * @returns {number} - offset in minutes of cron expression
 */
function getScheduleOffset(operationTime, schedule) {
  const days = Math.trunc(schedule / (60 * 24));
  const hours = Math.trunc((schedule % (60 * 24)) / 60);
  let offset = 0;
  if (days) {
    offset += operationTime % (days * 24 * 60 * 60);
  }
  if (hours) {
    offset += operationTime % (hours * 60 * 60);
  }
  return Math.trunc(offset / 60);
}

/**
 * @param {number} minutes -
 * @returns {string} - a randomized cron expression
 */
function generateSchedule(minutes) {
  const days = Math.trunc(minutes / (60 * 24));
  const hours = Math.trunc((minutes % (60 * 24)) / 60);
  const min = minutes % 60;
  const daysExpression = days ? `1/${days}` : '*';
  const hourExpression = hours
    ? days
      ? between(0, 24)
      : `1/${hours}`
    : days
    ? between(0, 24)
    : '*';
  const minuteExpression = min
    ? days || hours
      ? between(0, 60)
      : `1/${min}`
    : days || hours
    ? between(0, 60)
    : '*';

  const expression = `cron(${minuteExpression} ${hourExpression} ? * ${daysExpression} *)`;
  return expression;
}

module.exports = {
  generateSchedule,
  getScheduleOffset,
};
