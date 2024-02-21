'use strict';

/**
 * @typedef Project
 * @property {string} name -
 * @property {string} path -
 * @property {Environment[]} environments -
 * @property {Model[]} models -
 * @property {Source[]} sources -
 */

/**
 * @typedef Model
 * @property {string} name -
 * @property {string} description -
 * @property {string} sql -
 * @property {Column[]} columns -
 * @property {Column[]} partitions -
 * @property {ServiceLevelAgreement} service_level_agreement -
 */

/**
 * @typedef ServiceLevelAgreement
 * @property {number} freshness -
 */

/**
 * @typedef Column
 * @property {string} name -
 * @property {string} type -
 */

/**
 * @typedef Source
 * @property {string} name -
 * @property {string} description -
 * @property {string} format -
 * @property {CustomFormat?} custom_format -
 * @property {InputLocation} input_location -
 * @property {Column[]} columns -
 * @property {Column[]} partitions -
 * @property {ServiceLevelAgreement} service_level_agreement -
 */

/**
 * @typedef CustomFormat
 * @property {string} input_format -
 * @property {string} output_format -
 * @property {SerdeInfo} serde_info -
 * @property {Boolean} compressed -
 * @property {Boolean} stored_as_sub_directories -
 * @property {Number} number_of_buckets -
 */

/**
 * @typedef SerdeInfo
 * @property {string} serialization_library -
 * @property {Object<string, string>} parameters -
 */

/**
 * @typedef InputLocation
 * @property {string} storage -
 * @property {string} path -
 */

/**
 * @typedef Environment
 * @property {string} name -
 * @property {Object<string,string | SecretsManagerReference >} variables -
 */

/**
 * @typedef SecretsManagerReference
 * @property {string} ref -
 */

exports.unused = {};
