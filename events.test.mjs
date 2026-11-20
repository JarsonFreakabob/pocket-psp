import test from 'node:test';
import assert from 'node:assert/strict';
import {bindEvent} from './events.js';
const tick = () => new Promise(resolve=>setImmediate(resolve));
test('event handlers can capture currentTarget before their first await', async()=>{
  const target = new EventTarget(); let captured;
  bindEvent(target,'click',async event=>{captured=event.currentTarget;await Promise.resolve();},()=>{});
  target.dispatchEvent(new Event('click')); await tick();
  assert.equal(captured,target);
});
test('synchronous handler failures reach the error reporter', async()=>{
  const target = new EventTarget(); const errors=[]; const error=new Error('sync');
  bindEvent(target,'click',()=>{throw error;},e=>errors.push(e));
  target.dispatchEvent(new Event('click')); await tick(); assert.deepEqual(errors,[error]);
});
test('asynchronous handler failures reach the error reporter', async()=>{
  const target = new EventTarget(); const errors=[]; const error=new Error('async');
  bindEvent(target,'click',async()=>{await Promise.resolve();throw error;},e=>errors.push(e));
  target.dispatchEvent(new Event('click')); await tick(); assert.deepEqual(errors,[error]);
});
