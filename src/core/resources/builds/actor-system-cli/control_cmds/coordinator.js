import { createCoordinatorAuthorityCommand } from '../../../../runtime/operator/coordinator-authority-command.js';

/**
 * Build a fresh coordinator-authority command scoped to this artifact's
 * immutable embedded application identity.
 * @param {{resolveExpectedIdentity: () => Promise<{appId: string, revisionId?: string}> | {appId: string, revisionId?: string}, inspectAuthority?: typeof import('../../../../runtime/operator/coordinator-authority-command.js').inspectCoordinatorAuthority, takeoverAuthority?: typeof import('../../../../runtime/operator/coordinator-authority-command.js').takeoverCoordinatorAuthority, readJsonObjectFile?: typeof import('../../../../runtime/operator/json-document-file.js').readOperatorJsonObjectFile, output?: Partial<import('../../../../runtime/operator/coordinator-authority-command.js').CoordinatorAuthorityCommandOutput>, processRef?: import('../../../../runtime/operator/coordinator-authority-command.js').CoordinatorAuthorityCommandProcess}} options - Packaged host seams.
 * @returns {import('commander').Command} - Fresh packaged coordinator command.
 */
export function createPackagedCoordinatorAuthorityCommand(options) {
  if (!options || typeof options.resolveExpectedIdentity !== 'function') {
    throw new TypeError(
      'createPackagedCoordinatorAuthorityCommand requires resolveExpectedIdentity.',
    );
  }
  return createCoordinatorAuthorityCommand({
    async resolveIdentity() {
      const identity = await options.resolveExpectedIdentity();
      return { appId: identity.appId };
    },
    ...(options.inspectAuthority === undefined
      ? {}
      : { inspectAuthority: options.inspectAuthority }),
    ...(options.takeoverAuthority === undefined
      ? {}
      : { takeoverAuthority: options.takeoverAuthority }),
    ...(options.readJsonObjectFile === undefined
      ? {}
      : { readJsonObjectFile: options.readJsonObjectFile }),
    ...(options.output === undefined ? {} : { output: options.output }),
    ...(options.processRef === undefined
      ? {}
      : { processRef: options.processRef }),
  });
}

export default createPackagedCoordinatorAuthorityCommand;
