import { describe, expect, it } from '@jest/globals';

import {
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GECOS,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GROUP,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_HOME,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_SHELL,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_USER,
} from '../../src/core/runtime/deployment-aws-host-runtime-account.js';

describe('AWS single-node host runtime account', () => {
  it('exposes one frozen stable identity for retained media and host execution', () => {
    expect(AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT).toEqual({
      user: 'wharfie-runtime',
      group: 'wharfie-runtime',
      uid: 60_706,
      gid: 60_706,
      gecos: '',
      home: '/var/lib/wharfie-runtime',
      shell: '/usr/sbin/nologin',
    });
    expect(AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT).toEqual({
      user: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_USER,
      group: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GROUP,
      uid: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID,
      gid: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID,
      gecos: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GECOS,
      home: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_HOME,
      shell: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_SHELL,
    });
    expect(Object.isFrozen(AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT)).toBe(true);
  });
});
