/**
 * The one host-local account permitted to own and execute Wharfie runtime
 * state. Numeric IDs are deliberately stable so retained media remains
 * usable after a node replacement without an ownership migration.
 */
export const AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_USER = 'wharfie-runtime';
export const AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GROUP = 'wharfie-runtime';
export const AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID = 60_706;
export const AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID = 60_706;
export const AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GECOS = '';
export const AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_HOME =
  '/var/lib/wharfie-runtime';
export const AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_SHELL = '/usr/sbin/nologin';

export const AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT = Object.freeze({
  user: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_USER,
  group: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GROUP,
  uid: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID,
  gid: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID,
  gecos: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GECOS,
  home: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_HOME,
  shell: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_SHELL,
});

export default AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT;
