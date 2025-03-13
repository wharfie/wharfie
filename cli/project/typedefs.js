'use strict';

/**
 * @typedef Project
 * @property {string} name -
 * @property {string} path -
 * @property {Environment[]} environments -
 * @property {Model[]} models -
 * @property {Source[]} sources -
 * @property {Definition[]} definitions -
 * @property {Sink[]} sinks -
 * @property {Tap[]} taps -
 */

/**
 * @typedef Model
 * @property {string} name -
 * @property {string} description -
 * @property {string} sql -
 * @property {Column[]} columns -
 * @property {Column[]} partitions -
 * @property {ServiceLevelAgreement} service_level_agreement -
 * @property {SideEffect[]} side_effects -
 */

/**
 * @typedef ServiceLevelAgreement
 * @property {number} freshness -
 */

/**
 * @typedef SideEffect
 * @property {string} type -
 * @property {string} trigger -
 * @property {Object<string,any>} config -
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
 * @property {SideEffect[]} side_effects -
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
 * @property {Object<string,string | SecretsManagerReference>} variables -
 */

/**
 * @typedef SecretsManagerReference
 * @property {string} ref -
 */

/**
 * @typedef Definition
 * @property {string} name -
 * @property {string} description -
 * @property {DefinitionTypeEnum} definition_type -
 * @property {Runtime} runtime -
 * @property {Number} timeout -
 * @property {Number} memory -
 * @property {string} entrypoint -
 * @property {Object<string,string | SecretsManagerReference>} environment_variables -
 * @property {Object<string,ConfigurationDefinition>} configuration_definition -
 */

/**
 * @typedef {('side_effect'|'sink'|'tap')} DefinitionTypeEnum
 */

/**
 * @typedef Runtime
 * @property {string} language -
 * @property {string} version -
 * @property {string} architecture -
 */

/**
 * @typedef {string | ArrayConfigurationDefinition | ObjectConfigurationDefinition} ConfigurationDefinition
 */

/**
 * @typedef ArrayConfigurationDefinition
 * @property {('array')} type -
 * @property {ConfigurationDefinition} items -
 */

/**
 * @typedef ObjectConfigurationDefinition
 * @property {('object')} type -
 * @property {ConfigurationDefinition} properties -
 */

/**
 * @typedef Sink
 * @property {string} name -
 * @property {string} sink_type -
 * @property {SinkSource} input -
 * @property {ServiceLevelAgreement} service_level_agreement -
 * @property {Object<string,any>} config -
 */

/**
 * @typedef SinkSource
 * @property {string} [source_name] -
 * @property {string} [model_name] -
 */

/**
 * @typedef Tap
 * @property {string} name -
 * @property {string} tap_type -
 * @property {SinkSource} input -
 * @property {ServiceLevelAgreement} service_level_agreement -
 * @property {Object<string,any>} config -
 */

exports.unused = {};
