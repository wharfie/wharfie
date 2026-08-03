/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import {
  WORKFLOW_DEFINITIONS_MAX_BYTES,
  WORKFLOW_MAX_STEPS,
  validateWorkflowActivityInput,
  validateWorkflowDefinition,
  validateWorkflowDefinitions,
  validateWorkflowStep,
} from '../../src/core/runtime/workflow-definition.js';

describe('static workflow definition codec', () => {
  it('normalizes a finite sequence and clones every input value', () => {
    const literal = { message: 'hello', tags: ['durable'] };
    const definitions = {
      'z-last': {
        steps: [{ id: 'done', kind: 'signal' }],
      },
      'a-first': {
        steps: [
          {
            id: 'prepare',
            kind: 'activity',
            activity: 'prepare',
            input: { kind: 'workflow-input' },
          },
          { id: 'pause', kind: 'timer', delayMs: 1_000 },
          { id: 'approved', kind: 'signal' },
          {
            id: 'finish',
            kind: 'activity',
            activity: 'finish',
            input: { kind: 'step-output', step: 'approved' },
          },
          {
            id: 'record',
            kind: 'activity',
            activity: 'record',
            input: { kind: 'literal', value: literal },
          },
        ],
      },
    };

    const normalized = validateWorkflowDefinitions(definitions);

    expect(Object.keys(normalized)).toEqual(['a-first', 'z-last']);
    expect(normalized).toEqual(definitions);
    expect(normalized).not.toBe(definitions);
    expect(normalized['a-first'].steps).not.toBe(definitions['a-first'].steps);
    const literalStep = normalized['a-first'].steps[4];
    expect(literalStep.kind).toBe('activity');
    if (literalStep.kind !== 'activity') {
      throw new Error('Expected the final fixture step to be an activity.');
    }
    expect(literalStep.input.kind).toBe('literal');
    if (literalStep.input.kind !== 'literal') {
      throw new Error('Expected the final fixture input to be literal.');
    }
    expect(literalStep.input.value).not.toBe(literal);

    literal.message = 'mutated';
    expect(literalStep.input.value).toEqual({
      message: 'hello',
      tags: ['durable'],
    });
  });

  it('exports reusable strict input and step validators', () => {
    expect(
      validateWorkflowActivityInput(
        { kind: 'step-output', step: 'first' },
        { priorStepIds: ['first'] },
      ),
    ).toEqual({ kind: 'step-output', step: 'first' });
    expect(
      validateWorkflowStep(
        {
          id: 'second',
          kind: 'activity',
          activity: 'finish',
          input: { kind: 'step-output', step: 'first' },
        },
        { priorStepIds: ['first'] },
      ),
    ).toEqual({
      id: 'second',
      kind: 'activity',
      activity: 'finish',
      input: { kind: 'step-output', step: 'first' },
    });
  });

  it('enforces the finite nonempty step bound', () => {
    expect(() => validateWorkflowDefinition({ steps: [] })).toThrow(
      /steps must be a nonempty array/i,
    );
    expect(() =>
      validateWorkflowDefinition({
        steps: Array.from({ length: WORKFLOW_MAX_STEPS + 1 }, (_, index) => ({
          id: `step-${index}`,
          kind: 'signal',
        })),
      }),
    ).toThrow(`at most ${WORKFLOW_MAX_STEPS} steps`);
  });

  it('rejects workflow data beyond the encoded manifest byte bound', () => {
    expect(() =>
      validateWorkflowDefinitions({
        oversized: {
          steps: [
            {
              id: 'literal',
              kind: 'activity',
              activity: 'record',
              input: {
                kind: 'literal',
                value: 'x'.repeat(WORKFLOW_DEFINITIONS_MAX_BYTES),
              },
            },
          ],
        },
      }),
    ).toThrow(`must not exceed ${WORKFLOW_DEFINITIONS_MAX_BYTES} bytes`);
  });

  it('rejects duplicate IDs and non-backward output references', () => {
    expect(() =>
      validateWorkflowDefinition({
        steps: [
          { id: 'same', kind: 'signal' },
          { id: 'same', kind: 'timer', delayMs: 1 },
        ],
      }),
    ).toThrow(/duplicates an earlier workflow step/i);

    expect(() =>
      validateWorkflowDefinition({
        steps: [
          {
            id: 'first',
            kind: 'activity',
            activity: 'prepare',
            input: { kind: 'step-output', step: 'later' },
          },
          { id: 'later', kind: 'signal' },
        ],
      }),
    ).toThrow(/must reference an earlier step/i);
  });

  it.each([
    [
      'unknown definition fields',
      { steps: [{ id: 'done', kind: 'signal' }], retry: 3 },
      /must contain exactly steps/i,
    ],
    [
      'unknown step fields',
      { steps: [{ id: 'done', kind: 'signal', name: 'done' }] },
      /must contain exactly id, kind/i,
    ],
    [
      'unknown step kinds',
      { steps: [{ id: 'done', kind: 'branch' }] },
      /kind must be 'activity', 'timer', or 'signal'/i,
    ],
    [
      'nonpositive timer delays',
      { steps: [{ id: 'pause', kind: 'timer', delayMs: 0 }] },
      /delayMs must be a positive safe integer/i,
    ],
    [
      'unknown input fields',
      {
        steps: [
          {
            id: 'done',
            kind: 'activity',
            activity: 'finish',
            input: { kind: 'workflow-input', extra: true },
          },
        ],
      },
      /must contain exactly kind/i,
    ],
    [
      'non-JSON literals',
      {
        steps: [
          {
            id: 'done',
            kind: 'activity',
            activity: 'finish',
            input: { kind: 'literal', value: undefined },
          },
        ],
      },
      /unsupported undefined value/i,
    ],
  ])('rejects %s', (_name, definition, expected) => {
    expect(() => validateWorkflowDefinition(definition)).toThrow(expected);
  });

  it('rejects empty or non-logical workflow map keys', () => {
    expect(() => validateWorkflowDefinitions({})).toThrow(
      /must not be empty when provided/i,
    );
    expect(() =>
      validateWorkflowDefinitions({
        Not_Canonical: { steps: [{ id: 'done', kind: 'signal' }] },
      }),
    ).toThrow(/canonical logical ID/i);
  });
});
