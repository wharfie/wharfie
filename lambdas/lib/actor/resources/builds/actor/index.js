// const uuid = require('uuid');

// const BuildResourceGroup = require('../build-resource-group');
// const NodeBinary = require('../node-binary');
// const BuildResource = require('../build-resource');
// const SeaBuild = require('../sea-build');
// const MacOSBinarySignature = require('../macos-binary-signature');
// // const { execFile } = require('../../../cmd');
// const paths = require('../../../../paths');

// const path = require('node:path');
// const zlib = require('node:zlib');
// const fs = require('node:fs');
// const { getAsset } = require('node:sea');

// /**
//  * @typedef {('local'|'aws')} InfrastructurePlatform
//  */

// /**
//  * @typedef {('darwin'|'win'|'linux')} SeaBinaryPlatform
//  */
// /**
//  * @typedef {('x64'|'arm64')} SeaBinaryArch
//  */

// /**
//  * @typedef WharfieActorProperties
//  * @property {InfrastructurePlatform | function(): InfrastructurePlatform} [infrastructure] -
//  */

// /**
//  * @typedef WharfieActorOptions
//  * @property {string} name -
//  * @property {string} [parent] -
//  * @property {import('../../reconcilable').Status} [status] -
//  * @property {WharfieActorProperties & import('../../../typedefs').SharedProperties} properties -
//  * @property {import('../function')} func -
//  * @property {import('../../reconcilable')[]} [dependsOn] -
//  * @property {Object<string, import('../../base-resource') | import('../../base-resource-group')>} [resources] -
//  */

// class Actor extends BuildResourceGroup {
//   /**
//    * @param {WharfieActorOptions} options -
//    */
//   constructor({
//     name,
//     parent,
//     status,
//     properties,
//     resources,
//     dependsOn,
//     func,
//   }) {
//     const propertiesWithDefaults = Object.assign(
//       {},
//       Actor.DefaultProperties,
//       properties
//     );
//     super({
//       name,
//       parent,
//       status,
//       properties: propertiesWithDefaults,
//       resources,
//       dependsOn: [...(dependsOn ?? []), func],
//     });
//     this.function = func;
//   }

//   async initializeEnvironment() {}

//   /**
//    * @param {string} parent -
//    * @returns {(import('../../base-resource') | import('../../base-resource-group'))[]} -
//    */
//   _defineGroupResources(parent) {
//     return [];
//   }

//   async run() {
//     // this should spin up polling actor/workqueues

//     await this.function.run({ event: true }, { context: 'foo' });
//   }
// }

// Actor.DefaultProperties = {
//   infrastructure: 'local',
// };

// module.exports = Actor;
