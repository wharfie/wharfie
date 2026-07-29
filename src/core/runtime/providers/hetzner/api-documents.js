const INVALID_DOCUMENT = 'Hetzner API response document is invalid.';

/**
 * @param {unknown} value - Candidate object.
 * @returns {value is Record<string, any>} - Whether the value is an object.
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value - Candidate finite number.
 * @returns {number} - Validated number.
 */
function numberValue(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(INVALID_DOCUMENT);
  }
  return value;
}

/**
 * @param {unknown} value - Candidate provider identifier.
 * @returns {number} - Validated identifier.
 */
function identifier(value) {
  const id = numberValue(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new TypeError(INVALID_DOCUMENT);
  }
  return id;
}

/**
 * @param {unknown} value - Candidate non-empty string.
 * @returns {string} - Validated string.
 */
function nonEmptyString(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(INVALID_DOCUMENT);
  }
  return value;
}

/**
 * @param {unknown} value - Candidate optional string.
 * @returns {string|null} - Validated optional string.
 */
function optionalString(value) {
  if (value === null || value === undefined) return null;
  return nonEmptyString(value);
}

/**
 * @param {unknown} value - Candidate string labels.
 * @returns {Readonly<Record<string, string>>} - Frozen label snapshot.
 */
function labels(value) {
  if (!isObject(value)) throw new TypeError(INVALID_DOCUMENT);
  /** @type {Record<string, string>} */
  const result = Object.create(null);
  for (const [key, labelValue] of Object.entries(value)) {
    if (typeof labelValue !== 'string') throw new TypeError(INVALID_DOCUMENT);
    result[key] = labelValue;
  }
  return Object.freeze(result);
}

/**
 * @param {unknown} value - Candidate string list.
 * @returns {Readonly<string[]>} - Frozen string list.
 */
function stringList(value) {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    throw new TypeError(INVALID_DOCUMENT);
  }
  return Object.freeze([...value]);
}

/**
 * @param {unknown} value - Candidate deprecation information.
 * @returns {Readonly<{announced: string, unavailableAfter: string}>|null} - Deprecation.
 */
function deprecation(value) {
  if (value === null) return null;
  if (!isObject(value)) throw new TypeError(INVALID_DOCUMENT);
  return Object.freeze({
    announced: nonEmptyString(value.announced),
    unavailableAfter: nonEmptyString(value.unavailable_after),
  });
}

/**
 * @param {unknown} value - Candidate resource reference.
 * @returns {Readonly<{id: number, name: string|null}>|null} - Reference.
 */
function resourceReference(value) {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) throw new TypeError(INVALID_DOCUMENT);
  return Object.freeze({
    id: identifier(value.id),
    name: optionalString(value.name),
  });
}

/**
 * @param {unknown} value - Candidate location.
 * @returns {Readonly<{id: number, name: string, city: string, country: string, networkZone: string}>} - Location.
 */
export function decodeHetznerLocation(value) {
  if (!isObject(value)) throw new TypeError(INVALID_DOCUMENT);
  return Object.freeze({
    id: identifier(value.id),
    name: nonEmptyString(value.name),
    city: nonEmptyString(value.city),
    country: nonEmptyString(value.country),
    networkZone: nonEmptyString(value.network_zone),
  });
}

/**
 * @param {unknown} value - Candidate server-type location evidence.
 * @returns {Readonly<{id: number, name: string, available: boolean, recommended: boolean, deprecation: Readonly<{announced: string, unavailableAfter: string}>|null}>} - Location availability.
 */
function serverTypeLocation(value) {
  if (
    !isObject(value) ||
    typeof value.available !== 'boolean' ||
    typeof value.recommended !== 'boolean' ||
    !Object.hasOwn(value, 'deprecation')
  ) {
    throw new TypeError(INVALID_DOCUMENT);
  }
  return Object.freeze({
    id: identifier(value.id),
    name: nonEmptyString(value.name),
    available: value.available,
    recommended: value.recommended,
    deprecation: deprecation(value.deprecation),
  });
}

/**
 * @param {unknown} value - Candidate server type.
 * @returns {Readonly<{id: number, name: string, architecture: string, cores: number, memory: number, disk: number, locations: Readonly<ReturnType<typeof serverTypeLocation>[]>}>} - Server type.
 */
export function decodeHetznerServerType(value) {
  if (!isObject(value) || !Array.isArray(value.locations)) {
    throw new TypeError(INVALID_DOCUMENT);
  }
  return Object.freeze({
    id: identifier(value.id),
    name: nonEmptyString(value.name),
    architecture: nonEmptyString(value.architecture),
    cores: numberValue(value.cores),
    memory: numberValue(value.memory),
    disk: numberValue(value.disk),
    locations: Object.freeze(value.locations.map(serverTypeLocation)),
  });
}

/**
 * @param {unknown} value - Candidate image.
 * @returns {Readonly<{id: number, name: string|null, description: string, type: string, status: string, architecture: string, osFlavor: string, osVersion: string|null, rapidDeploy: boolean, deprecatedAt: string|null}>} - Image.
 */
export function decodeHetznerImage(value) {
  if (
    !isObject(value) ||
    typeof value.rapid_deploy !== 'boolean' ||
    !Object.hasOwn(value, 'deprecated')
  ) {
    throw new TypeError(INVALID_DOCUMENT);
  }
  return Object.freeze({
    id: identifier(value.id),
    name: optionalString(value.name),
    description: nonEmptyString(value.description),
    type: nonEmptyString(value.type),
    status: nonEmptyString(value.status),
    architecture: nonEmptyString(value.architecture),
    osFlavor: nonEmptyString(value.os_flavor),
    osVersion: optionalString(value.os_version),
    rapidDeploy: value.rapid_deploy,
    deprecatedAt: optionalString(value.deprecated),
  });
}

/**
 * @param {unknown} value - Candidate firewall rule.
 * @returns {Readonly<{direction: string, sourceIps: Readonly<string[]>, destinationIps: Readonly<string[]>, protocol: string, port: string|null, description: string|null}>} - Rule.
 */
function firewallRule(value) {
  if (!isObject(value)) throw new TypeError(INVALID_DOCUMENT);
  return Object.freeze({
    direction: nonEmptyString(value.direction),
    sourceIps: stringList(value.source_ips),
    destinationIps: stringList(value.destination_ips),
    protocol: nonEmptyString(value.protocol),
    port: optionalString(value.port),
    description: optionalString(value.description),
  });
}

/**
 * @param {unknown} value - Candidate firewall application target.
 * @param {number} [depth] - Current nesting depth.
 * @returns {Readonly<{type: string, serverId: number|null, labelSelector: string|null, appliedToResources: Readonly<any[]>}>} - Application target.
 */
function firewallResource(value, depth = 0) {
  if (!isObject(value) || depth > 4) {
    throw new TypeError(INVALID_DOCUMENT);
  }
  const nested = value.applied_to_resources ?? [];
  if (!Array.isArray(nested)) throw new TypeError(INVALID_DOCUMENT);
  const type = nonEmptyString(value.type);
  let serverId = null;
  let labelSelector = null;
  if (type === 'server') {
    if (!isObject(value.server)) throw new TypeError(INVALID_DOCUMENT);
    serverId = identifier(value.server.id);
  } else if (type === 'label_selector') {
    if (!isObject(value.label_selector)) {
      throw new TypeError(INVALID_DOCUMENT);
    }
    labelSelector = nonEmptyString(value.label_selector.selector);
  } else {
    throw new TypeError(INVALID_DOCUMENT);
  }
  return Object.freeze({
    type,
    serverId,
    labelSelector,
    appliedToResources: Object.freeze(
      nested.map((item) => firewallResource(item, depth + 1)),
    ),
  });
}

/**
 * @param {unknown} value - Candidate firewall.
 * @returns {Readonly<{id: number, name: string, labels: Readonly<Record<string, string>>, rules: Readonly<ReturnType<typeof firewallRule>[]>, appliedTo: Readonly<ReturnType<typeof firewallResource>[]>}>} - Firewall.
 */
export function decodeHetznerFirewall(value) {
  if (
    !isObject(value) ||
    !Array.isArray(value.rules) ||
    !Array.isArray(value.applied_to)
  ) {
    throw new TypeError(INVALID_DOCUMENT);
  }
  return Object.freeze({
    id: identifier(value.id),
    name: nonEmptyString(value.name),
    labels: labels(value.labels),
    rules: Object.freeze(value.rules.map(firewallRule)),
    appliedTo: Object.freeze(value.applied_to.map(firewallResource)),
  });
}

/**
 * @param {unknown} value - Candidate primary IP.
 * @returns {Readonly<{id: number, name: string, ip: string, type: string, assigneeId: number|null, assigneeType: string, autoDelete: boolean, blocked: boolean, location: ReturnType<typeof decodeHetznerLocation>, labels: Readonly<Record<string, string>>, deleteProtected: boolean}>} - Primary IP.
 */
export function decodeHetznerPrimaryIp(value) {
  if (
    !isObject(value) ||
    typeof value.auto_delete !== 'boolean' ||
    typeof value.blocked !== 'boolean' ||
    !isObject(value.protection) ||
    typeof value.protection.delete !== 'boolean'
  ) {
    throw new TypeError(INVALID_DOCUMENT);
  }
  const assigneeId =
    value.assignee_id === null ? null : identifier(value.assignee_id);
  return Object.freeze({
    id: identifier(value.id),
    name: nonEmptyString(value.name),
    ip: nonEmptyString(value.ip),
    type: nonEmptyString(value.type),
    assigneeId,
    assigneeType: nonEmptyString(value.assignee_type),
    autoDelete: value.auto_delete,
    blocked: value.blocked,
    location: decodeHetznerLocation(value.location),
    labels: labels(value.labels),
    deleteProtected: value.protection.delete,
  });
}

/**
 * @param {unknown} value - Candidate server firewall state.
 * @returns {Readonly<{id: number, status: string}>} - Firewall state.
 */
function serverFirewall(value) {
  if (!isObject(value)) throw new TypeError(INVALID_DOCUMENT);
  return Object.freeze({
    id: identifier(value.id),
    status: nonEmptyString(value.status),
  });
}

/**
 * @param {unknown} value - Candidate server.
 * @returns {Readonly<{id: number, name: string, status: string, location: ReturnType<typeof decodeHetznerLocation>, publicIpv4: Readonly<{id: number, ip: string, blocked: boolean}>, publicIpv6: Readonly<{id: number, ip: string, blocked: boolean}>|null, firewalls: Readonly<ReturnType<typeof serverFirewall>[]>, serverType: Readonly<{id: number, name: string|null}>|null, image: Readonly<{id: number, name: string|null}>|null, labels: Readonly<Record<string, string>>, locked: boolean, deleteProtected: boolean}>} - Server.
 */
export function decodeHetznerServer(value) {
  if (
    !isObject(value) ||
    typeof value.locked !== 'boolean' ||
    !isObject(value.protection) ||
    typeof value.protection.delete !== 'boolean' ||
    !isObject(value.public_net) ||
    !isObject(value.public_net.ipv4) ||
    typeof value.public_net.ipv4.blocked !== 'boolean' ||
    (value.public_net.ipv6 !== null &&
      value.public_net.ipv6 !== undefined &&
      (!isObject(value.public_net.ipv6) ||
        typeof value.public_net.ipv6.blocked !== 'boolean')) ||
    !Array.isArray(value.public_net.firewalls)
  ) {
    throw new TypeError(INVALID_DOCUMENT);
  }
  return Object.freeze({
    id: identifier(value.id),
    name: nonEmptyString(value.name),
    status: nonEmptyString(value.status),
    location: decodeHetznerLocation(value.location),
    publicIpv4: Object.freeze({
      id: identifier(value.public_net.ipv4.id),
      ip: nonEmptyString(value.public_net.ipv4.ip),
      blocked: value.public_net.ipv4.blocked,
    }),
    publicIpv6:
      value.public_net.ipv6 === null || value.public_net.ipv6 === undefined
        ? null
        : Object.freeze({
            id: identifier(value.public_net.ipv6.id),
            ip: nonEmptyString(value.public_net.ipv6.ip),
            blocked: value.public_net.ipv6.blocked,
          }),
    firewalls: Object.freeze(value.public_net.firewalls.map(serverFirewall)),
    serverType: resourceReference(value.server_type),
    image: resourceReference(value.image),
    labels: labels(value.labels),
    locked: value.locked,
    deleteProtected: value.protection.delete,
  });
}

/**
 * @param {unknown} value - Candidate action.
 * @returns {Readonly<{id: number, status: string, error: Readonly<{code: string}>|null}>} - Action.
 */
export function decodeHetznerAction(value) {
  if (!isObject(value)) throw new TypeError(INVALID_DOCUMENT);
  let error = null;
  if (value.error !== null && value.error !== undefined) {
    if (!isObject(value.error)) throw new TypeError(INVALID_DOCUMENT);
    const code = nonEmptyString(value.error.code);
    if (code.length > 100 || !/^[a-z0-9_-]+$/i.test(code)) {
      throw new TypeError(INVALID_DOCUMENT);
    }
    error = Object.freeze({
      code,
    });
  }
  return Object.freeze({
    id: identifier(value.id),
    status: nonEmptyString(value.status),
    error,
  });
}

/**
 * @template T
 * @param {unknown} value - Candidate list document.
 * @param {string} key - Provider list key.
 * @param {(item: unknown) => T} decode - Item decoder.
 * @returns {Readonly<T[]>} - Frozen decoded list.
 */
function decodeList(value, key, decode) {
  if (!isObject(value) || !Array.isArray(value[key])) {
    throw new TypeError(INVALID_DOCUMENT);
  }
  return Object.freeze(value[key].map((item) => decode(item)));
}

/**
 * @template T
 * @param {unknown} value - Candidate single-resource document.
 * @param {string} key - Provider resource key.
 * @param {(item: unknown) => T} decode - Resource decoder.
 * @returns {T} - Decoded resource.
 */
function decodeSingle(value, key, decode) {
  if (!isObject(value) || !Object.hasOwn(value, key)) {
    throw new TypeError(INVALID_DOCUMENT);
  }
  return decode(value[key]);
}

/**
 * Decode and cross-check one official list pagination document.
 * @param {unknown} value - Candidate list response.
 * @returns {Readonly<{page: number, perPage: number, previousPage: number|null, nextPage: number|null, lastPage: number, totalEntries: number}>} - Pagination.
 */
export function decodeHetznerPagination(value) {
  if (
    !isObject(value) ||
    !isObject(value.meta) ||
    !isObject(value.meta.pagination)
  ) {
    throw new TypeError(INVALID_DOCUMENT);
  }
  const pagination = value.meta.pagination;
  const page = identifier(pagination.page);
  const perPage = identifier(pagination.per_page);
  const lastPage = identifier(pagination.last_page);
  const totalEntries = numberValue(pagination.total_entries);
  if (!Number.isSafeInteger(totalEntries) || totalEntries < 0) {
    throw new TypeError(INVALID_DOCUMENT);
  }
  /**
   * @param {unknown} candidate - Candidate nullable page.
   * @returns {number|null} - Page number.
   */
  const nullablePage = (candidate) => {
    if (candidate === null) return null;
    return identifier(candidate);
  };
  const previousPage = nullablePage(pagination.previous_page);
  const nextPage = nullablePage(pagination.next_page);
  if (
    page > lastPage ||
    (page === 1 ? previousPage !== null : previousPage !== page - 1) ||
    (page === lastPage ? nextPage !== null : nextPage !== page + 1)
  ) {
    throw new TypeError(INVALID_DOCUMENT);
  }
  return Object.freeze({
    page,
    perPage,
    previousPage,
    nextPage,
    lastPage,
    totalEntries,
  });
}

/**
 * @param {unknown} value - Locations response.
 * @returns {Readonly<ReturnType<typeof decodeHetznerLocation>[]>} - Locations.
 */
export function decodeHetznerLocationsResponse(value) {
  return decodeList(value, 'locations', decodeHetznerLocation);
}

/**
 * @param {unknown} value - Location response.
 * @returns {ReturnType<typeof decodeHetznerLocation>} - Location.
 */
export function decodeHetznerLocationResponse(value) {
  return decodeSingle(value, 'location', decodeHetznerLocation);
}

/**
 * @param {unknown} value - Server types response.
 * @returns {Readonly<ReturnType<typeof decodeHetznerServerType>[]>} - Types.
 */
export function decodeHetznerServerTypesResponse(value) {
  return decodeList(value, 'server_types', decodeHetznerServerType);
}

/**
 * @param {unknown} value - Server type response.
 * @returns {ReturnType<typeof decodeHetznerServerType>} - Server type.
 */
export function decodeHetznerServerTypeResponse(value) {
  return decodeSingle(value, 'server_type', decodeHetznerServerType);
}

/**
 * @param {unknown} value - Images response.
 * @returns {Readonly<ReturnType<typeof decodeHetznerImage>[]>} - Images.
 */
export function decodeHetznerImagesResponse(value) {
  return decodeList(value, 'images', decodeHetznerImage);
}

/**
 * @param {unknown} value - Image response.
 * @returns {ReturnType<typeof decodeHetznerImage>} - Image.
 */
export function decodeHetznerImageResponse(value) {
  return decodeSingle(value, 'image', decodeHetznerImage);
}

/**
 * @param {unknown} value - Firewalls response.
 * @returns {Readonly<ReturnType<typeof decodeHetznerFirewall>[]>} - Firewalls.
 */
export function decodeHetznerFirewallsResponse(value) {
  return decodeList(value, 'firewalls', decodeHetznerFirewall);
}

/**
 * @param {unknown} value - Firewall response.
 * @returns {ReturnType<typeof decodeHetznerFirewall>} - Firewall.
 */
export function decodeHetznerFirewallResponse(value) {
  return decodeSingle(value, 'firewall', decodeHetznerFirewall);
}

/**
 * @param {unknown} value - Primary IPs response.
 * @returns {Readonly<ReturnType<typeof decodeHetznerPrimaryIp>[]>} - IPs.
 */
export function decodeHetznerPrimaryIpsResponse(value) {
  return decodeList(value, 'primary_ips', decodeHetznerPrimaryIp);
}

/**
 * @param {unknown} value - Primary IP response.
 * @returns {ReturnType<typeof decodeHetznerPrimaryIp>} - Primary IP.
 */
export function decodeHetznerPrimaryIpResponse(value) {
  return decodeSingle(value, 'primary_ip', decodeHetznerPrimaryIp);
}

/**
 * @param {unknown} value - Servers response.
 * @returns {Readonly<ReturnType<typeof decodeHetznerServer>[]>} - Servers.
 */
export function decodeHetznerServersResponse(value) {
  return decodeList(value, 'servers', decodeHetznerServer);
}

/**
 * @param {unknown} value - Server response.
 * @returns {ReturnType<typeof decodeHetznerServer>} - Server.
 */
export function decodeHetznerServerResponse(value) {
  return decodeSingle(value, 'server', decodeHetznerServer);
}

/**
 * @param {unknown} value - Exact action response.
 * @returns {ReturnType<typeof decodeHetznerAction>} - Action.
 */
export function decodeHetznerActionResponse(value) {
  return decodeSingle(value, 'action', decodeHetznerAction);
}

/**
 * @param {unknown} value - Firewall creation response.
 * @returns {Readonly<{firewall: ReturnType<typeof decodeHetznerFirewall>, actions: Readonly<ReturnType<typeof decodeHetznerAction>[]>}>} - Decoded creation.
 */
export function decodeHetznerFirewallCreationResponse(value) {
  if (!isObject(value) || !Array.isArray(value.actions)) {
    throw new TypeError(INVALID_DOCUMENT);
  }
  return Object.freeze({
    firewall: decodeSingle(value, 'firewall', decodeHetznerFirewall),
    actions: Object.freeze(value.actions.map(decodeHetznerAction)),
  });
}

/**
 * @param {unknown} value - Primary IP creation response.
 * @returns {Readonly<{primaryIp: ReturnType<typeof decodeHetznerPrimaryIp>, action: ReturnType<typeof decodeHetznerAction>|null}>} - Decoded creation.
 */
export function decodeHetznerPrimaryIpCreationResponse(value) {
  if (!isObject(value) || !Object.hasOwn(value, 'action')) {
    throw new TypeError(INVALID_DOCUMENT);
  }
  return Object.freeze({
    primaryIp: decodeSingle(value, 'primary_ip', decodeHetznerPrimaryIp),
    action: value.action === null ? null : decodeHetznerAction(value.action),
  });
}

/**
 * @param {unknown} value - Server creation response.
 * @returns {Readonly<{server: ReturnType<typeof decodeHetznerServer>, action: ReturnType<typeof decodeHetznerAction>, nextActions: Readonly<ReturnType<typeof decodeHetznerAction>[]>}>} - Decoded creation.
 */
export function decodeHetznerServerCreationResponse(value) {
  if (!isObject(value) || !Array.isArray(value.next_actions)) {
    throw new TypeError(INVALID_DOCUMENT);
  }
  return Object.freeze({
    server: decodeSingle(value, 'server', decodeHetznerServer),
    action: decodeSingle(value, 'action', decodeHetznerAction),
    nextActions: Object.freeze(value.next_actions.map(decodeHetznerAction)),
  });
}
