const SECCORE = require('@sec-block/secjs-core')
const SECRPC = require('@sec-block/secjs-rpc')

let core = new SECCORE()
let rpc = new SECRPC(core)

core.run()
rpc.runRPCServer()
