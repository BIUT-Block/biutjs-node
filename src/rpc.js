const chalk = require('chalk')

const SECRPCServer = require('./rpc/jayson-server')
const SECMobileAppRPCServer = require('./rpc/mobile-app-jsonrpc-server')

class SECRPC {
  constructor (core) {
    this.core = core
  }

  runRPCServer () {
    if (process.env.RPC !== 'false') {
      console.log(chalk.yellow('Starting RPC'))
      SECRPCServer.runRpc(this.core)
      SECMobileAppRPCServer.runRpc(this.core)
    }
  }
}

module.exports = SECRPC
