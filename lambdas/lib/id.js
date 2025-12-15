import { init } from '@paralleldrive/cuid2';

// configuration. All configuration properties are optional.
const createId = init();
const createShortId = init({
  length: 6,
});

export { createId, createShortId };
