// @ts-nocheck
'use strict';

const { randomBytes } = require('crypto');
const { URL } = require('url');
const https = require('https');

/**
 * Send a response to CloudFormation to indicate the outcome of managing a
 * custom resource via a Lambda function.
 * @param {Error|null} err - If there was any failure while managing the resource,
 * provide the error object in order to indicate a failure. Otherwise, provide `null`.
 * @param {object} event - You must provide the event object that invoked the
 * Lambda function.
 * @param {object} [data={}] - Information about the managed resource.
 * @param {string} [data.id=random] - The managed resource's physical identifier.
 * @param {object} [data.attributes={}] - Key-value pairs describing attributes
 * of the managed resource which should be accessible via `Fn::GetAtt` in the
 * CloudFormation template.
 */
const response = async (err, event, data = {}) => {
  if (!event)
    throw new Error('Unrecoverable error: no event provided to cfn-response');

  const { StackId, RequestId, LogicalResourceId, ResponseURL } = event;
  let { PhysicalResourceId = randomBytes(8).toString('hex') } = event;

  if (!StackId || !RequestId || !LogicalResourceId || !ResponseURL)
    throw new Error(
      'Unrecoverable error: malformed event provided to cfn-response'
    );

  if (typeof data !== 'object')
    err = new Error('cfn-response received a non-object data');

  if (data.id) PhysicalResourceId = data.id;
  let { attributes: Data = {} } = data;

  if (!err && typeof PhysicalResourceId !== 'string') {
    err = new Error('cfn-response received a non-string data.id');
    PhysicalResourceId = randomBytes(8).toString('hex');
  }

  if (!err && typeof Data !== 'object') {
    err = new Error('cfn-response received a non-object data.attributes');
    Data = {};
  }

  const body = {
    Status: err ? 'FAILED' : 'SUCCESS',
    StackId,
    RequestId,
    LogicalResourceId,
    PhysicalResourceId,
    Data,
    NoEcho: false,
  };

  if (err) {
    console.error(err);
    // AWS error messages may have non-ASCII characters, and Cloudformation will
    // treat the response JSON as invalid if the `Reason` contains non-ASCII characters.
    // We gracefully replace "smart quotes", and then make super-duper sure there
    // are no non-ASCII characters (and no ASCII control characters in the
    // range \x00-\x1F) remaining.
    body.Reason = err
      .toString()
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[^\x20-\x7F]/g, '');
  }

  const parsed = new URL(ResponseURL);

  const options = {
    hostname: parsed.hostname,
    port: 443,
    path: `${parsed.pathname}?${parsed.searchParams}`,
    method: 'PUT',
    headers: {
      'content-type': '',
      'content-length': JSON.stringify(body).length,
    },
  };
  await new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      res.on('error', (err) => {
        reject(err);
      });
      return resolve();
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(JSON.stringify(body));
    req.end();
  });
};

module.exports = response;
