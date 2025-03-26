const Secret = require('../../../lambdas/lib/actor/lib/secret');

describe('secret definition', () => {
  it('should create a secret', () => {
    expect.assertions(1);
    const secret = new Secret('my-secret-value');
    expect(secret.getSecretValue()).toBe('my-secret-value');
  });
  it('should throw an error when trying to change the secret value directly', () => {
    expect.assertions(1);
    const secret = new Secret('my-secret-value');
    expect(() => {
      secret.value = 'new-value';
    }).toThrow('Modification of secret value is restricted');
  });
  it('should throw an error when trying to access the secret value directly', () => {
    expect.assertions(3);
    const secret = new Secret('my-secret-value');
    expect(() => secret.value).toThrow(
      'Direct access to secret value is restricted'
    );
    expect(() => secret.secretValue).toThrow(
      'Direct access to secret value is restricted'
    );
    expect(() => secret._value).toThrow(
      'Direct access to secret value is restricted'
    );
  });
  it('should return [secret] **** when stringified', () => {
    expect.assertions(1);
    const secret = new Secret('my-secret-value');
    expect(JSON.stringify(secret)).toBe('"[secret] ****"');
  });
  it('should return [secret] **** when coerced to a string', () => {
    expect.assertions(1);
    const secret = new Secret('my-secret-value');
    expect(String(secret)).toBe('[secret] ****');
  });
});
