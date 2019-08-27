const chalk = require('chalk')

const SecRpcServer = require('./rpc/mobile-app-jsonrpc-server-sec')
const SenRpcServer = require('./rpc/mobile-app-jsonrpc-server-sen')
<<<<<<< HEAD
const WalletService = require('./rpc/mobile-app-jsonrpc-server-biut')
=======
const BiutServer = require('./rpc/mobile-app-jsonrpc-server-biut')
>>>>>>> 191fecc3944bfc8b1e91a2da690a57fd3b064b58

class SECRPC {
  constructor (core) {
    this.core = core
  }

  runRPCServer () {
    if (process.env.RPC !== 'false') {
      console.log(chalk.yellow('Starting RPC'))
      SecRpcServer.runRpc(this.core)
      SenRpcServer.runRpc(this.core)
<<<<<<< HEAD
      WalletService.runRpc(this.core)
=======
      BiutServer.runRpc(this.core)
>>>>>>> 191fecc3944bfc8b1e91a2da690a57fd3b064b58
    }
  }
}

module.exports = SECRPC
