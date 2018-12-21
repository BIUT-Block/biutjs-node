const SECCORE = require('./src/core')
const SECRPC = require('./src/rpc')

let core = new SECCORE()
let rpc = new SECRPC(core)

core.run()
rpc.runRPCServer()
