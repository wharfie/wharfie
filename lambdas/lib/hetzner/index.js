/**
 * Error thrown for non-2xx Hetzner API responses.
 * @class
 * @augments Error
 */
class HetznerError extends Error {
  /**
   * Construct a HetznerError.
   * @param {Object} params Object containing error fields parsed from the response.
   * @param {number} params.status HTTP status code returned by the API.
   * @param {string} params.code Hetzner machine-readable error code (e.g., "invalid_input").
   * @param {string} params.message Human-readable error message.
   * @param {unknown} [params.details] Provider-specific details object, if present.
   * @param {import('./typedefs.js').HetznerRate|null} [params.rate] Parsed rate-limit information, if available.
   */
  constructor({ status, code, message, details, rate }) {
    super(message || `Hetzner API error (${status})`);
    this.name = 'HetznerError';
    this.status = status;
    this.code = code;
    this.details = details || null;
    this.rate = rate || null;
  }
}

/**
 * Narrow an unknown error to HetznerError.
 * @param {unknown} e Arbitrary thrown value.
 * @returns {e is HetznerError} True if e looks like a HetznerError.
 */
function isHetznerError(e) {
  return (
    e instanceof HetznerError ||
    (typeof e === 'object' &&
      e !== null &&
      // @ts-ignore - safe structural check under checkJs
      typeof e.code === 'string' &&
      // @ts-ignore
      typeof e.status === 'number')
  );
}

/**
 * Minimal vanilla client for the Hetzner Cloud API.
 * CommonJS, Node ≥18 (or inject fetch), no deps.
 * @class
 */
class HetznerCloud {
  // ───────────────────────────────────────────────────────────────────────────────
  // CORE
  // ───────────────────────────────────────────────────────────────────────────────

  /**
   * Create the API client.
   * @param {import('./typedefs.js').HetznerClientOptions} [params] Initialization options for the client.
   */
  constructor(
    params = /** @type {import('./typedefs.js').HetznerClientOptions} */ ({}),
  ) {
    const token = params.token;
    const baseUrl = (params.baseUrl || 'https://api.hetzner.cloud/v1').replace(
      /\/+$/,
      '',
    );

    if (!token) throw new Error('token is required');

    this.token = token;
    this.baseUrl = baseUrl;

    /** @type {import('./typedefs.js').HetznerRate|null} */
    this._lastRate = null;
  }

  /**
   * Last-seen rate-limit snapshot from the previous request.
   * @returns {import('./typedefs.js').HetznerRate|null} Rate-limit info or null if not available.
   */
  get lastRate() {
    return this._lastRate;
  }

  // ───────────────────────────────────────────────────────────────────────────────
  // FLOATING IPs (CRUD + Actions)
  // ───────────────────────────────────────────────────────────────────────────────

  /**
   * List Floating IPs (single page).
   * @param {import('./typedefs.js').ListFloatingIPsOptions} [opts] Filtering, sorting, and pagination options.
   * @returns {Promise<any>} Raw response with "floating_ips" and "meta.pagination".
   */
  listFloatingIPs({
    name,
    label_selector,
    sort,
    page = 1,
    per_page = 25,
  } = {}) {
    return this._request('/floating_ips', {
      query: { name, label_selector, sort, page, per_page },
    });
  }

  /**
   * Iterate all Floating IPs across pages.
   * @param {Omit<import('./typedefs.js').ListFloatingIPsOptions, 'page'|'per_page'> & { per_page?: number }} [opts] Filters/sort; per_page controls pagination.
   * @yields {any} Each Floating IP object from the paginated collection.
   */
  async *iterateFloatingIPs({
    name,
    label_selector,
    sort,
    per_page = 50,
  } = {}) {
    yield* this._paginate('/floating_ips', {
      name,
      label_selector,
      sort,
      per_page,
    });
  }

  /**
   * Create a Floating IP (POST /floating_ips).
   * @param {import('./typedefs.js').CreateFloatingIPPayload} payload Parameters for floating IP creation.
   * @returns {Promise<any>} Response with "floating_ip" and optional "action".
   */
  createFloatingIP(payload) {
    return this._request('/floating_ips', { method: 'POST', body: payload });
  }

  /**
   * Get a single Floating IP (GET /floating_ips/{id}).
   * @param {number|string} id Floating IP ID.
   * @returns {Promise<any>} Response containing "floating_ip".
   */
  getFloatingIP(id) {
    return this._request(`/floating_ips/${id}`);
  }

  /**
   * Update a Floating IP (PUT /floating_ips/{id}).
   * @param {number|string} id Floating IP ID.
   * @param {import('./typedefs.js').UpdateFloatingIPBody} body Fields to update on the floating IP.
   * @returns {Promise<any>} Response containing "floating_ip".
   */
  updateFloatingIP(id, body) {
    return this._request(`/floating_ips/${id}`, { method: 'PUT', body });
  }

  /**
   * Delete a Floating IP (DELETE /floating_ips/{id}).
   * @param {number|string} id Floating IP ID.
   * @returns {Promise<any>} For 204 responses returns { ok: true } via the core requester.
   */
  deleteFloatingIP(id) {
    return this._request(`/floating_ips/${id}`, { method: 'DELETE' });
  }

  /**
   * List Floating IP actions (GET /floating_ips/actions).
   * @param {import('./typedefs.js').ListFloatingIPActionsOptions} [opts] Filters, sorters, and pagination options.
   * @returns {Promise<any>} Response containing "actions" and "meta.pagination".
   */
  listFloatingIPActions({ id, status, sort, page = 1, per_page = 25 } = {}) {
    return this._request('/floating_ips/actions', {
      query: { id, status, sort, page, per_page },
    });
  }

  /**
   * Get a single Floating IP action (GET /floating_ips/actions/{id}).
   * @param {number|string} actionId Action ID.
   * @returns {Promise<any>} Response containing "action".
   */
  getFloatingIPAction(actionId) {
    return this._request(`/floating_ips/actions/${actionId}`);
  }

  /**
   * List actions for a specific Floating IP (GET /floating_ips/{id}/actions).
   * @param {number|string} id Floating IP ID whose actions to list.
   * @param {import('./typedefs.js').ListFIPActionsForResourceOptions} [opts] Filters, sorters, and pagination options.
   * @returns {Promise<any>} Response containing "actions" and "meta.pagination".
   */
  listActionsForFloatingIP(id, { sort, status, page = 1, per_page = 25 } = {}) {
    return this._request(`/floating_ips/${id}/actions`, {
      query: { sort, status, page, per_page },
    });
  }

  /**
   * Get a specific action for a Floating IP (GET /floating_ips/{id}/actions/{action_id}).
   * @param {number|string} id Floating IP ID the action belongs to.
   * @param {number|string} actionId Action ID to fetch.
   * @returns {Promise<any>} Response containing "action".
   */
  getActionForFloatingIP(id, actionId) {
    return this._request(`/floating_ips/${id}/actions/${actionId}`);
  }

  /**
   * Assign a Floating IP (POST /floating_ips/{id}/actions/assign).
   * @param {number|string} id Floating IP ID to assign.
   * @param {import('./typedefs.js').AssignFloatingIPBody} body Body with the target server id.
   * @returns {Promise<any>} Response containing "action".
   */
  assignFloatingIP(id, body) {
    return this._request(`/floating_ips/${id}/actions/assign`, {
      method: 'POST',
      body,
    });
  }

  /**
   * Unassign a Floating IP (POST /floating_ips/{id}/actions/unassign).
   * @param {number|string} id Floating IP ID to unassign.
   * @returns {Promise<any>} Response containing "action".
   */
  unassignFloatingIP(id) {
    return this._request(`/floating_ips/${id}/actions/unassign`, {
      method: 'POST',
      body: {},
    });
  }

  /**
   * Change reverse DNS (PTR) (POST /floating_ips/{id}/actions/change_dns_ptr).
   * @param {number|string} id Floating IP ID whose PTR to modify.
   * @param {import('./typedefs.js').ChangeDNSPtrBody} body Object containing the exact IP and dns_ptr to set.
   * @returns {Promise<any>} Response containing "action".
   */
  changeFloatingIPDNSPtr(id, body) {
    return this._request(`/floating_ips/${id}/actions/change_dns_ptr`, {
      method: 'POST',
      body,
    });
  }

  /**
   * Change protection (POST /floating_ips/{id}/actions/change_protection).
   * @param {number|string} id Floating IP ID whose protection to change.
   * @param {import('./typedefs.js').ChangeFloatingIPProtectionBody} body Object with the delete protection flag.
   * @returns {Promise<any>} Response containing "action".
   */
  changeFloatingIPProtection(id, body) {
    return this._request(`/floating_ips/${id}/actions/change_protection`, {
      method: 'POST',
      body,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────────
  // SSH KEYS
  // ───────────────────────────────────────────────────────────────────────────────

  /**
   * List SSH keys (single page).
   * @param {import('./typedefs.js').ListSSHKeysOptions} [opts] Filtering, sorting, and pagination options.
   * @returns {Promise<any>} Response containing "ssh_keys" and "meta.pagination".
   */
  listSSHKeys({
    sort,
    name,
    fingerprint,
    label_selector,
    page = 1,
    per_page = 25,
  } = {}) {
    return this._request('/ssh_keys', {
      query: { sort, name, fingerprint, label_selector, page, per_page },
    });
  }

  /**
   * Iterate all SSH keys.
   * @param {Omit<import('./typedefs.js').ListSSHKeysOptions,'page'|'per_page'> & { per_page?: number }} [opts] Filters and per_page to control pagination.
   * @yields {any} Each SSH key object.
   */
  async *iterateSSHKeys({
    sort,
    name,
    fingerprint,
    label_selector,
    per_page = 50,
  } = {}) {
    yield* this._paginate('/ssh_keys', {
      sort,
      name,
      fingerprint,
      label_selector,
      per_page,
    });
  }

  /**
   * Create an SSH key (POST /ssh_keys).
   * @param {import('./typedefs.js').CreateSSHKeyPayload} payload Object containing name, public_key, and optional labels.
   * @returns {Promise<any>} Response containing "ssh_key".
   */
  createSSHKey(payload) {
    return this._request('/ssh_keys', { method: 'POST', body: payload });
  }

  /**
   * Get an SSH key by ID (GET /ssh_keys/{id}).
   * @param {number|string} id SSH key ID to retrieve.
   * @returns {Promise<any>} Response containing "ssh_key".
   */
  getSSHKey(id) {
    return this._request(`/ssh_keys/${id}`);
  }

  /**
   * Update an SSH key (PUT /ssh_keys/{id}).
   * @param {number|string} id SSH key ID to update.
   * @param {import('./typedefs.js').UpdateSSHKeyBody} body Fields to update (name and/or labels).
   * @returns {Promise<any>} Response containing "ssh_key".
   */
  updateSSHKey(id, body) {
    return this._request(`/ssh_keys/${id}`, { method: 'PUT', body });
  }

  /**
   * Delete an SSH key (DELETE /ssh_keys/{id}).
   * @param {number|string} id SSH key ID to delete.
   * @returns {Promise<any>} For 204 responses returns { ok: true }.
   */
  deleteSSHKey(id) {
    return this._request(`/ssh_keys/${id}`, { method: 'DELETE' });
  }

  /**
   * Ensure an SSH key with the given name exists; create it if missing.
   * @param {import('./typedefs.js').CreateSSHKeyPayload} payload Name + OpenSSH public_key and optional labels.
   * @returns {Promise<any>} The SSH key object (same shape as "ssh_key").
   */
  async ensureSSHKey(payload) {
    try {
      const created = await this.createSSHKey(payload);
      return created?.ssh_key ?? null;
    } catch (err) {
      if (isHetznerError(err) && err.code === 'uniqueness_error') {
        const page = await this.listSSHKeys({
          name: payload.name,
          per_page: 50,
        });
        const found =
          page?.ssh_keys?.find(
            (/** @type {{ name: string }} */ k) => k?.name === payload.name,
          ) || null;
        if (found) return found;
      }
      throw err;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────────
  // SERVERS (CRUD + Metrics)
  // ───────────────────────────────────────────────────────────────────────────────

  /**
   * List servers (single page).
   * @param {import('./typedefs.js').ListServersOptions} [opts] Filtering, sorting, and pagination options.
   * @returns {Promise<any>} Raw response including "servers" and "meta.pagination".
   */
  listServers({ page = 1, per_page = 25, label_selector, sort } = {}) {
    return this._request('/servers', {
      query: { page, per_page, label_selector, sort },
    });
  }

  /**
   * Iterate servers across all pages.
   * @param {import('./typedefs.js').IterateServersOptions} [opts] Options controlling pagination and filtering.
   * @yields {any} Each server object.
   */
  async *iterateServers({ per_page = 50, label_selector, sort } = {}) {
    yield* this._paginate('/servers', { per_page, label_selector, sort });
  }

  /**
   * Retrieve a single server.
   * @param {number|string} id Numeric ID or string-compatible identifier of the server.
   * @returns {Promise<any>} Raw response containing a "server" object.
   */
  getServer(id) {
    return this._request(`/servers/${id}`);
  }

  /**
   * Create a server via POST /servers.
   * @param {import('./typedefs.js').CreateServerPayload} payload Complete server creation payload.
   * @returns {Promise<any>} Response with "server", "action", "next_actions" and optionally "root_password".
   */
  createServer(payload) {
    return this._request('/servers', { method: 'POST', body: payload });
  }

  /**
   * Update server name and/or labels via PUT /servers/{id}.
   * @param {number|string} id Numeric ID or string-compatible identifier of the server.
   * @param {{ name?: string, labels?: Record<string,string> }} body Fields to update on the server.
   * @returns {Promise<any>} Response containing the updated "server" object.
   */
  updateServer(id, body) {
    return this._request(`/servers/${id}`, { method: 'PUT', body });
  }

  /**
   * Delete a server via DELETE /servers/{id}.
   * @param {number|string} id Numeric ID or string-compatible identifier of the server.
   * @returns {Promise<any>} Response containing an "action" describing deletion progress.
   */
  deleteServer(id) {
    return this._request(`/servers/${id}`, { method: 'DELETE' });
  }

  /**
   * Get server metrics for cpu, disk, or network.
   * @param {number|string} id Numeric ID or string-compatible identifier of the server.
   * @param {import('./typedefs.js').ServerMetricsParams} params Metric type and time range parameters.
   * @returns {Promise<any>} Response containing a "metrics" object with time series.
   */
  getServerMetrics(id, { type, start, end, step }) {
    return this._request(`/servers/${id}/metrics`, {
      query: { type, start, end, step },
    });
  }

  // ───────────────────────────────────────────────────────────────────────────────
  // SERVER ACTIONS (Global + Per-Server + Lifecycle)
  // ───────────────────────────────────────────────────────────────────────────────

  /**
   * List actions across all servers (GET /servers/actions).
   * @param {import('./typedefs.js').ListServerActionsOptions} [opts] Filters, sorters, and pagination options.
   * @returns {Promise<any>} Response containing "actions" and "meta.pagination".
   */
  listServerActions({ id, status, sort, page = 1, per_page = 25 } = {}) {
    return this._request('/servers/actions', {
      query: { id, status, sort, page, per_page },
    });
  }

  /**
   * Get a single server action by ID (GET /servers/actions/{id}).
   * @param {number|string} actionId Unique action ID to fetch.
   * @returns {Promise<any>} Response containing "action".
   */
  getServerAction(actionId) {
    return this._request(`/servers/actions/${actionId}`);
  }

  /**
   * List actions for a specific server (GET /servers/{id}/actions).
   * @param {number|string} id Server ID whose actions to list.
   * @param {import('./typedefs.js').ListServerActionsForResourceOptions} [opts] Filters, sorters, and pagination options.
   * @returns {Promise<any>} Response containing "actions" and "meta.pagination".
   */
  listActionsForServer(id, { status, sort, page = 1, per_page = 25 } = {}) {
    return this._request(`/servers/${id}/actions`, {
      query: { status, sort, page, per_page },
    });
  }

  /**
   * Get a specific action for a server (GET /servers/{id}/actions/{action_id}).
   * @param {number|string} id Server ID that the action belongs to.
   * @param {number|string} actionId Action ID to fetch.
   * @returns {Promise<any>} Response containing "action".
   */
  getActionForServer(id, actionId) {
    return this._request(`/servers/${id}/actions/${actionId}`);
  }

  /**
   * Power off (hard stop) a server (POST /servers/{id}/actions/poweroff).
   * @param {number|string} id Server ID to power off.
   * @returns {Promise<any>} Response containing "action".
   */
  powerOffServer(id) {
    return this._request(`/servers/${id}/actions/poweroff`, {
      method: 'POST',
      body: {},
    });
  }

  /**
   * Power on a server (POST /servers/{id}/actions/poweron).
   * @param {number|string} id Server ID to power on.
   * @returns {Promise<any>} Response containing "action".
   */
  powerOnServer(id) {
    return this._request(`/servers/${id}/actions/poweron`, {
      method: 'POST',
      body: {},
    });
  }

  /**
   * Soft-reboot a server via ACPI (POST /servers/{id}/actions/reboot).
   * @param {number|string} id Server ID to reboot.
   * @returns {Promise<any>} Response containing "action".
   */
  rebootServer(id) {
    return this._request(`/servers/${id}/actions/reboot`, {
      method: 'POST',
      body: {},
    });
  }

  /**
   * Hard reset a server (POST /servers/{id}/actions/reset).
   * @param {number|string} id Server ID to reset.
   * @returns {Promise<any>} Response containing "action".
   */
  resetServer(id) {
    return this._request(`/servers/${id}/actions/reset`, {
      method: 'POST',
      body: {},
    });
  }

  /**
   * Shutdown a server gracefully via ACPI (POST /servers/{id}/actions/shutdown).
   * @param {number|string} id Server ID to shut down.
   * @returns {Promise<any>} Response containing "action".
   */
  shutdownServer(id) {
    return this._request(`/servers/${id}/actions/shutdown`, {
      method: 'POST',
      body: {},
    });
  }

  /**
   * Reset root password (POST /servers/{id}/actions/reset_password).
   * @param {number|string} id Server ID whose root password to reset.
   * @returns {Promise<{ root_password: string, action: any }>} New password and the corresponding action.
   */
  resetServerPassword(id) {
    return this._request(`/servers/${id}/actions/reset_password`, {
      method: 'POST',
      body: {},
    });
  }

  /**
   * Request a temporary VNC-over-WebSocket console (POST /servers/{id}/actions/request_console).
   * @param {number|string} id Server ID for which to request console credentials.
   * @returns {Promise<{ wss_url: string, password: string, action: any }>} Short-lived wss_url, password, and action.
   */
  requestServerConsole(id) {
    return this._request(`/servers/${id}/actions/request_console`, {
      method: 'POST',
      body: {},
    });
  }

  /**
   * Options for waiting until a server is ready.
   * @param {number|string} id Server ID to wait for.
   * @param {import('./typedefs.js').WaitServerOptions} [opts] Control polling and readiness conditions.
   * @returns {Promise<any>} The final server object once running.
   */
  async waitForServerRunning(
    id,
    { intervalMs = 2000, timeoutMs = 15 * 60 * 1000, requireIPv4 = true } = {},
  ) {
    const start = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await this.getServer(id);
      const srv = res && res.server ? res.server : null;
      if (!srv) return res;

      const running = srv.status === 'running';
      const hasIPv4 = !!srv.public_net?.ipv4?.ip;

      if (running && (!requireIPv4 || hasIPv4)) {
        return srv;
      }

      if (Date.now() - start > timeoutMs) {
        throw new Error(`waitForServerRunning timeout for server ${id}`);
      }
      await sleep(intervalMs);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────────
  // CREATE & INSTALL SYSTEMD SERVICE ON FIRST BOOT
  // ───────────────────────────────────────────────────────────────────────────────

  /**
   * Create a server and install your executable as a persistent systemd service.
   * @param {import('./typedefs.js').CreateAndRunServiceOptions} options Server creation and service installation configuration.
   * @returns {Promise<{ create: any, server: any }>} Raw create response and the created server object.
   */
  async createServerAndInstallService(options) {
    const {
      server,
      exec,
      wait_for_action = true,
      wait_for_running = true,
      wait_for_ipv4 = true,
      intervalMs = 2000,
      timeoutMs = 15 * 60 * 1000,
    } = options;

    if (!server || !server.name || !server.server_type || !server.image) {
      throw new Error('server {name, server_type, image} are required');
    }

    const userData = this._buildCloudInitForSystemd(exec);
    /** @type {import('./typedefs.js').CreateServerPayload} */
    const payload = {
      ...server,
      user_data: this._mergeUserData(server.user_data, userData),
    };

    const create = await this.createServer(payload);
    const id = create?.server?.id ?? null;

    if (wait_for_action && create?.action?.id != null) {
      await this.waitForAction(create.action.id, { intervalMs, timeoutMs });
    }

    if (wait_for_running && id != null) {
      await this.waitForServerRunning(id, {
        intervalMs,
        timeoutMs,
        requireIPv4: wait_for_ipv4,
      });
    }

    return { create, server: create?.server ?? null };
  }

  /**
   * Build cloud-init that places the executable, writes a systemd unit, enables and starts it.
   * @private
   * @param {Required<Pick<import('./typedefs.js').CreateAndRunServiceOptions,'exec'>>['exec']} exec Executable and service parameters.
   * @returns {string} Cloud-init user-data in cloud-config form.
   */
  _buildCloudInitForSystemd(exec) {
    // ... (unchanged runtime, omitted for brevity)
    // keep the original function body intact
    const remotePath = exec.remote_path || '/usr/local/bin/app';
    const svcName = exec.service_name || 'app';
    const unitPath = `/etc/systemd/system/${svcName}.service`;
    const user = exec.user || 'root';
    const group = exec.group || user;
    const type = exec.type || 'simple';
    const restart = exec.restart || 'always';
    const restartSec = Number.isFinite(exec.restart_sec) ? exec.restart_sec : 3;
    const wantsNet = exec.wantsNetworkOnline !== false;
    const args = Array.isArray(exec.args) ? exec.args : [];
    const env = exec.env || {};
    const stdoutLog = exec.stdout_log || `/var/log/${svcName}.stdout.log`;
    const stderrLog = exec.stderr_log || `/var/log/${svcName}.stderr.log`;

    /** @type {Array<Record<string, unknown>>} */
    const writeFiles = [];

    if (exec.inline_b64) {
      writeFiles.push({
        path: remotePath,
        permissions: '0755',
        encoding: 'b64',
        content: exec.inline_b64,
      });
    }

    const envFilePath = `/etc/${svcName}.env`;
    const envContent = Object.keys(env).length
      ? Object.entries(env)
          .map(([k, v]) => `${k}=${escapeShell(String(v))}`)
          .join('\n') + '\n'
      : '';
    if (envContent) {
      writeFiles.push({
        path: envFilePath,
        permissions: '0644',
        content: envContent,
      });
    }

    const argStr = args.map((a) => shellArg(String(a))).join(' ');
    const execStartCmd = `${shellArg(remotePath)}${
      argStr ? ' ' + argStr : ''
    } >> ${shellArg(stdoutLog)} 2>> ${shellArg(stderrLog)}`;
    const unitText = [
      '[Unit]',
      `Description=${svcName} service`,
      wantsNet ? 'Wants=network-online.target' : '',
      wantsNet ? 'After=network-online.target' : '',
      '',
      '[Service]',
      `Type=${type}`,
      `User=${user}`,
      `Group=${group}`,
      envContent ? `EnvironmentFile=${envFilePath}` : '',
      `ExecStart=/bin/sh -lc ${shellArg(execStartCmd)}`,
      'Restart=' + restart,
      'RestartSec=' + String(restartSec),
      'LimitNOFILE=1048576',
      'NoNewPrivileges=true',
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      '',
    ]
      .filter(Boolean)
      .join('\n');

    writeFiles.push({
      path: unitPath,
      permissions: '0644',
      content: unitText,
    });

    /** @type {Array<string|Array<string>>} */
    const runcmd = [];

    if (exec.url) {
      runcmd.push([
        'sh',
        '-c',
        'command -v curl >/dev/null 2>&1 || (apt-get update && apt-get install -y curl) || true',
      ]);
      runcmd.push([
        'sh',
        '-c',
        `curl -fsSL ${shellArg(exec.url)} -o ${shellArg(remotePath)}`,
      ]);
      runcmd.push(['chmod', '0755', remotePath]);
    } else if (!exec.inline_b64) {
      runcmd.push([
        'sh',
        '-c',
        `echo "No exec.url or exec.inline_b64 provided" >&2`,
      ]);
    } else {
      runcmd.push(['chmod', '0755', remotePath]);
    }

    runcmd.push([
      'sh',
      '-c',
      `install -o ${shellArg(user)} -g ${shellArg(
        group,
      )} -m 0644 /dev/null ${shellArg(stdoutLog)} ${shellArg(
        stderrLog,
      )} || true`,
    ]);
    runcmd.push(['systemctl', 'daemon-reload']);
    runcmd.push(['systemctl', 'enable', `${svcName}.service`]);
    runcmd.push(['systemctl', 'start', `${svcName}.service`]);

    return toCloudConfigYAML({ runcmd, write_files: writeFiles });
  }

  // ───────────────────────────────────────────────────────────────────────────────
  // CREATE & RUN EXECUTABLE (cloud-init)
  // ───────────────────────────────────────────────────────────────────────────────

  /**
   * Create a server and run an executable on first boot via cloud-init.
   * @param {import('./typedefs.js').CreateAndRunOptions} options Server creation and execution configuration.
   * @returns {Promise<{ create: any, server: any }>} Object with raw create response and the created server.
   */
  async createServerAndRun(options) {
    const { server, exec, wait_for_action = true } = options;

    if (!server || !server.name || !server.server_type || !server.image) {
      throw new Error('server {name, server_type, image} are required');
    }

    const userData = this._buildCloudInitForExec(exec);
    /** @type {import('./typedefs.js').CreateServerPayload} */
    const payload = {
      ...server,
      user_data: this._mergeUserData(server.user_data, userData),
    };

    const create = await this.createServer(payload);

    if (
      wait_for_action &&
      create &&
      create.action &&
      create.action.id != null
    ) {
      await this.waitForAction(create.action.id);
    }

    const srv = create && create.server ? create.server : null;
    return { create, server: srv };
  }

  /**
   * Build cloud-init YAML that installs and runs the executable.
   * @private
   * @param {Required<Pick<import('./typedefs.js').CreateAndRunOptions,'exec'>>['exec']} exec Executable shipping and runtime configuration.
   * @returns {string} Cloud-init user-data in cloud-config YAML form.
   */
  _buildCloudInitForExec(exec) {
    // (body unchanged)
    const remotePath = exec.remote_path || '/root/app.bin';
    const stdout = exec.stdout || '/var/log/hx-exec.out';
    const user = exec.user || 'root';
    const args = Array.isArray(exec.args) ? exec.args : [];
    const env = exec.env || {};
    const background = exec.background !== false;

    /** @type {Array<Record<string, unknown>>} */
    const writeFiles = [];

    if (exec.inline_b64) {
      writeFiles.push({
        path: remotePath,
        permissions: '0755',
        encoding: 'b64',
        content: exec.inline_b64,
      });
    }

    const envFilePath = '/etc/hx-exec.env';
    const envContent = Object.keys(env).length
      ? Object.entries(env)
          .map(([k, v]) => `${k}=${escapeShell(String(v))}`)
          .join('\n') + '\n'
      : '';
    if (envContent) {
      writeFiles.push({
        path: envFilePath,
        permissions: '0644',
        content: envContent,
      });
    }

    /** @type {Array<string|Array<string>>} */
    const runcmd = [];

    if (exec.url) {
      runcmd.push([
        'sh',
        '-c',
        'command -v curl >/dev/null 2>&1 || apt-get update && apt-get install -y curl || true',
      ]);
      runcmd.push([
        'sh',
        '-c',
        `curl -fsSL ${shellArg(exec.url)} -o ${shellArg(remotePath)}`,
      ]);
      runcmd.push(['chmod', '+x', remotePath]);
    }

    const envExport = envContent
      ? `set -a && . ${envFilePath} && set +a && `
      : '';
    const argStr = args.map((a) => shellArg(String(a))).join(' ');
    const cmd = `${envExport}sudo -u ${shellArg(user)} ${shellArg(remotePath)}${
      argStr ? ' ' + argStr : ''
    }`;
    const runLine = background
      ? `${cmd} >> ${shellArg(stdout)} 2>&1 < /dev/null &`
      : `${cmd} >> ${shellArg(stdout)} 2>&1`;
    runcmd.push(['sh', '-c', runLine]);

    return toCloudConfigYAML({ runcmd, write_files: writeFiles });
  }

  /**
   * Merge original user_data with our cloud-config section.
   * @private
   * @param {string|undefined} original Existing user_data provided by the caller (cloud-config or raw shell).
   * @param {string} ours Cloud-config YAML generated by this client.
   * @returns {string} Combined user_data suitable for Hetzner API.
   */
  _mergeUserData(original, ours) {
    if (!original) return ours;
    if (original.trim().startsWith('#cloud-config')) {
      return `${original.trim()}\n---\n${ours.trim()}\n`;
    }
    const wrapped = toCloudConfigYAML({
      runcmd: [['sh', '-c', original]],
    });
    return `${wrapped.trim()}\n---\n${ours.trim()}\n`;
  }

  // ───────────────────────────────────────────────────────────────────────────────
  // DESTRUCTIVE HELPERS
  // ───────────────────────────────────────────────────────────────────────────────

  /**
   * Terminate and delete a server ASAP.
   * @param {number|string} serverId Numeric ID (or stringy) of the server to nuke.
   * @param {import('./typedefs.js').TerminateServerFastOptions} [opts] Behavior tuning for waiting/polling.
   * @returns {Promise<{ deleteAction?: any }>} Deleted FIP IDs and optional final delete action.
   */
  async terminateServerFast(
    serverId,
    { wait = true, intervalMs = 2000, timeoutMs = 15 * 60 * 1000 } = {},
  ) {
    await this.powerOffServer(serverId);
    const delRes = await this.deleteServer(serverId);
    const deleteActionId =
      delRes && delRes.action && delRes.action.id != null
        ? delRes.action.id
        : null;

    if (wait && deleteActionId != null) {
      await this.waitForAction(deleteActionId, { intervalMs, timeoutMs });
    }

    return {
      deleteAction:
        deleteActionId != null
          ? await this._request(`/actions/${deleteActionId}`)
          : undefined,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────────
  // ACTIONS / POLLING
  // ───────────────────────────────────────────────────────────────────────────────

  /**
   * Poll a Hetzner action until completion or timeout.
   * @param {number} actionId Action identifier returned by the API.
   * @param {{ intervalMs?: number, timeoutMs?: number }} [opts] Polling cadence and overall timeout.
   * @returns {Promise<any>} Final action response (status "success" or "error").
   */
  async waitForAction(
    actionId,
    { intervalMs = 2000, timeoutMs = 15 * 60 * 1000 } = {},
  ) {
    const start = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await this._request(`/actions/${actionId}`);
      const action = res && res.action ? res.action : null;
      if (!action) return res;
      if (action.status === 'success' || action.status === 'error') return res;
      if (Date.now() - start > timeoutMs)
        throw new Error(`waitForAction timeout for action ${actionId}`);
      await sleep(intervalMs);
    }
  }

  /**
   * Retrieve the primary public IPv4 of a server if present.
   * @param {number|string} id Numeric ID or string-compatible identifier of the server.
   * @returns {Promise<string|null>} IPv4 address string or null if absent.
   */
  async getServerIPv4(id) {
    const res = await this.getServer(id);
    const ip = res?.server?.public_net?.ipv4?.ip;
    return ip || null;
  }

  // ───────────────────────────────────────────────────────────────────────────────
  // HTTP & INTERNAL HELPERS
  // ───────────────────────────────────────────────────────────────────────────────

  /**
   * Low-level request wrapper with JSON parsing and error mapping.
   * @param {string} path Absolute or relative API path (e.g., "/servers").
   * @param {import('./typedefs.js').HetznerRequestOptions} [opts] HTTP method, query, headers, and body options.
   * @returns {Promise<any>} Parsed JSON payload or text response for non-JSON.
   * @throws {HetznerError} When the API returns a non-2xx status code.
   */
  async _request(path, { method = 'GET', query, body, headers } = {}) {
    const url = this._buildUrl(path, this._normalizeQuery(query));
    const init = {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(headers || {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    };

    const res = await fetch(url, init);

    const rate = this._readRateHeaders(res);
    if (rate) this._lastRate = rate;

    if (res.status === 204) return { ok: true };

    const ctype = res.headers.get('content-type') || '';
    const isJson = ctype.includes('application/json');
    const payload = isJson ? await res.json() : await res.text();

    if (!res.ok) {
      const errObj = isJson && payload && payload.error ? payload.error : {};
      throw new HetznerError({
        status: res.status,
        code: errObj.code || 'http_error',
        message: errObj.message || String(payload || res.statusText),
        details: errObj.details,
        rate,
      });
    }

    return payload;
  }

  /**
   * Internal paginator yielding items from array-bearing responses.
   * @param {string} path API path to a collection endpoint.
   * @param {Record<string, unknown>} [baseQuery] Query parameters persisted across pages.
   * @yields {any} Each item from the collection across all pages.
   */
  async *_paginate(path, baseQuery = {}) {
    let page = 1;
    let next = true;
    while (next) {
      const data = await this._request(path, {
        query: { ...baseQuery, page, per_page: baseQuery.per_page ?? 50 },
      });
      const arrayKey = Object.keys(data).find((k) => Array.isArray(data[k]));
      if (!arrayKey) return;
      for (const item of data[arrayKey]) yield item;
      const meta = data.meta && data.meta.pagination;
      if (meta && meta.next_page) {
        page = /** @type {number} */ (meta.next_page);
      } else {
        next = false;
      }
    }
  }

  /**
   * Build an absolute URL with optional query parameters.
   * Repeats any array value as multiple query keys (?k=v1&k=v2).
   * @param {string} path Absolute or relative API path.
   * @param {Record<string, unknown>|undefined} query Map of query parameter names to values.
   * @returns {string} Fully-qualified URL string.
   */
  _buildUrl(path, query) {
    const u = new URL(
      path.startsWith('http') ? path : `${this.baseUrl}${path}`,
    );
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === '') continue;
        if (Array.isArray(v)) {
          for (const val of v) {
            if (val === undefined || val === null || val === '') continue;
            u.searchParams.append(k, String(val));
          }
        } else {
          u.searchParams.set(k, String(v));
        }
      }
    }
    return u.toString();
  }

  /**
   * Normalize query object for serialization.
   * @param {Record<string, unknown>|undefined} query Raw query object from callers.
   * @returns {Record<string, unknown>|undefined} Normalized copy or undefined if falsy.
   */
  _normalizeQuery(query) {
    if (!query) return undefined;
    return { ...query };
  }

  /**
   * Parse rate-limit headers from a Response.
   * @param {Response} res Fetch Response returned by the HTTP call.
   * @returns {import('./typedefs.js').HetznerRate|null} Parsed rate information or null when absent.
   */
  _readRateHeaders(res) {
    const limit = res.headers.get('RateLimit-Limit');
    const remaining = res.headers.get('RateLimit-Remaining');
    const reset = res.headers.get('RateLimit-Reset');
    if (limit || remaining || reset) {
      return {
        limit: limit ? Number(limit) : null,
        remaining: remaining ? Number(remaining) : null,
        reset: reset ? Number(reset) : null,
      };
    }
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────────────
// SMALL HELPERS (no deps)
// ───────────────────────────────────────────────────────────────────────────────────

/**
 * Serialize a minimal cloud-config structure focusing on write_files and runcmd.
 * @param {{ write_files?: Array<Record<string, unknown>>, runcmd: Array<string|Array<string>> }} obj Cloud-config subset to serialize.
 * @returns {string} Cloud-config document starting with "#cloud-config".
 */
function toCloudConfigYAML(obj) {
  const lines = ['#cloud-config'];
  if (obj.write_files && obj.write_files.length) {
    lines.push('write_files:');
    for (const wf of obj.write_files) {
      lines.push('  - path: ' + String(wf.path));
      if (wf.permissions)
        lines.push('    permissions: ' + String(wf.permissions));
      if (wf.encoding) lines.push('    encoding: ' + String(wf.encoding));
      if (typeof wf.content === 'string' && wf.encoding === 'b64') {
        lines.push('    content: ' + wf.content);
      } else if (typeof wf.content === 'string') {
        lines.push('    content: |');
        for (const ln of wf.content.split('\n')) lines.push('      ' + ln);
      }
    }
  }
  lines.push('runcmd:');
  for (const cmd of obj.runcmd) {
    if (Array.isArray(cmd)) {
      const rendered = cmd
        .map((c) =>
          typeof c === 'string' ? JSON.stringify(c) : JSON.stringify(String(c)),
        )
        .join(', ');
      lines.push(`  - [${rendered}]`);
    } else if (typeof cmd === 'string') {
      lines.push('  - ' + JSON.stringify(cmd));
    }
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Quote a single shell argument safely.
 * @param {string} s Unquoted shell argument.
 * @returns {string} Safely quoted shell argument.
 */
function shellArg(s) {
  if (s === '') return "''";
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Escape a string for inclusion in simple KEY=value lines.
 * @param {string} s Raw environment variable value.
 * @returns {string} Sanitized value without newlines.
 */
function escapeShell(s) {
  return s.replace(/\n/g, '');
}

/**
 * Sleep for a number of milliseconds (promise-based).
 * @param {number} ms Milliseconds to delay.
 * @returns {Promise<void>} Promise that resolves when the delay elapses.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { HetznerCloud, HetznerError };
