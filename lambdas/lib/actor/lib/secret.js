class Secret {
  /**
   * @param {string} value -
   */
  constructor(value) {
    // Capture the secret value in a closure.
    const secretValue = value;
    // If you want encryption, you can instead do:
    // const secretValue = encrypt(value);

    // Ensure no accidental property named "value" is present.
    // if (this.hasOwnProperty('value')) {
    //     delete this.value;
    // }

    // Provide a method to fetch the secret.
    this.getSecretValue = function () {
      // If using encryption, return decrypt(secretValue);
      return secretValue;
    };

    return new Proxy(this, {
      get: function (target, prop, receiver) {
        if (prop === 'value' || prop === '_value' || prop === 'secretValue') {
          throw new Error('Direct access to secret value is restricted');
        }
        return Reflect.get(target, prop, receiver);
      },
      set: function (target, prop, newVal, receiver) {
        if (prop === 'value' || prop === '_value' || prop === 'secretValue') {
          throw new Error('Modification of secret value is restricted');
        }
        return Reflect.set(target, prop, newVal, receiver);
      },
    });
  }

  // Override default string coercion
  toString() {
    return '[secret] ****';
  }

  // Override JSON serialization
  toJSON() {
    return '[secret] ****';
  }

  // Override inspection methods (console.log, util.inspect)
  [Symbol.for('nodejs.util.inspect.custom')]() {
    return '[secret] ****';
  }

  // Override valueOf to prevent coercion into primitive types
  valueOf() {
    return '[secret] ****';
  }

  /**
   * @param {any} value -
   * @returns {boolean} -
   */
  static isSecret(value) {
    return value instanceof Secret;
  }
}

export default Secret;
