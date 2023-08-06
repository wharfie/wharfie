'use strict';
require('./config');
const response = require('./lib/cloudformation/cfn-response');
const { getImmutableID } = require('./lib/cloudformation/id');
const Wharfie = require('./resources/wharfie');
const WharfieUDF = require('./resources/wharfie_udf');

/**
 * @param {import('./typedefs').CloudformationEvent & import('./typedefs').CloudformationUpdateEvent} event -
 * @returns {Promise<import('./typedefs').ResourceRouterResponse>} -
 */
async function router(event) {
  if (event.ResourceType === 'Custom::Wharfie') {
    return await Wharfie.handler(event);
  }
  if (event.ResourceType === 'Custom::WharfieUDF') {
    return await WharfieUDF.handler(event);
  }
  throw new Error(
    "Invalid ResourceType, must be one of ['Custom::Wharfie', 'Custom::WharfieUDF']"
  );
}

/**
 * @param {import('./typedefs').CloudformationEvent & import('./typedefs').CloudformationUpdateEvent} event -
 */
const handler = async (event) => {
  // log information about the request
  console.log({
    StackId: event.StackId,
    RequestType: event.RequestType,
    LogicalResourceId: event.LogicalResourceId,
    event: JSON.stringify(event),
  });

  try {
    const router_response = await router(event);
    if (router_response.respond) {
      await response(null, event, {
        id: getImmutableID(event),
      });
    }
  } catch (err) {
    console.error(err);
    // @ts-ignore
    await response(err, event, {
      id: getImmutableID(event),
    });
  }
};

module.exports = {
  handler,
};
