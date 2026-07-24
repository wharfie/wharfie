/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable evidence contracts are clearer than repeated parser-specific expansions. */

export const AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_ID_PATTERN =
  /^rtbassoc-[0-9a-f]{8,32}$/u;
export const AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_ROUTE_TABLE_ID_PATTERN =
  /^rtb-[0-9a-f]{8,32}$/u;
export const AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_SUBNET_ID_PATTERN =
  /^subnet-[0-9a-f]{8,32}$/u;
export const AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_VPC_ID_PATTERN =
  /^vpc-[0-9a-f]{8,32}$/u;

const OWNER_ID_PATTERN = /^[0-9]{12}$/u;
const ASSOCIATION_STATES = new Set([
  'associating',
  'associated',
  'disassociating',
  'disassociated',
  'failed',
]);
const SUBNET_STATES = new Set([
  'pending',
  'available',
  'unavailable',
  'failed',
  'failed-insufficient-capacity',
]);
const RECONCILE_KEYS = new Set([
  'exactAssociation',
  'slotAssociations',
  'routeTableId',
]);

/** Raw EC2 evidence is malformed or incomplete. */
export class AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError extends Error {
  constructor() {
    super('AWS subnet route-table association evidence is unknown.');
    this.name = 'AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError';
  }
}

/** Raw EC2 evidence conclusively contradicts the exact relationship. */
export class AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError extends Error {
  constructor() {
    super('AWS subnet route-table association evidence conflicts.');
    this.name = 'AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError';
  }
}

/** Complete EC2 views have not yet converged on one relationship state. */
export class AwsSingleNodeSubnetRouteTableAssociationEvidenceTransientError extends Error {
  constructor() {
    super('AWS subnet route-table association evidence is transient.');
    this.name =
      'AwsSingleNodeSubnetRouteTableAssociationEvidenceTransientError';
  }
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertExactKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
}

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {unknown} value @param {RegExp} pattern @returns {string} */
function validateId(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
  }
  return value;
}

/** @param {unknown} value @returns {string} */
export function validateAwsSingleNodeSubnetRouteTableAssociationId(value) {
  return validateId(
    value,
    AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_ID_PATTERN,
  );
}

/** @param {unknown} value @returns {string} */
export function validateAwsSingleNodeSubnetRouteTableAssociationRouteTableId(
  value,
) {
  return validateId(
    value,
    AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_ROUTE_TABLE_ID_PATTERN,
  );
}

/** @param {unknown} value @returns {string} */
export function validateAwsSingleNodeSubnetRouteTableAssociationSubnetId(
  value,
) {
  return validateId(
    value,
    AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_SUBNET_ID_PATTERN,
  );
}

/** @param {unknown} value @returns {string} */
export function validateAwsSingleNodeSubnetRouteTableAssociationVpcId(value) {
  return validateId(
    value,
    AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_VPC_ID_PATTERN,
  );
}

/** @param {unknown} value @returns {string} */
function validateOwnerId(value) {
  if (typeof value !== 'string' || !OWNER_ID_PATTERN.test(value)) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
  }
  return value;
}

/**
 * Decode the one exact subnet endpoint. A successful empty exact response is
 * incomplete evidence, never logical absence of the derived relationship.
 * @param {unknown} response - Raw DescribeSubnets response.
 * @param {unknown} exactSubnetId - Durable subnet endpoint ID.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsSingleNodeSubnetRouteTableAssociationSubnetResponse(
  response,
  exactSubnetId,
) {
  const subnet =
    decodeAwsSingleNodeSubnetRouteTableAssociationExactSubnetRecord(
      response,
      exactSubnetId,
    );
  return deepFreeze({
    ownerId: subnet.OwnerId,
    state: subnet.State,
    subnetId: subnet.SubnetId,
    vpcId: subnet.VpcId,
  });
}

/**
 * Decode the raw exact subnet record shared by mutation and observation.
 * @param {unknown} response - Raw DescribeSubnets response.
 * @param {unknown} exactSubnetId - Durable subnet endpoint ID.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsSingleNodeSubnetRouteTableAssociationExactSubnetRecord(
  response,
  exactSubnetId,
) {
  const expectedId =
    validateAwsSingleNodeSubnetRouteTableAssociationSubnetId(exactSubnetId);
  if (!isPlainObject(response) || !Array.isArray(response.Subnets)) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
  }
  if (response.NextToken !== undefined && response.NextToken !== null) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError();
  }
  if (response.Subnets.length === 0) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
  }
  if (response.Subnets.length !== 1) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError();
  }
  const subnet = response.Subnets[0];
  if (
    !isPlainObject(subnet) ||
    typeof subnet.State !== 'string' ||
    !SUBNET_STATES.has(subnet.State)
  ) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
  }
  const subnetId = validateAwsSingleNodeSubnetRouteTableAssociationSubnetId(
    subnet.SubnetId,
  );
  if (subnetId !== expectedId) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError();
  }
  validateOwnerId(subnet.OwnerId);
  validateAwsSingleNodeSubnetRouteTableAssociationVpcId(subnet.VpcId);
  return deepFreeze(subnet);
}

/**
 * Decode one explicit subnet or gateway association. Main associations are
 * contradictory for the fixed nonmain managed route-table contract.
 * @param {unknown} value - Raw RouteTableAssociation record.
 * @param {unknown} containerRouteTableId - Containing route-table ID.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsSingleNodeSubnetRouteTableAssociationRecord(
  value,
  containerRouteTableId,
) {
  const expectedRouteTableId =
    validateAwsSingleNodeSubnetRouteTableAssociationRouteTableId(
      containerRouteTableId,
    );
  if (!isPlainObject(value) || typeof value.Main !== 'boolean') {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
  }
  if (
    value.Main ||
    (value.PublicIpv4Pool !== undefined && value.PublicIpv4Pool !== null)
  ) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError();
  }
  if (
    !isPlainObject(value.AssociationState) ||
    typeof value.AssociationState.State !== 'string' ||
    !ASSOCIATION_STATES.has(value.AssociationState.State)
  ) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
  }
  if (
    value.AssociationState.StatusMessage !== undefined &&
    value.AssociationState.StatusMessage !== null &&
    typeof value.AssociationState.StatusMessage !== 'string'
  ) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
  }
  const routeTableId =
    validateAwsSingleNodeSubnetRouteTableAssociationRouteTableId(
      value.RouteTableId,
    );
  if (routeTableId !== expectedRouteTableId) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError();
  }
  const subnetPresent = value.SubnetId !== undefined && value.SubnetId !== null;
  const gatewayPresent =
    value.GatewayId !== undefined && value.GatewayId !== null;
  if (Number(subnetPresent) + Number(gatewayPresent) !== 1) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError();
  }
  let subnetId = null;
  let gatewayId = null;
  if (subnetPresent) {
    subnetId = validateAwsSingleNodeSubnetRouteTableAssociationSubnetId(
      value.SubnetId,
    );
  } else if (
    typeof value.GatewayId !== 'string' ||
    !/^(?:igw|vgw)-[0-9a-f]{8,32}$/u.test(value.GatewayId)
  ) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
  } else {
    gatewayId = value.GatewayId;
  }
  return deepFreeze({
    associationId: validateAwsSingleNodeSubnetRouteTableAssociationId(
      value.RouteTableAssociationId,
    ),
    gatewayId,
    routeTableId,
    state: value.AssociationState.State,
    subnetId,
  });
}

/** @param {unknown} routeTable @param {string} expectedSubnetId @returns {Readonly<Record<string, any>>} */
function decodeRouteTable(routeTable, expectedSubnetId) {
  if (!isPlainObject(routeTable) || !Array.isArray(routeTable.Associations)) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
  }
  const routeTableId =
    validateAwsSingleNodeSubnetRouteTableAssociationRouteTableId(
      routeTable.RouteTableId,
    );
  const matches = [];
  const otherAssociations = [];
  for (const candidate of routeTable.Associations) {
    const association = decodeAwsSingleNodeSubnetRouteTableAssociationRecord(
      candidate,
      routeTableId,
    );
    if (association.subnetId === expectedSubnetId) {
      matches.push(association);
    } else {
      otherAssociations.push(association);
    }
  }
  if (matches.length > 1) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError();
  }
  return deepFreeze({
    association: matches[0] ?? null,
    otherAssociations,
    ownerId: validateOwnerId(routeTable.OwnerId),
    routeTableId,
    vpcId: validateAwsSingleNodeSubnetRouteTableAssociationVpcId(
      routeTable.VpcId,
    ),
  });
}

/**
 * Decode the association view embedded in the exact durable route table.
 * @param {unknown} response - Raw exact DescribeRouteTables response.
 * @param {unknown} exactRouteTableId - Durable route-table endpoint ID.
 * @param {unknown} exactSubnetId - Durable subnet endpoint ID.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsSingleNodeSubnetRouteTableAssociationRouteTableResponse(
  response,
  exactRouteTableId,
  exactSubnetId,
) {
  const expectedRouteTableId =
    validateAwsSingleNodeSubnetRouteTableAssociationRouteTableId(
      exactRouteTableId,
    );
  const expectedSubnetId =
    validateAwsSingleNodeSubnetRouteTableAssociationSubnetId(exactSubnetId);
  const routeTable =
    decodeAwsSingleNodeSubnetRouteTableAssociationExactRouteTableRecord(
      response,
      expectedRouteTableId,
    );
  return decodeRouteTable(routeTable, expectedSubnetId);
}

/**
 * Decode the raw exact route-table record shared by mutation and observation.
 * @param {unknown} response - Raw exact DescribeRouteTables response.
 * @param {unknown} exactRouteTableId - Durable route-table endpoint ID.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsSingleNodeSubnetRouteTableAssociationExactRouteTableRecord(
  response,
  exactRouteTableId,
) {
  const expectedRouteTableId =
    validateAwsSingleNodeSubnetRouteTableAssociationRouteTableId(
      exactRouteTableId,
    );
  if (!isPlainObject(response) || !Array.isArray(response.RouteTables)) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
  }
  if (response.NextToken !== undefined && response.NextToken !== null) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError();
  }
  if (response.RouteTables.length === 0) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
  }
  if (response.RouteTables.length !== 1) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError();
  }
  const routeTable = response.RouteTables[0];
  if (!isPlainObject(routeTable)) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
  }
  const routeTableId =
    validateAwsSingleNodeSubnetRouteTableAssociationRouteTableId(
      routeTable.RouteTableId,
    );
  if (routeTableId !== expectedRouteTableId) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError();
  }
  validateOwnerId(routeTable.OwnerId);
  validateAwsSingleNodeSubnetRouteTableAssociationVpcId(routeTable.VpcId);
  return deepFreeze(routeTable);
}

/**
 * Decode one complete natural-slot discovery page. Every returned route table
 * must actually expose the requested subnet association.
 * @param {unknown} response - Raw filtered DescribeRouteTables page.
 * @param {unknown} exactSubnetId - Durable subnet endpoint ID.
 * @returns {Readonly<{associations: Readonly<Record<string, any>>[], otherAssociations: Readonly<Record<string, any>>[], nextToken: string|null}>}
 */
export function decodeAwsSingleNodeSubnetRouteTableAssociationDiscoveryPage(
  response,
  exactSubnetId,
) {
  const expectedSubnetId =
    validateAwsSingleNodeSubnetRouteTableAssociationSubnetId(exactSubnetId);
  if (!isPlainObject(response) || !Array.isArray(response.RouteTables)) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
  }
  let nextToken = null;
  if (response.NextToken !== undefined && response.NextToken !== null) {
    if (
      typeof response.NextToken !== 'string' ||
      response.NextToken.length === 0
    ) {
      throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
    }
    nextToken = response.NextToken;
  }
  const associations = [];
  const otherAssociations = [];
  const associationIds = new Set();
  for (const routeTable of response.RouteTables) {
    const decoded = decodeRouteTable(routeTable, expectedSubnetId);
    if (decoded.association === null) {
      throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
    }
    const association = deepFreeze({
      ...decoded.association,
      ownerId: decoded.ownerId,
      vpcId: decoded.vpcId,
    });
    if (associationIds.has(association.associationId)) {
      throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError();
    }
    associationIds.add(association.associationId);
    associations.push(association);
    for (const otherAssociation of decoded.otherAssociations) {
      otherAssociations.push(
        deepFreeze({
          ...otherAssociation,
          ownerId: decoded.ownerId,
          vpcId: decoded.vpcId,
        }),
      );
    }
  }
  return deepFreeze({ associations, otherAssociations, nextToken });
}

/**
 * Reconcile the exact route-table view with complete subnet-slot discovery.
 * Differing or one-sided provider-allocated association IDs are transient
 * rather than guessed, adopted, or treated as absence.
 * @param {unknown} value - Exact association and natural-slot views.
 * @returns {Readonly<{state: 'absent'}|{state: 'present', association: Readonly<Record<string, any>>}>}
 */
export function reconcileAwsSingleNodeSubnetRouteTableAssociationViews(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeSubnetRouteTableAssociation views must be an object.',
    );
  }
  assertExactKeys(
    value,
    RECONCILE_KEYS,
    'awsSingleNodeSubnetRouteTableAssociation views',
  );
  const routeTableId =
    validateAwsSingleNodeSubnetRouteTableAssociationRouteTableId(
      value.routeTableId,
    );
  if (
    value.exactAssociation !== null &&
    !isPlainObject(value.exactAssociation)
  ) {
    throw new TypeError(
      'awsSingleNodeSubnetRouteTableAssociation views.exactAssociation must be an object or null.',
    );
  }
  if (!Array.isArray(value.slotAssociations)) {
    throw new TypeError(
      'awsSingleNodeSubnetRouteTableAssociation views.slotAssociations must be an array.',
    );
  }
  if (value.slotAssociations.length > 1) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError();
  }
  const exact = value.exactAssociation;
  const slot = value.slotAssociations[0] ?? null;
  if (slot !== null && slot.routeTableId !== routeTableId) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError();
  }
  if (exact?.state === 'failed' || slot?.state === 'failed') {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError();
  }
  if (exact === null && slot === null)
    return Object.freeze({ state: 'absent' });
  if (
    exact === null ||
    slot === null ||
    exact.associationId !== slot.associationId ||
    exact.routeTableId !== slot.routeTableId ||
    exact.subnetId !== slot.subnetId ||
    exact.state !== slot.state ||
    exact.state !== 'associated'
  ) {
    throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceTransientError();
  }
  return deepFreeze({ state: 'present', association: exact });
}

export default {
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_ID_PATTERN,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_ROUTE_TABLE_ID_PATTERN,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_SUBNET_ID_PATTERN,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_VPC_ID_PATTERN,
  AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError,
  AwsSingleNodeSubnetRouteTableAssociationEvidenceTransientError,
  AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError,
  decodeAwsSingleNodeSubnetRouteTableAssociationDiscoveryPage,
  decodeAwsSingleNodeSubnetRouteTableAssociationExactRouteTableRecord,
  decodeAwsSingleNodeSubnetRouteTableAssociationExactSubnetRecord,
  decodeAwsSingleNodeSubnetRouteTableAssociationRecord,
  decodeAwsSingleNodeSubnetRouteTableAssociationRouteTableResponse,
  decodeAwsSingleNodeSubnetRouteTableAssociationSubnetResponse,
  reconcileAwsSingleNodeSubnetRouteTableAssociationViews,
  validateAwsSingleNodeSubnetRouteTableAssociationId,
  validateAwsSingleNodeSubnetRouteTableAssociationRouteTableId,
  validateAwsSingleNodeSubnetRouteTableAssociationSubnetId,
  validateAwsSingleNodeSubnetRouteTableAssociationVpcId,
};
