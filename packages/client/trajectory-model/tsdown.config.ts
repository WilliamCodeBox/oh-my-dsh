import { clientOnly } from '../tsdown.client.ts'

/**
 * trajectory-model is a pure framework-neutral model library: the node-half
 * lib build is emitted during the Client pass (host pass skips it), and the
 * browser surface compiles src directly — nothing here imports CSS or React.
 */
export default clientOnly([{
  entry: ['lib/types/index.js', 'lib/types/invariant.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'neutral',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}])
