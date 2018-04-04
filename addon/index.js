import { once } from '@ember/runloop';
import RSVP from 'rsvp';

import deepFreeze from './-private/deep-freeze';

export default class DataLoader {
  constructor(
    batchLoadFn,
    {
      cacheMap,
      cacheKeyFn,
      maxBatchSize,
      cache = true,
      batch = true,
      freeze = true
    } = {
      cache: true,
      batch: true,
      freeze: true
    }
  ) {
    if (typeof batchLoadFn !== 'function') {
      throw new TypeError(
        'DataLoader must be constructed with a function which accepts ' +
          `Array<key> and returns Promise<Array<value>>, but got: ${batchLoadFn}.`
      );
    }

    let scope = getPrivateScope(this);
    scope.batchLoadFn = batchLoadFn;
    scope.options = { cache, batch, freeze, cacheKeyFn, maxBatchSize };
    scope.cache = getValidCacheMap(cacheMap);
    scope.queue = [];
  }

  /**
   * Loads a key, returning a `Promise` for the value represented by that key.
   */
  load(key, { reload = false } = { reload: false }) {
    if (key == null) {
      throw new TypeError(
        'The loader.load() function must be called with a value,' +
          `but got: ${String(key)}.`
      );
    }

    // Determine options
    let { options, cache, queue } = getPrivateScope(this);
    let { cacheKeyFn } = options;
    let shouldBatch = options.batch !== false;
    let shouldCache = options.cache !== false;
    let cacheKey = cacheKeyFn ? cacheKeyFn(key) : key;

    // If caching and there is a cache-hit, return cached Promise.
    if (shouldCache && reload === false) {
      let promise = cache.get(cacheKey);
      if (promise) {
        return promise;
      }
    }

    // Otherwise, produce a new Promise for this value.
    let promise = new RSVP.Promise((resolve, reject) => {
      // Enqueue this Promise to be dispatched.
      queue.push({ key, resolve, reject });

      // Determine if a dispatch of this queue should be scheduled.
      // A single dispatch should be scheduled per queue at the time when the
      // queue changes from "empty" to "full".
      if (queue.length === 1) {
        if (shouldBatch) {
          // If batching, schedule a task to dispatch the queue.
          enqueuePostPromiseJob(() => dispatchQueue(this));
        } else {
          // Otherwise dispatch the (queue of one) immediately.
          dispatchQueue(this);
        }
      }
    });

    // If caching, cache this promise.
    if (shouldCache) {
      cache.set(cacheKey, promise);
    }

    return promise;
  }

  /**
   * Loads multiple keys, promising an array of values:
   *
   *     let [ a, b ] = await myLoader.loadMany([ 'a', 'b' ]);
   *
   * This is equivalent to the more verbose:
   *
   *     let [ a, b ] = await Promise.all([
   *       myLoader.load('a'),
   *       myLoader.load('b')
   *     ]);
   *
   */
  loadMany(keys) {
    if (!Array.isArray(keys)) {
      throw new TypeError(
        'The loader.loadMany() function must be called with Array<key> ' +
          `but got: ${keys}.`
      );
    }
    return RSVP.all(keys.map(key => this.load(key)));
  }

  /**
   * Clears the value at `key` from the cache, if it exists. Returns itself for
   * method chaining.
   */
  clear(key) {
    let { options: { cacheKeyFn }, cache } = getPrivateScope(this);
    let cacheKey = cacheKeyFn ? cacheKeyFn(key) : key;
    cache.delete(cacheKey);
    return this;
  }

  /**
   * Clears the entire cache. To be used when some event results in unknown
   * invalidations across this particular `DataLoader`. Returns itself for
   * method chaining.
   */
  clearAll() {
    getPrivateScope(this).cache.clear();
    return this;
  }

  /**
   * Adds the provided key and value to the cache. If the key already
   * exists, no change is made. Returns itself for method chaining.
   */
  prime(key, value) {
    let { options: { cacheKeyFn }, cache } = getPrivateScope(this);
    let cacheKey = cacheKeyFn ? cacheKeyFn(key) : key;

    // Only add the key if it does not already exist.
    if (!cache.get(cacheKey)) {
      // Cache a rejected promise if the value is an Error, in order to match
      // the behavior of load(key).
      let promise = isError(value) ? RSVP.reject(value) : RSVP.resolve(value);

      cache.set(cacheKey, promise);
    }

    return this;
  }
}

const hasWeakMap = typeof WeakMap !== 'undefined';
const PRIVATE_SCOPE = hasWeakMap ? new WeakMap() : undefined;
const PRIVATE_KEY = '__3454hu5yu43hr47y7efh';

const getPrivateScope = hasWeakMap
  ? function(loader) {
      if (!PRIVATE_SCOPE.has(loader)) {
        let scope = Object.create(null);
        PRIVATE_SCOPE.set(loader, scope);
        return scope;
      }

      return PRIVATE_SCOPE.get(loader);
    }
  : function(loader) {
      if (!loader[PRIVATE_KEY]) {
        let scope = Object.create(null);
        loader[PRIVATE_KEY] = scope;
        return scope;
      }

      return loader[PRIVATE_KEY];
    };

function isError(value) {
  return value instanceof Error;
}

function getValidCacheMap(cacheMap) {
  if (!cacheMap) {
    return new Map();
  }
  let cacheFunctions = ['get', 'set', 'delete', 'clear'];
  let missingFunctions = cacheFunctions.filter(
    fnName => cacheMap && typeof cacheMap[fnName] !== 'function'
  );
  if (missingFunctions.length !== 0) {
    throw new TypeError(
      'Custom cacheMap missing methods: ' + missingFunctions.join(', ')
    );
  }
  return cacheMap;
}

// Private: Enqueue a Job to be executed after all "PromiseJobs" Jobs.
function enqueuePostPromiseJob(fn) {
  once(fn);
}

// Private: given the current state of a Loader instance, perform a batch load
// from its current queue.
function dispatchQueue(loader) {
  let { options: { maxBatchSize }, queue } = getPrivateScope(loader);
  // Take the current loader queue, replacing it with an empty queue.
  getPrivateScope(loader).queue = [];

  // If a maxBatchSize was provided and the queue is longer, then segment the
  // queue into multiple batches, otherwise treat the queue as a single batch.
  if (maxBatchSize && maxBatchSize > 0 && maxBatchSize < queue.length) {
    for (let i = 0; i < queue.length / maxBatchSize; i++) {
      dispatchQueueBatch(
        loader,
        queue.slice(i * maxBatchSize, (i + 1) * maxBatchSize)
      );
    }
  } else {
    dispatchQueueBatch(loader, queue);
  }
}

function dispatchQueueBatch(loader, queue) {
  let { batchLoadFn, options: { freeze } } = getPrivateScope(loader);

  // Collect all keys to be loaded in this dispatch
  let keys = queue.map(({ key }) => key);

  // Call the provided batchLoadFn for this loader with the loader queue's keys.
  let promise = batchLoadFn(keys);

  // Assert the expected response from batchLoadFn
  if (!promise || typeof promise.then !== 'function') {
    return failedDispatch(
      loader,
      queue,
      new TypeError(
        'DataLoader must be constructed with a function which accepts ' +
          'Array<key> and returns Promise<Array<value>>, but the function did ' +
          `not return a Promise: ${String(promise)}.`
      )
    );
  }

  // Await the resolution of the call to batchLoadFn.
  promise
    .then(values => {
      // Assert the expected resolution from batchLoadFn.
      if (!Array.isArray(values)) {
        throw new TypeError(
          'DataLoader must be constructed with a function which accepts ' +
            'Array<key> and returns Promise<Array<value>>, but the function did ' +
            `not return a Promise of an Array: ${String(values)}.`
        );
      }
      if (values.length !== keys.length) {
        throw new TypeError(
          'DataLoader must be constructed with a function which accepts ' +
            'Array<key> and returns Promise<Array<value>>, but the function did ' +
            'not return a Promise of an Array of the same length as the Array ' +
            'of keys.' +
            `\n\nKeys:\n${String(keys)}` +
            `\n\nValues:\n${String(values)}`
        );
      }

      // Step through the values, resolving or rejecting each Promise in the
      // loaded queue.
      queue.forEach(({ resolve, reject }, index) => {
        let value = values[index];
        if (value instanceof Error) {
          reject(value);
        } else if (freeze && value) {
          resolve(deepFreeze(value));
        } else {
          resolve(value);
        }
      });
    })
    .catch(error => failedDispatch(loader, queue, error));
}

function failedDispatch(loader, queue, error) {
  queue.forEach(({ key, reject }) => {
    loader.clear(key);
    reject(error);
  });
}
