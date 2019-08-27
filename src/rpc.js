const chalk = require('chalk')

const SecRpcServer = require('./rpc/mobile-app-jsonrpc-server-sec')
const SenRpcServer = require('./rpc/mobile-app-jsonrpc-server-sen')
const WalletService = require('./rpc/mobile-app-jsonrpc-server-biut')

class SECRPC {
  constructor (core) {
    this.core = core
  }

  runRPCServer () {
    if (process.env.RPC !== 'false') {
      console.log(chalk.yellow('Starting RPC'))
      SecRpcServer.runRpc(this.core)
      SenRpcServer.runRpc(this.core)
      WalletService.runRpc(this.core)
    }
  }
}

module.exports = SECRPC
