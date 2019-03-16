const jayson = require('jayson')

let core = {}

/**
  * create a server at localhost:3002
  */
let server = jayson.server({
  /**
  * get account balance
  */
  sec_getBalance: function (args, callback) {
    let response = {}
    try {
      let accAddr = args[0]
      // let time = args[1] 'latest'
      core.APIs.calAccBalance(accAddr, (err, balance) => {
        if (err) {
          response.status = '0'
          response.info = `Failed to get user balance, error info: ${err}`
          response.value = '10'
        } else {
          response.status = '1'
          response.info = 'OK'
          response.value = balance
        }
        callback(null, response)
      })
    } catch (err) {
      response.status = 'false'
      response.info = 'Arg[0] is empty, no account address received'
      response.value = '0'
      callback(null, response)
    }
  },

  /**
  * get all the previous transactions for a specific address
  */
  sec_getTransactions: function (args, callback) {
    let response = {}
    let accAddr = args[0] // address
    core.APIs.getTokenTxForUser(accAddr, (err, txArray) => {
      if (err) {
        response.status = '0'
        response.message = `Failed to get user transactions, error info: ${err}`
        response.resultInChain = []
        response.resultInPool = []
      } else {
        let txArraryInPool = core.APIs.getTokenTxInPoolByAddress(accAddr)
        txArray = txArray.sort((a, b) => {
          return b.TimeStamp - a.TimeStamp
        })
        txArraryInPool = txArraryInPool.sort((a, b) => {
          return b.TimeStamp - a.TimeStamp
        })
        response.status = '1'
        response.message = 'OK'
        response.resultInChain = txArray
        response.resultInPool = txArraryInPool
      }
      callback(null, response)
    })
  },

  /**
  * request to initiate a transaction
  */
  sec_sendRawTransaction: function (args, callback) {
    let response = {}
    core.APIs.getUserTxNonce(args[0].from, (err, nonce) => {
      if (err) {
        response.status = '0'
        response.info = `Unexpected error occurs, error info: ${err}`
        callback(null, response)
      } else {
        let tokenTx = {
          Nonce: nonce,
          TxReceiptStatus: 'pending',

          TimeStamp: args[0].timestamp,
          TxFrom: args[0].from,
          TxTo: args[0].to,
          Value: args[0].value,
          ContractAddress: args[0].contractAddress,
          GasLimit: args[0].gasLimit,
          GasUsedByTxn: args[0].gas,
          GasPrice: args[0].gasPrice,
          InputData: args[0].inputData,
          Signature: args[0].data
        }
        let tokenTxObject = core.APIs.createSecTxObject(tokenTx)
        tokenTx.TxHash = tokenTxObject.getTxHash()
        core.APIs.calAccBalance(tokenTx.TxFrom, (err, balance) => {
          if (err) {
            response.status = '0'
            response.info = `Account not found, which means account balance is 0, cant initiate a transaction`
          } else {
            if (balance < parseFloat(tokenTx.Value)) {
              response.status = '0'
              response.info = `Account doesn't have enough balance to finish the transaction, account balance: ${balance}, transaction value: ${tokenTx.Value}`
            } else {
              if (!core.CenterController.getBlockchain().initiateTokenTx(tokenTx)) {
                response.status = '0'
                response.info = 'Failed to verify transaction signature'
              } else {
                response.status = '1'
                response.info = 'OK'
                response.txHash = tokenTx.TxHash
              }
            }
          }
          callback(null, response)
        })
      }
    })
  },

  sec_getPeerList: function (args, callback) {
    let response = {}
    response.NodesTable = core.APIs.getNodesTable()
    callback(null, response)
  },

  /**
  * free charging function, for testing purpose
  */
  sec_freeCharge: function (args, callback) {
    const userInfo = {
      privKey: '56707bf1eaedf11f40f2d30d117e0e493ea03cbe29ba2afee838407db18c212c',
      publicKey: '3d8e183470248effe2f5ab99f1a0c53c7c7415c7b4a1f35805a5b0ce7e7583a42c9f99644999dcd2c34534dac734829bb8bafc330995a989805d2afb68bbfcb7',
      secAddress: '53a801c4da2cc72cf6be348369678b6f86c5edc1'
    }

    let response = {}
    core.APIs.getUserTxNonce(userInfo.secAddress, (err, nonce) => {
      if (err) {
        response.status = '0'
        response.info = `Unexpected error occurs, error info: ${err}`
        callback(null, response)
      } else {
        let tokenTx = {
          Nonce: nonce,
          TxReceiptStatus: 'pending',

          TimeStamp: new Date().getTime(),
          TxFrom: userInfo.secAddress,
          TxTo: args[0].to,
          Value: args[0].value,
          ContractAddress: '',
          GasLimit: '0',
          GasUsedByTxn: '0',
          GasPrice: '0',
          InputData: 'Mobile APP JSONRPC API Function Test',
          Signature: ''
        }

        let tokenTxObject = core.APIs.createSecTxObject(tokenTx)
        tokenTx.Signature = tokenTxObject.signTx(userInfo.privKey)
        tokenTx.TxHash = tokenTxObject.getTxHash()
        if (!core.CenterController.getBlockchain().initiateTokenTx(tokenTx)) {
          response.status = '0'
          response.info = 'Failed to verify transaction signature'
        } else {
          response.status = '1'
          response.info = 'OK'
          response.TxHash = tokenTx.TxHash
        }

        callback(null, response)
      }
    })
  },

  sec_getNodeInfo: function (args, callback) {
    let timePromise = core.APIs.asyncGetUTCTimeFromServer(args[0].timeServer)
    let response = {}
    timePromise.then((time) => {
      core.APIs.getNodeIpv4((ipv4) => {
        response.status = '1'
        response.time = time
        response.ipv4 = ipv4
        callback(null, response)
      })
    }).catch((err) => {
      response.status = '0'
      response.info = `Failed to get current system time, error info: ${err}`
      callback(null, response)
    })
  },

  sec_getTokenChainSize: function (args, callback) {
    core.APIs.getTokenChainSize((err, size) => {
      let response = {}
      if (err) {
        response.status = '0'
        response.info = `Unexpected error occurs, error info: ${err}`
        response.value = '0'
      } else {
        response.status = '1'
        response.info = 'OK'
        response.value = size.toString()
      }
      callback(null, response)
    })
  },

  sec_setPOW: function (args, callback) {
    let response = {}
    let command = args[0] // '0' means disable POW, '1' means enable POW

    if (command === '0') {
      core.APIs.disablePOW()
      response.status = '1'
      response.info = 'OK'
    } else if (command === '1') {
      core.APIs.enablePOW()
      response.status = '1'
      response.info = 'OK'
    } else {
      response.status = '0'
      response.info = 'Invalid input argument'
    }
    callback(null, response)
  },

  sec_startNetworkEvent: function (args, callback) {
    let response = {}
    core.APIs.startNetworkEvent((result) => {
      if (result === true) {
        response.status = '1'
        response.info = 'OK'
      } else {
        response.status = '0'
        response.info = `Unexpected error occurs, error info: ${result}`
      }
      callback(null, response)
    })
  },

  sec_getBlockByHash: function (args, callback) {
    let response = {}
    let blockHash = args[0]
    core.APIs.getTokenBlock(blockHash, (err, block) => {
      if (err) {
        response.status = '0'
        response.message = `Failed to get user Block, error info: ${err}`
        response.blockInfo = []
      } else {
        response.status = '1'
        response.message = 'OK'
        response.blockInfo = block
      }
      callback(null, response)
    })
  },

  sec_getWholeTokenBlockchain: function (args, callback) {
    let response = {}
    core.APIs.getWholeTokenBlockchain((err, value) => {
      if (err) {
        response.status = '0'
        response.info = `Failed to get Whole TokenBlockchain, error info: ${err}`
      } else {
        response.status = '1'
        response.message = 'OK'
        response.info = value
      }
      callback(null, response)
    })
  },

  sec_setAddress: function (args, callback) {
    let response = {}
    core.APIs.setAddress(args[0])
    response.status = '1'
    response.message = 'OK'
    callback(null, response)
  }
})

exports.runRpc = function (_core) {
  core = _core
  server.http().listen(3002)
}
