import foo from './foo';
import { bar } from '../bar/baz';
import * as ns from '@/lib/x';
import type { T } from './types';
export { x } from './x';
export * from './y';
const dyn = import('./dyn');
const cjs = require('./cjs');
