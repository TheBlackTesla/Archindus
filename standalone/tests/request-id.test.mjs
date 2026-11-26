import test from 'node:test';
import assert from 'node:assert/strict';
import { requestId } from '../app/archindus/request-id.ts';

test('a browser without randomUUID still produces a valid request ID', (t) => {
  t.mock.method(crypto, 'randomUUID', () => { throw new Error('Unexpected native call'); });
  Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
  assert.match(requestId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
