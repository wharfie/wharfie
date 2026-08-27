import { createCoordinatorAuthorityCommand } from '../../../core/runtime/operator/coordinator-authority-command.js';

/**
 * Build a fresh source coordinator-authority command. Historical authority is
 * selected by exact app ID and does not load or execute current authored code.
 * @param {{inspectAuthority?: typeof import('../../../core/runtime/operator/coordinator-authority-command.js').inspectCoordinatorAuthority, takeoverAuthority?: typeof import('../../../core/runtime/operator/coordinator-authority-command.js').takeoverCoordinatorAuthority, readJsonObjectFile?: typeof import('../../../core/runtime/operator/json-document-file.js').readOperatorJsonObjectFile, output?: Partial<import('../../../core/runtime/operator/coordinator-authority-command.js').CoordinatorAuthorityCommandOutput>, processRef?: import('../../../core/runtime/operator/coordinator-authority-command.js').CoordinatorAuthorityCommandProcess}} [options] - Source command seams.
 * @returns {import('commander').Command} - Fresh source coordinator command.
 */
export function createSourceCoordinatorAuthorityCommand(options = {}) {
  return createCoordinatorAuthorityCommand({
    includeAppIdOption: true,
    resolveIdentity(selection) {
      return { appId: selection.appId };
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

export default createSourceCoordinatorAuthorityCommand;
