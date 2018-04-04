import DataLoader from 'ember-dataloader';
import { run } from '@ember/runloop';
import { module, test } from 'qunit';

module('DataLoader', function() {
  test('#load(1)', async function(assert) {
    let loader = new DataLoader(async keys => keys.map(key => `item ${key}`));
    let data = await run(() => loader.load(1));
    assert.equal(data, 'item 1');
  });

  test('#load(1) freeze: true', async function(assert) {
    let loader = new DataLoader(async keys =>
      keys.map(key => ({
        key
      }))
    );
    let data = await run(() => loader.load(1));
    assert.deepEqual({ key: 1 }, data);
    assert.ok(Object.isFrozen(data));
  });

  test('#load(1) freeze: false', async function(assert) {
    let loader = new DataLoader(
      async keys =>
        keys.map(key => ({
          key
        })),
      { freeze: false }
    );
    let data = await run(() => loader.load(1));
    assert.deepEqual({ key: 1 }, data);
    assert.ok(!Object.isFrozen(data));
  });

  test('#loadMany([1, 2])', async function(assert) {
    let loader = new DataLoader(async keys => keys.map(key => `item ${key}`));
    let data = await run(() => loader.loadMany([1, 2]));
    assert.deepEqual(data, ['item 1', 'item 2']);
  });

  test('#load(1) #load(2)', async function(assert) {
    assert.expect(2);
    let loader = new DataLoader(async keys => {
      assert.deepEqual(keys, [1, 2]);
      return keys.map(key => `item ${key}`);
    });
    let data = await run(() => {
      loader.load(1);
      return loader.load(2);
    });
    assert.equal(data, 'item 2');
  });

  test('#load(1) #load(1) #load(1)', async function(assert) {
    assert.expect(3);
    let loader = new DataLoader(async keys => {
      assert.deepEqual(keys, [1]);
      return keys.map(key => `item ${key}`);
    });
    let data = run(() => [loader.load(1), loader.load(1), loader.load(1)]);

    assert.equal(await data[2], 'item 1');
    data = await Promise.all(data);
    assert.deepEqual(data, ['item 1', 'item 1', 'item 1']);
  });

  test('#load(1) [#load(1, { reload: true }) #load(1, { reload: true })] #load(1, { reload: true })', async function(assert) {
    assert.expect(5);
    let i = 0;
    let loader = new DataLoader(async keys => {
      assert.deepEqual(keys, [1]);
      i++;
      return keys.map(key => `item ${i + key}`);
    });
    let d = run(() => loader.load(1));
    let data = [await d];
    d = run(() => {
      loader.load(1, { reload: true });
      return loader.load(1, { reload: true });
    });
    data.push(await d);
    d = run(() => loader.load(1, { reload: true }));
    data.push(await d);

    assert.equal('item 3', data[1]);
    assert.deepEqual(data, ['item 2', 'item 3', 'item 4']);
  });

  test('#prime(1) #load(1)', async function(assert) {
    assert.expect(1);
    let loader = new DataLoader(async keys => {
      assert.ok(false);
      return keys;
    });
    loader.prime(1, 'hello');
    let data = await run(() => loader.load(1));
    assert.equal(data, 'hello');
  });

  test('#prime(1) #loadMany([1, 2])', async function(assert) {
    assert.expect(2);
    let loader = new DataLoader(async keys => {
      assert.deepEqual(keys, [2]);
      return keys.map(key => `item ${key}`);
    });
    loader.prime(1, 'hello');
    let data = await run(() => loader.loadMany([1, 2]));
    assert.deepEqual(data, ['hello', 'item 2']);
  });

  test('#load(1) loadMany([1, 2])', async function(assert) {
    assert.expect(2);
    let loader = new DataLoader(async keys => {
      assert.deepEqual(keys, [1, 2]);
      return keys.map(key => `item ${key}`);
    });
    let data = await run(() => {
      loader.load(1);
      return loader.loadMany([1, 2]);
    });
    assert.deepEqual(data, ['item 1', 'item 2']);
  });
});
