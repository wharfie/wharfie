import { createSystemdUserServiceCommand } from '../../../../runtime/operator/systemd-user-service-command.js';

/**
 * Build the packaged-only systemd user-service command. The default manager
 * discovers this running artifact from immutable embedded metadata; tests may
 * inject the narrow operator boundary without loading host service tooling.
 * @param {{loadOperator?: () => any | Promise<any>, output?: Partial<import('../../../../runtime/operator/systemd-user-service-command.js').SystemdUserServiceCommandOutput>, processRef?: import('../../../../runtime/operator/systemd-user-service-command.js').SystemdUserServiceCommandProcess}} [options] - Packaged host seams.
 * @returns {import('commander').Command} - Fresh packaged service command.
 */
export function createPackagedSystemdUserServiceCommand(options = {}) {
  return createSystemdUserServiceCommand(options);
}

export default createPackagedSystemdUserServiceCommand;
