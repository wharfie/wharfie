'use strict';

/**
 * Rate-limit snapshot parsed from Hetzner response headers.
 * Describes the current hourly window quota and reset time.
 * @typedef {Object} HetznerRate
 * @property {number|null} limit Total requests permitted in the current hourly window.
 * @property {number|null} remaining Remaining requests available in the current window.
 * @property {number|null} reset UNIX timestamp (seconds) when the window fully resets.
 */

/**
 * Low-level HTTP request options accepted by the internal _request() helper.
 * @typedef {Object} HetznerRequestOptions
 * @property {'GET'|'POST'|'PATCH'|'PUT'|'DELETE'} [method='GET'] HTTP method to use.
 * @property {Record<string, unknown>} [query] Query parameters that will be serialized to the URL.
 * @property {unknown} [body] JSON-serializable request payload.
 * @property {Record<string, string>} [headers] Additional request headers.
 */

/**
 * Constructor options for the HetznerCloud client.
 * Token is required at runtime even though it's optional for ergonomics.
 * @typedef {Object} HetznerClientOptions
 * @property {string} [token] Project-scoped API token used for Authorization.
 * @property {string} [baseUrl] Base URL for the API root (defaults to https://api.hetzner.cloud/v1).
 */

/**
 * Single-page list query when retrieving Floating IPs.
 * @typedef {Object} ListFloatingIPsOptions
 * @property {string} [name] Exact name to match.
 * @property {string} [label_selector] Label selector (e.g., "env=prod,!type").
 * @property {string|string[]} [sort] Sort key(s): "id", "created", "id:asc", etc.
 * @property {number} [page=1] 1-based page index.
 * @property {number} [per_page=25] Page size (1..50).
 */

/**
 * Payload for creating a Floating IP (POST /floating_ips).
 * @typedef {Object} CreateFloatingIPPayload
 * @property {'ipv4'|'ipv6'} type Address family to create.
 * @property {number|null} [server] Initial server ID to assign to (or null to keep unassigned).
 * @property {string} [home_location] Home location ID/name (omit if server provided).
 * @property {string|null} [description] Human-readable description.
 * @property {string} [name] Unique name within the project.
 * @property {Record<string,string>} [labels] Arbitrary labels.
 */

/**
 * Body for updating a Floating IP (PUT /floating_ips/{id}).
 * @typedef {Object} UpdateFloatingIPBody
 * @property {string|null} [description] New description (nullable to clear).
 * @property {string} [name] New unique name.
 * @property {Record<string,string>} [labels] Full label map to replace existing labels.
 */

/**
 * Filter options when listing Floating IP actions globally.
 * @typedef {Object} ListFloatingIPActionsOptions
 * @property {number[]} [id] Action IDs to include.
 * @property {('running'|'success'|'error')[]} [status] Status values to include.
 * @property {string|string[]} [sort] Sort keys (e.g., "id:desc").
 * @property {number} [page=1] 1-based page index.
 * @property {number} [per_page=25] Page size (1..50).
 */

/**
 * Filter options when listing actions for a specific Floating IP.
 * @typedef {Object} ListFIPActionsForResourceOptions
 * @property {string|string[]} [sort] Sort keys.
 * @property {('running'|'success'|'error')[]} [status] Status values.
 * @property {number} [page=1] 1-based page index.
 * @property {number} [per_page=25] Page size (1..50).
 */

/**
 * Body for assigning a Floating IP to a server.
 * @typedef {Object} AssignFloatingIPBody
 * @property {number|null} server Server ID to assign to (null to leave unassigned).
 */

/**
 * Body for changing reverse-DNS (PTR) of a Floating IP.
 * @typedef {Object} ChangeDNSPtrBody
 * @property {string} ip The specific IPv4/IPv6 address within the FIP to update.
 * @property {string} dns_ptr The hostname the PTR record should point to.
 */

/**
 * Body for changing delete protection on a Floating IP.
 * @typedef {Object} ChangeFloatingIPProtectionBody
 * @property {boolean} delete If true, prevents delete; false allows deletion.
 */

/**
 * Single-page list query for SSH keys.
 * @typedef {Object} ListSSHKeysOptions
 * @property {string|string[]} [sort] Sort directives (e.g., "name:asc").
 * @property {string} [name] Exact name filter.
 * @property {string} [fingerprint] Exact fingerprint filter.
 * @property {string} [label_selector] Label selector expression.
 * @property {number} [page=1] 1-based page index.
 * @property {number} [per_page=25] Page size (1..50).
 */

/**
 * Payload for creating an SSH key (POST /ssh_keys).
 * @typedef {Object} CreateSSHKeyPayload
 * @property {string} name Unique name for the key.
 * @property {string} public_key OpenSSH public key string.
 * @property {Record<string,string>} [labels] Optional labels.
 */

/**
 * Body for updating an SSH key (PUT /ssh_keys/{id}).
 * @typedef {Object} UpdateSSHKeyBody
 * @property {string} [name] New unique name.
 * @property {Record<string,string>} [labels] Full label map to replace existing labels.
 */

/**
 * Single-page list query for servers.
 * @typedef {Object} ListServersOptions
 * @property {number} [page=1] 1-based page index.
 * @property {number} [per_page=25] Page size (1..50).
 * @property {string} [label_selector] Label selector expression.
 * @property {string|string[]} [sort] Sort directives.
 */

/**
 * Iteration options for paginating all servers.
 * @typedef {Object} IterateServersOptions
 * @property {number} [per_page=50] Page size used during pagination (max 50).
 * @property {string} [label_selector] Label selector expression.
 * @property {string|string[]} [sort] Sort directives.
 */

/**
 * Server creation payload (POST /servers).
 * Captures the full shape accepted by Hetzner for provisioning a server.
 * @typedef {Object} CreateServerPayload
 * @property {string} name RFC1123-compliant unique hostname.
 * @property {string} server_type Server type (e.g., "cpx11").
 * @property {string} image Image ID or name (e.g., "ubuntu-22.04").
 * @property {string} [location] Location ID or name (mutually exclusive with datacenter).
 * @property {string} [datacenter] Datacenter ID or name (mutually exclusive with location).
 * @property {boolean} [start_after_create=true] Auto power on after creation.
 * @property {number} [placement_group] Placement group ID.
 * @property {(number|string)[]} [ssh_keys] SSH key IDs or names.
 * @property {number[]} [volumes] Volume IDs to attach.
 * @property {number[]} [networks] Network IDs to attach.
 * @property {{ firewall: number }[]} [firewalls] Firewall refs to apply.
 * @property {string} [user_data] Cloud-init user-data (<= 32 KiB).
 * @property {Record<string, string>} [labels] Arbitrary labels.
 * @property {boolean} [automount] Auto-mount attached volumes.
 * @property {{ enable_ipv4?: boolean, enable_ipv6?: boolean, ipv4?: number|null, ipv6?: number|null }} [public_net] Public NIC options + Primary IP overrides.
 */

/**
 * Query parameters for server metrics (GET /servers/{id}/metrics).
 * @typedef {Object} ServerMetricsParams
 * @property {string} type Metric types: "cpu", "disk", "network" or comma-joined (e.g., "cpu,network").
 * @property {string} start ISO-8601 start timestamp.
 * @property {string} end ISO-8601 end timestamp.
 * @property {string} [step] Optional resolution in seconds.
 */

/**
 * Global server actions list filters (GET /servers/actions).
 * @typedef {Object} ListServerActionsOptions
 * @property {number[]} [id] Action IDs to include.
 * @property {('running'|'success'|'error')[]} [status] Status values to include.
 * @property {string|string[]} [sort] Sort directives.
 * @property {number} [page=1] 1-based page index.
 * @property {number} [per_page=25] Page size (1..50).
 */

/**
 * Per-server actions list filters (GET /servers/{id}/actions).
 * @typedef {Object} ListServerActionsForResourceOptions
 * @property {('running'|'success'|'error')[]} [status] Status values to include.
 * @property {string|string[]} [sort] Sort directives.
 * @property {number} [page=1] 1-based page index.
 * @property {number} [per_page=25] Page size (1..50).
 */

/**
 * Wait options used by waitForServerRunning().
 * @typedef {Object} WaitServerOptions
 * @property {number} [intervalMs=2000] Polling interval (ms).
 * @property {number} [timeoutMs=900000] Timeout (ms).
 * @property {boolean} [requireIPv4=true] If true, require primary public IPv4 to be present.
 */

/**
 * High-level options to create a server and install a systemd service on first boot.
 * @typedef {Object} CreateAndRunServiceOptions
 * @property {CreateServerPayload} server Complete server create payload.
 * @property {Object} exec Executable + service configuration.
 * @property {string} [exec.url] HTTPS URL to download the executable.
 * @property {string} [exec.inline_b64] Base64-encoded executable/script content.
 * @property {string} [exec.remote_path='/usr/local/bin/app'] Absolute path to place the executable.
 * @property {string[]} [exec.args=[]] Command-line arguments.
 * @property {Record<string,string>} [exec.env={}] Environment variables file content.
 * @property {string} [exec.user='root'] System user to run as.
 * @property {string} [exec.group] System group to run as (defaults to user).
 * @property {string} [exec.service_name='app'] systemd unit name (app => app.service).
 * @property {'simple'|'exec'|'notify'} [exec.type='simple'] systemd Service.Type.
 * @property {'always'|'on-failure'|'no'} [exec.restart='always'] systemd Restart policy.
 * @property {number} [exec.restart_sec=3] Seconds before restart.
 * @property {boolean} [exec.wantsNetworkOnline=true] Add Wants/After network-online.target.
 * @property {string} [exec.stdout_log='/var/log/app.stdout.log'] Stdout log file.
 * @property {string} [exec.stderr_log='/var/log/app.stderr.log'] Stderr log file.
 * @property {boolean} [wait_for_action=true] Wait for create action to complete.
 * @property {boolean} [wait_for_running=true] Wait for server to be running.
 * @property {boolean} [wait_for_ipv4=true] Require primary IPv4 when waiting.
 * @property {number} [intervalMs=2000] Poll interval (ms).
 * @property {number} [timeoutMs=900000] Timeout (ms).
 */

/**
 * High-level options to create a server and run an executable on first boot (cloud-init).
 * @typedef {Object} CreateAndRunOptions
 * @property {CreateServerPayload} server Server create payload.
 * @property {Object} exec Executable configuration.
 * @property {string} [exec.url] HTTPS URL to download the executable.
 * @property {string} [exec.inline_b64] Base64-encoded executable/script content.
 * @property {string} [exec.remote_path='/root/app.bin'] Destination path on the VM.
 * @property {string[]} [exec.args=[]] Command-line arguments.
 * @property {Record<string,string>} [exec.env={}] Env variables written to file and exported.
 * @property {boolean} [exec.background=true] If true, runs under nohup in background.
 * @property {string} [exec.stdout='/var/log/hx-exec.out'] Combined stdout/stderr log file.
 * @property {string} [exec.user='root'] System user to run as.
 * @property {boolean} [wait_for_action=true] Wait for create action to complete.
 */

/**
 * Options for terminateServerFast() destructive helper.
 * @typedef {Object} TerminateServerFastOptions
 * @property {boolean} [wait=true] Wait for final delete action to finish.
 * @property {number} [intervalMs=2000] Poll interval (ms).
 * @property {number} [timeoutMs=900000] Timeout (ms).
 */

module.exports = {}; // mark as a CommonJS module (no runtime exports necessary)
