'use strict';
const AWS = require('@aws-sdk/client-lambda');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');

const BaseAWS = require('./base');

class Lambda {
  /**
   * @param {import("@aws-sdk/client-lambda").LambdaClientConfig} options - lambda sdk options
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.lambda = new AWS.Lambda({
      ...BaseAWS.config(),
      credentials,
      ...options,
    });
  }

  /**
   * @param {import("@aws-sdk/client-lambda").CreateFunctionCommandInput} params - lambda createFunction params
   * @returns {Promise<import("@aws-sdk/client-lambda").CreateFunctionCommandOutput>} - lambda createFunction result
   */
  async createFunction(params) {
    const command = new AWS.CreateFunctionCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").DeleteFunctionCommandInput} params - lambda createFunction params
   * @returns {Promise<import("@aws-sdk/client-lambda").DeleteFunctionCommandOutput>} - lambda createFunction result
   */
  async deleteFunction(params) {
    const command = new AWS.DeleteFunctionCommand(params);
    return this.lambda.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-lambda").ListFunctionsCommandInput} params - lambda createFunction params
   * @returns {Promise<import("@aws-sdk/client-lambda").ListFunctionsCommandOutput>} - lambda createFunction result
   */
  async listFunctions(params) {
    const allFunctions = [];
    const { Functions, NextMarker } = await this.lambda.send(
      new AWS.ListFunctionsCommand(params)
    );
    allFunctions.push(...(Functions || []));
    let Marker = NextMarker;
    while (Marker) {
      const { Functions, NextMarker } = await this.lambda.send(
        new AWS.ListFunctionsCommand({
          ...params,
          Marker,
        })
      );
      allFunctions.push(...(Functions || []));
      Marker = NextMarker;
    }
    return {
      $metadata: {},
      Functions: allFunctions,
    };
  }
}

module.exports = Lambda;
