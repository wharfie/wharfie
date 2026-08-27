import * as actualProvider from '@wharfie/aws';

const ACTUAL_BINDINGS = actualProvider.getAwsSdkBindings();

/**
 * Build a complete fixed provider test namespace while replacing only the SDK
 * capabilities a focused test observes.
 * @param {Partial<Record<keyof typeof ACTUAL_BINDINGS, Record<string, any>>>} [overrides] - Per-namespace test doubles.
 * @returns {Readonly<Record<string, any>>} - Complete provider namespace.
 */
export function createAwsProviderModule(overrides = {}) {
  const bindings = Object.freeze(
    Object.fromEntries(
      Object.entries(ACTUAL_BINDINGS).map(([key, namespace]) => {
        const bindingKey = /** @type {keyof typeof ACTUAL_BINDINGS} */ (key);
        return [
          bindingKey,
          Object.hasOwn(overrides, bindingKey)
            ? Object.freeze({ ...namespace, ...overrides[bindingKey] })
            : namespace,
        ];
      }),
    ),
  );
  return Object.freeze({
    WHARFIE_AWS_PROVIDER_PACKAGE_VERSION:
      actualProvider.WHARFIE_AWS_PROVIDER_PACKAGE_VERSION,
    WHARFIE_AWS_PROVIDER_CONTRACT_VERSION:
      actualProvider.WHARFIE_AWS_PROVIDER_CONTRACT_VERSION,
    getAwsSdkBindings: () => bindings,
  });
}

export default createAwsProviderModule;
