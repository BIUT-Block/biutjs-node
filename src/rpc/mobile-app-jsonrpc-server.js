const fs = require('fs')
const GEOIPReader = require('@maxmind/geoip2-node').Reader
const dbBuffer = fs.readFileSync(process.cwd() + '/src/GeoIP2-City.mmdb')
const geoIPReader = GEOIPReader.openBuffer(dbBuffer)
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
    // if (args[0].coinType = null) {
    // return all coins
    // } else {
    // args[0].coinType
    // }
    try {
      let accAddr = args[0]
      // let time = args[1] 'latest'
      core.APIs.getBalance(accAddr, (err, balance) => {
        if (err) {
          response.status = '0'
          response.info = `Failed to get user balance, error info: ${err}`
        } else {
          response.status = '1'
          response.info = 'OK'
          response.value = balance
          // response.value = {}
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
    core.APIs.getNonce(args[0].from, (err, nonce) => {
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
          GasLimit: args[0].gasLimit,
          GasUsedByTxn: args[0].gas,
          GasPrice: args[0].gasPrice,
          InputData: args[0].inputData,
          Signature: args[0].data
        }
        tokenTx = core.APIs.createSecTxObject(tokenTx).getTx()
        core.CenterController.getBlockchain().initiateTokenTx(tokenTx, (err) => {
          if (err) {
            response.status = '0'
            response.info = `Error occurs: ${err}`
          } else {
            response.status = '1'
            response.info = 'OK'
            response.txHash = tokenTx.TxHash
          }
          callback(null, response)
        })
      }
    })
  },

  sec_getNodesTable: function (args, callback) {
    let response = {}
    let nodes = core.APIs.getNodesTable()
    let locations = []
    nodes.forEach(node => {
      locations.push({
        location: geoIPReader.city(node.address),
        node: node
      })
    })
    response.NodesTable = locations
    callback(null, response)
  },

  sec_getChainHeight: function (args, callback) {
    let response = {}
    response.ChainHeight = core.APIs.getTokenChainHeight()
    callback(null, response)
  },

  /**
  * free charging function, for testing purpose
  */
  sec_freeCharge: function (args, callback) {
    const userInfo = {
      secAddress: '0000000000000000000000000000000000000001'
    }

    let response = {}
    core.APIs.getNonce(userInfo.secAddress, (err, nonce) => {
      if (err) {
        response.status = '0'
        response.info = `Unexpected error occurs, error info: ${err}`
      } else {
        let tokenTx = {
          Nonce: nonce,
          TxReceiptStatus: 'pending',

          TimeStamp: new Date().getTime(),
          TxFrom: userInfo.secAddress,
          TxTo: args[0].to,
          Value: args[0].value,
          GasLimit: '0',
          GasUsedByTxn: '0',
          GasPrice: '0',
          InputData: 'Mobile APP JSONRPC API Function Test',
          Signature: {}
        }

        tokenTx = core.APIs.createSecTxObject(tokenTx).getTx()
        core.CenterController.getBlockchain().initiateTokenTx(tokenTx, (err) => {
          if (err) {
            response.status = '0'
            response.info = `Error occurs, error info ${err}`
          } else {
            response.status = '1'
            response.info = 'OK'
            response.TxHash = tokenTx.TxHash
          }
        })
      }
      callback(null, response)
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
