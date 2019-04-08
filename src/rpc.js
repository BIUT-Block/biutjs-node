const chalk = require('chalk')

const SECMobileAppRPCServer = require('./rpc/mobile-app-jsonrpc-server')

class SECRPC {
  constructor (core) {
    this.core = core
  }

  runRPCServer () {
    if (process.env.RPC !== 'false') {
      console.log(chalk.yellow('Starting RPC'))
      SECMobileAppRPCServer.runRpc(this.core)
    }
  }
}

module.exports = SECRPC
