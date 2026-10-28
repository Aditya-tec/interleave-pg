import { redeemFixed } from './app.mjs';
import { build } from './scenario.mjs';

// The same scenario against the fixed code.
export default { ...build(redeemFixed), name: 'gift card: two concurrent redemptions (fixed)' };
