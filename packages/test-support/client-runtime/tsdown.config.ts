import { clientLibrary } from '../../client/tsdown.client.ts'

export default clientLibrary(
  '@williamcodebox/omd-client-test-runtime',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
