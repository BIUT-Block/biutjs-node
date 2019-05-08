const geoip = require('geoip-lite')
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
      let tokenName = args[1]
      if (tokenName === undefined) {
        tokenName = 'All'
      }
      // let time = args[1] 'latest'
      core.senAPIs.getBalance(accAddr, tokenName, (err, balance) => {
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
    core.senAPIs.getTokenTxForUser(accAddr, (err, txArray) => {
      if (err) {
        response.status = '0'
        response.message = `Failed to get user transactions, error info: ${err}`
        response.resultInChain = []
        response.resultInPool = []
      } else {
        let txArraryInPool = core.senAPIs.getTokenTxInPoolByAddress(accAddr)
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
    core.senAPIs.getNonce(args[0].from, (err, nonce) => {
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
          TxFee: args[0].txFee,
          InputData: args[0].inputData,
          Signature: args[0].data
        }
        tokenTx = core.senAPIs.createSecTxObject(tokenTx).getTx()
        core.CenterController.getSenChain().initiateTokenTx(tokenTx, (err) => {
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

  sec_createContractTransaction: function(args, callback) {
    let response = {}
    let tokenName = args[1]
    core.senAPIs.getContractAddress(tokenName, (err, address) => {
      if (err) {
        response.status = '0'
        response.info = `Unexpected error occurs, error info: ${err.stack}`
        callback(null, response)
      } else if (address) {
        response.status = '0'
        response.info = `Contract for TokenName already exists under: ${address}`
        callback(null, response)
      } else {
        core.senAPIs.getNonce(args[0].from, (err, nonce) => {
          if (err) {
            response.status = '0'
            response.info = `Unexpected error occurs, error info: ${err.stack}`
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
            tokenTx = core.senAPIs.createSecTxObject(tokenTx).getTx()
            core.senAPIs.addTokenNameMap(tokenName, args[0].to, (err)=>{
              if(err) {
                response.status = '0'
                response.info = `Error occurs: ${err.stack}`
              } else {
                core.CenterController.getSenChain().initiateTokenTx(tokenTx, (err) => {
                  if (err) {
                    response.status = '0'
                    response.info = `Error occurs: ${err.stack}`
                  } else {
                    response.status = '1'
                    response.info = 'OK'
                    response.txHash = tokenTx.TxHash
                  }
                  callback(null, response)
                })
              }
            })
          }
        })
      }
    })
  },
  
  sec_sendContractTransaction: function(args, callback) {
    let response = {}
    core.senAPIs.getTokenName(args[0].to, (err, tokenname) => {
      if (err) {
        response.status = '0'
        response.info = `Unexpected error occurs, error info: ${err}`
        callback(null, response)
      } else if (!tokenname) {
        response.status = '0'
        response.info = `ContractAddress doesn't exist`
        callback(null, response)
      } else {
        core.senAPIs.getNonce(args[0].from, (err, nonce) => {
          if (err) {
            response.status = '0'
            response.info = `Unexpected error occurs, error info: ${err}`
            callback(null, response)
          } else {
            let regexPattern = /transfer\(\s*(\w+),\s*([0-9]+[.]*[0-9]*)\)/
            if(args[0].inputData.match(regexPattern)){
              let txAmount = RegExp.$2
              if (txAmount > args[0].value) {
                response.status = '0'
                response.info = 'Smart Contract transaction requires more than sent'
                callback(null, response)
              }
            }
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
            tokenTx = core.senAPIs.createSecTxObject(tokenTx).getTx()
            core.CenterController.getSenChain().initiateTokenTx(tokenTx, (err) => {
              if (err) {
                response.status = '0'
                response.info = `Error occurs: ${err.stack}`
              } else {
                response.status = '1'
                response.info = 'OK'
                response.txHash = tokenTx.TxHash
              }
              callback(null, response)
            })
          }
        })
      }
    })
  },

  sec_getChainHeight: function (args, callback) {
    let response = {}
    response.ChainHeight = core.senAPIs.getTokenChainHeight()
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
    core.senAPIs.getNonce(userInfo.secAddress, (err, nonce) => {
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

        tokenTx = core.senAPIs.createSecTxObject(tokenTx).getTx()
        core.CenterController.getSenChain().initiateTokenTx(tokenTx, (err) => {
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
    let response = {}
    core.senAPIs.getNodeIpv4((ipv4) => {
      response.status = '1'
      response.time = new Date().getTime()
      response.ipv4 = ipv4
      response.timeZone = geoip.lookup(ipv4).timezone
      callback(null, response)
    })
  },

  sec_getTokenChainSize: function (args, callback) {
    core.senAPIs.getTokenChainSize((err, size) => {
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
      core.senAPIs.disablePOW()
      response.status = '1'
      response.info = 'OK'
    } else if (command === '1') {
      core.senAPIs.enablePOW()
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
    core.senAPIs.startNetworkEvent((result) => {
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
    core.senAPIs.getTokenBlock(blockHash, (err, block) => {
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

  sec_getBlockByHeight: function (args, callback) {
    let response = {}
    let blockHeight = args[0]
    core.senAPIs.getTokenBlockchain(blockHeight, blockHeight, (err, block) => {
      if (err) {
        response.status = '0'
        response.message = `Failed to get block, error info: ${err}`
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
    core.senAPIs.getWholeTokenBlockchain((err, value) => {
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
    core.senAPIs.setAddress(args[0])
    response.status = '1'
    response.message = 'OK'
    callback(null, response)
  },

  sec_getTotalReward: function (args, callback) {
    let response = {}
    core.senAPIs.getTotalRewards((err, reward) => {
      if (err) {
        response.status = '0'
        response.info = `Failed to get total reward amount, error info: ${err}`
      } else {
        response.status = '1'
        response.message = 'OK'
        response.info = reward
      }
      callback(null, response)
    })
  },

  sec_debug_getAccTreeAccInfo: function (args, callback) {
    let response = {}
    core.senAPIs.getAccTreeAccInfo(args[0], (err, info) => {
      if (err) {
        response.status = '0'
        response.info = `Failed to get Account Info, error info: ${err}`
      } else {
        response.status = '1'
        response.message = 'OK'
        response.info = info
      }
      callback(null, response)
    })
  },

  _setBlock: function (args, callback) {
    let response = {}
    core.senAPIs.writeBlock(args[0], (err) => {
      if (err) {
        response.status = '0'
        response.message = 'Failed, reason: ' + err
      } else {
        response.status = '1'
        response.message = 'OK'
      }
      callback(null, response)
    })
  },

  _syncFromIp: function (args, callback) {
    let response = {}
    if (args[0].ip === null) {
      response.status = '0'
      response.message = 'Needs a valid ip address'
      callback(response)
    } else {
      core.senAPIs.syncFromIp(args[0].ip, (err) => {
        if (err) {
          response.status = '0'
          response.message = 'Failed, reason: ' + err
        } else {
          response.status = '1'
          response.message = 'OK'
        }
        callback(null, response)
      })
    }
  }
})

exports.runRpc = function (_core) {
  core = _core
  server.http().listen(3003)
}
