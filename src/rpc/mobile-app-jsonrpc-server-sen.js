const geoip = require('geoip-lite')
const jayson = require('jayson')
const SECUtil = require('@biut-block/biutjs-util')

let core = {}
let _requestID = 0

function _signTransaction (privateKey, transfer) {
  let transferData = [{
    timestamp: transfer.timeStamp,
    from: transfer.walletAddress.replace('0x', '').toLowerCase(),
    to: transfer.sendToAddress.replace('0x', '').toLowerCase(),
    value: transfer.amount,
    txFee: transfer.txFee,
    gasLimit: '0',
    gas: '0',
    gasPrice: '0',
    data: '',
    nonce: transfer.nonce,
    inputData: transfer.inputData || ''
  }]
  const tokenTxBuffer = [
    SECUtil.bufferToInt(transferData[0].timestamp),
    Buffer.from(transferData[0].from, 'hex'),
    Buffer.from(transferData[0].to, 'hex'),
    Buffer.from(transferData[0].value),
    Buffer.from(transferData[0].gasLimit),
    Buffer.from(transferData[0].gas),
    Buffer.from(transferData[0].gasPrice),
    Buffer.from(transferData[0].nonce),
    Buffer.from(transferData[0].inputData),
    Buffer.from('SEN')
  ]
  let txSigHash = Buffer.from(SECUtil.rlphash(tokenTxBuffer).toString('hex'), 'hex')
  let signature = SECUtil.ecsign(txSigHash, Buffer.from(privateKey, 'hex'))
  transferData[0].data = {
    v: signature.v,
    r: signature.r.toString('hex'),
    s: signature.s.toString('hex')
  }
  return transferData
}

/**
  * create a server at localhost:3002
  */
let server = jayson.server({
  /**
  * get account balance
  */
  sec_getBalance: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_getBalance id: ' + requestID)
    let response = {}
    try {
      let accAddr = args[0]
      let tokenName = args[1]
      if (!tokenName) {
        tokenName = 'SEN'
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
        console.timeEnd('sen_getBalance id: ' + requestID)
        callback(null, response)
      })
    } catch (err) {
      response.status = 'false'
      response.info = 'Arg[0] is empty, no account address received'
      response.value = '0'
      console.timeEnd('sen_getBalance id: ' + requestID)
      callback(null, response)
    }
  },

  /**
  * get all the previous transactions for a specific address
  */
  sec_getTransactions: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_getTransactions id: ' + requestID)
    let response = {}
    let accAddr = args[0] // address

    let currentPage = parseInt(args[1] || 1)
    let pageSize = parseInt(args[2] || Number.MAX_SAFE_INTEGER)
    let sortType = args[3]
    console.log(args)
    try {
      if (accAddr[0] === '0' && accAddr[1] === 'x') {
        accAddr = accAddr.substr(2)
      }
      if (accAddr.length !== 40) {
        response.status = '0'
        response.message = `Invalid accAddress length (${accAddr.length}), should be 40`
        console.timeEnd('sen_getTransactions id: ' + requestID)
        callback(null, response)
      } else {
        core.senAPIs.getTokenTxForUser(accAddr, (err, txArray) => {
          if (err) {
            response.status = '0'
            response.message = `Failed to get user transactions, error info: ${err}`
            response.resultInChain = []
            response.resultInPool = []
          } else {
            let ChainHeight = core.senAPIs.getChainHeight()
            let txArraryInPool = core.senAPIs.getTokenTxInPoolByAddress(accAddr)
            txArray = txArray.sort((a, b) => {
              return Number(a.BlockNumber) - Number(b.BlockNumber)
            })
            for (let i = txArray.length - 1; i > -1; i--) {
              if (txArray[i].BlockNumber > ChainHeight - 5) {
                let tx = txArray.pop()
                tx.TxReceiptStatus = 'pending'
                txArraryInPool.push(tx)
              }
            }
            txArray = txArray.sort((a, b) => {
              if (sortType === 'asc') {
                return a.TimeStamp - b.TimeStamp
              } else {
                return b.TimeStamp - a.TimeStamp
              }
            })
            txArraryInPool = txArraryInPool.sort((a, b) => {
              if (sortType === 'asc') {
                return a.TimeStamp - b.TimeStamp
              } else {
                return b.TimeStamp - a.TimeStamp
              }
            })
            response.status = '1'
            response.message = 'OK'
            response.resultInChain = txArray.slice((currentPage - 1) * pageSize, currentPage * pageSize)
            response.resultInPool = txArraryInPool.slice((currentPage - 1) * pageSize, currentPage * pageSize)
            response.currentPage = currentPage
            response.totalNumber = txArray.length
          }
          console.timeEnd('sen_getTransactions id: ' + requestID)
          callback(null, response)
        })
      }
    } catch (err) {
      response.status = '0'
      response.info = `Unexpected error occurs, error info: ${err}`
      console.timeEnd('sen_getTransactions id: ' + requestID)
      callback(null, response)
    }
  },

  /**
   * get all the previous transactions for a specific address with paging
   */
  sec_getTransactionsByBlock: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_getTransactionsByBlock id: ' + requestID)
    let response = {}
    let accAddr = args[0] // address
    let BlockNumber = parseInt(args[1])
    let currentPage = parseInt(1)
    let pageSize = parseInt(Number.MAX_SAFE_INTEGER)
    let sortType = 'asc'

    try {
      // verify accAddr
      if (accAddr[0] === '0' && accAddr[1] === 'x') {
        accAddr = accAddr.substr(2)
      }
      if (accAddr.length !== 40) {
        response.status = '0'
        response.message = `Invalid accAddress length (${accAddr.length}), should be 40`
        console.timeEnd('sen_getTransactionsByBlock id: ' + requestID)
        callback(null, response)
      } else {
        core.senAPIs.getTokenTxForUser(accAddr, (err, txArray) => {
          if (err) {
            response.status = '0'
            response.message = `Failed to get user transactions, error info: ${err}`
            response.resultInChain = []
          } else {
            txArray = txArray.filter((tx) => {
              return tx.BlockNumber === BlockNumber
            })
            txArray = txArray.sort((a, b) => {
              if (sortType === 'asc') {
                return a.TimeStamp - b.TimeStamp
              } else {
                return b.TimeStamp - a.TimeStamp
              }
            })
            response.status = '1'
            response.message = 'OK'
            response.resultInChain = txArray.slice((currentPage - 1) * pageSize, currentPage * pageSize)
            response.currentPage = currentPage
            response.totalNumber = txArray.length
          }
          console.timeEnd('sen_getTransactionsByBlock id: ' + requestID)
          callback(null, response)
        })
      }
    } catch (err) {
      response.status = '0'
      response.info = `Unexpected error occurs, error info: ${err}`
      console.timeEnd('sen_getTransactionsByBlock id: ' + requestID)
      callback(null, response)
    }
  },

  /**
  * get all the previous transactions for a specific address
  */
  sec_getMiningTransactions: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_getMiningTransactions id: ' + requestID)
    console.log(args)
    let response = {}
    let accAddr = args[0] // address

    let currentPage = parseInt(args[1] || 1)
    let pageSize = parseInt(args[2] || Number.MAX_SAFE_INTEGER)
    let sortType = args[3]

    if (accAddr[0] === '0' && accAddr[1] === 'x') {
      accAddr = accAddr.substr(2)
    }
    if (accAddr.length !== 40) {
      response.status = '0'
      response.message = `Invalid accAddress length (${accAddr.length}), should be 40`
      console.timeEnd('sen_getMiningTransactions id: ' + requestID)
      callback(null, response)
    } else {
      core.senAPIs.getTokenTxForUser(accAddr, (err, txArray) => {
        if (err) {
          response.status = '0'
          response.message = `Failed to get user transactions, error info: ${err}`
          response.resultInChain = []
        } else {
          txArray = txArray.filter(tx => { return tx.TxFrom === '0000000000000000000000000000000000000000' })
          let ChainHeight = core.senAPIs.getChainHeight()
          txArray = txArray.sort((a, b) => {
            return Number(a.BlockNumber) - Number(b.BlockNumber)
          })
          for (let i = txArray.length - 1; i > -1; i--) {
            if (txArray[i].BlockNumber > ChainHeight - 5) {
              txArray.pop()
            }
          }
          txArray = txArray.sort((a, b) => {
            if (sortType === 'asc') {
              return a.TimeStamp - b.TimeStamp
            } else {
              return b.TimeStamp - a.TimeStamp
            }
          })
          response.status = '1'
          response.message = 'OK'
          response.resultInChain = txArray.slice((currentPage - 1) * pageSize, currentPage * pageSize)
          response.currentPage = currentPage
          response.totalNumber = txArray.length
        }
        console.timeEnd('sen_getMiningTransactions id: ' + requestID)
        callback(null, response)
      })
    }
  },

  /**
  * request to initiate a transaction
  */
  sec_sendRawTransaction: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_sendRawTransaction id: ' + requestID)
    let response = {}
    try {
      if (parseFloat(args[0].value) === 0 || parseFloat(args[0].value) < 0) {
        response.status = '0'
        response.info = `Value Can not equal 0 or smaller than 0`
        console.timeEnd('sen_sendRawTransaction id: ' + requestID)
        return callback(null, response)
      }
      let tokenTx = {
        Nonce: args[0].nonce,
        TxReceiptStatus: 'pending',
        TimeStamp: args[0].timestamp,
        TxFrom: args[0].from.replace('0x', '').toLowerCase(),
        TxTo: args[0].to.replace('0x', '').toLowerCase(),
        Value: args[0].value,
        GasLimit: args[0].gasLimit,
        GasUsedByTxn: args[0].gas,
        GasPrice: args[0].gasPrice,
        TxFee: args[0].txFee,
        InputData: args[0].inputData,
        Signature: args[0].data
      }
      tokenTx = core.senAPIs.createSecTxObject(tokenTx).getTx()
      let txHash = tokenTx.TxHash
      core.CenterController.getSenChain().initiateTokenTx(tokenTx, (err) => {
        if (err) {
          response.status = '0'
          response.info = `Error occurs: ${err}`
        } else {
          response.status = '1'
          response.info = 'OK'
          response.txHash = txHash
        }
        console.timeEnd('sen_sendRawTransaction id: ' + requestID)
        callback(null, response)
      })
    } catch (err) {
      response.status = '0'
      response.info = `Unexpected error occurs, error info: ${err}`
      console.timeEnd('sen_sendRawTransaction id: ' + requestID)
      callback(null, response)
    }
  },

  sec_createContractTransaction: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_createContractTransaction' + requestID)
    let response = {}
    let tokenName = args[1]
    core.senAPIs.getContractAddress(tokenName, (err, address) => {
      if (err) {
        response.status = '0'
        response.info = `Unexpected error occurs, error info: ${err.stack}`
        console.timeEnd('sen_createContractTransaction' + requestID)
        callback(null, response)
      } else if (address) {
        response.status = '0'
        response.info = `Contract for TokenName already exists under: ${address}`
        console.timeEnd('sen_createContractTransaction' + requestID)
        callback(null, response)
      } else {
        let tokenTx = {
          Nonce: args[0].nonce,
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
            response.info = `Error occurs: ${err.stack}`
          } else {
            response.status = '1'
            response.info = 'OK'
            response.txHash = tokenTx.TxHash
          }
          console.timeEnd('sen_createContractTransaction' + requestID)
          callback(null, response)
        })
      }
    })
  },

  sec_sendContractTransaction: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_sendContractTransaction' + requestID)
    let response = {}
    core.senAPIs.getTokenName(args[0].to, (err, tokenname) => {
      if (err) {
        response.status = '0'
        response.info = `Unexpected error occurs, error info: ${err}`
        console.timeEnd('sen_sendContractTransaction' + requestID)
        callback(null, response)
      } else if (!tokenname) {
        response.status = '0'
        response.info = `ContractAddress doesn't exist`
        console.timeEnd('sen_sendContractTransaction' + requestID)
        callback(null, response)
      } else {
        let tokenTx = {
          Nonce: args[0].nonce,
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
            response.info = `Error occurs: ${err.stack}`
          } else {
            response.status = '1'
            response.info = 'OK'
            response.txHash = tokenTx.TxHash
          }
          console.timeEnd('sen_sendContractTransaction' + requestID)
          callback(null, response)
        })
      }
    })
  },

  sec_getTimeLock: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_getTimeLock' + requestID)
    let response = {}
    let contractAddress = args[0]
    let senderAddress = args[1]

    core.senAPIs.getTimeLock(contractAddress, (err, timeLock) => {
      if (err) {
        response.status = '0'
        response.info = `Error occurs: ${err.stack}`
      } else {
        if (senderAddress) {
          if (senderAddress in timeLock && senderAddress in timeLock[senderAddress]) {
            response.status = '1'
            response.info = 'OK'
            response.timeLock = timeLock[senderAddress][senderAddress]
          } else {
            response.status = '1'
            response.info = 'OK'
            response.timeLock = []
          }
        } else {
          response.status = '1'
          response.info = 'OK'
          response.timeLock = timeLock
        }
      }
      console.timeEnd('sen_getTimeLock' + requestID)
      callback(null, response)
    })
  },

  sec_getChainHeight: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_getChainHeight id: ' + requestID)
    let response = {}
    response.ChainHeight = core.senAPIs.getTokenChainHeight()
    console.timeEnd('sen_getChainHeight id: ' + requestID)
    callback(null, response)
  },

  sec_getLastBlock: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_getLastBlock id: ' + requestID)
    let response = {}
    let blockHeight = core.senAPIs.getTokenChainHeight()
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
      console.timeEnd('sen_getLastBlock id: ' + requestID)
      callback(null, response)
    })
  },

  sec_getTransactionByHash: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_getTransactionByHash id: ' + requestID)
    let response = {}
    let txHash = args[0]
    core.senAPIs.getTokenTx(txHash, txData => {
      response.status = '1'
      response.message = 'OK'
      response.tx = txData
      console.timeEnd('sen_getTransactionByHash id: ' + requestID)
      callback(null, response)
    })
  },

  sec_getNodeInfo: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_getNodeInfo id: ' + requestID)
    let response = {}
    core.senAPIs.getNodeIpv4((ipv4) => {
      response.status = '1'
      response.time = new Date().getTime()
      response.ipv4 = ipv4
      response.timeZone = geoip.lookup(ipv4).timezone
      console.timeEnd('sen_getNodeInfo id: ' + requestID)
      callback(null, response)
    })
  },

  sec_getTokenChainSize: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_getTokenChainSize id: ' + requestID)
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
      console.timeEnd('sen_getTokenChainSize id: ' + requestID)
      callback(null, response)
    })
  },

  sec_setPOW: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_setPOW id: ' + requestID)
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
    console.timeEnd('sen_setPOW id: ' + requestID)
    callback(null, response)
  },

  sec_startNetworkEvent: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_startNetworkEvent id: ' + requestID)
    let response = {}
    core.senAPIs.startNetworkEvent((result) => {
      if (result === true) {
        response.status = '1'
        response.info = 'OK'
      } else {
        response.status = '0'
        response.info = `Unexpected error occurs, error info: ${result}`
      }
      console.timeEnd('sen_startNetworkEvent id: ' + requestID)
      callback(null, response)
    })
  },

  sec_getBlockByHash: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_getBlockByHash id: ' + requestID)
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
      console.timeEnd('sen_getBlockByHash id: ' + requestID)
      callback(null, response)
    })
  },

  sec_getBlockByHeight: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_getBlockByHeight id: ' + requestID)
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
      console.timeEnd('sen_getBlockByHeight id: ' + requestID)
      callback(null, response)
    })
  },

  sec_getBlocks: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_getBlocks id: ' + requestID)
    let response = {}
    const blockHeightStart = args[0]
    const blockHeightEnd = args[1]
    core.senAPIs.getTokenBlockchain(blockHeightStart, blockHeightEnd, (err, block) => {
      if (err) {
        response.status = '0'
        response.message = `Failed to get block, error info: ${err}`
        response.blockInfo = []
      } else {
        response.status = '1'
        response.message = 'OK'
        response.blockInfo = block
      }
      console.timeEnd('sen_getBlocks id: ' + requestID)
      callback(null, response)
    })
  },

  sec_getWholeTokenBlockchain: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_getWholeTokenBlockchain id: ' + requestID)
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
      console.timeEnd('sen_getWholeTokenBlockchain id: ' + requestID)
      callback(null, response)
    })
  },

  sec_getTotalReward: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_getTotalReward id: ' + requestID)
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
      console.timeEnd('sen_getTotalReward id: ' + requestID)
      callback(null, response)
    })
  },

  sec_debug_getAccTreeAccInfo: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_debug_getAccTreeAccInfo id: ' + requestID)
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
      console.timeEnd('sen_debug_getAccTreeAccInfo id: ' + requestID)
      callback(null, response)
    })
  },

  sec_setAddress: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_setAddress id: ' + requestID)
    let response = {}
    core.senAPIs.setAddress(args[0])
    response.status = '1'
    response.message = 'OK'
    console.timeEnd('sen_setAddress id: ' + requestID)
    callback(null, response)
  },

  sec_getNonce: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_getNonce id: ' + requestID)
    let response = {}
    let address = args[0]
    core.senAPIs.getNonce(address, (err, nonce) => {
      if (err) {
        response.status = '0'
        response.info = `Unexpected error occurs, error info: ${err}`
      } else {
        response.status = '1'
        response.info = 'OK'
        response.Nonce = nonce
      }
      console.timeEnd('sen_getNonce id: ' + requestID)
      callback(null, response)
    })
  },

  /**
  * free charging function, for testing purpose
  */
  sec_freeCharge: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_freeCharge id: ' + requestID)
    const userInfo = {
      secAddress: '0000000000000000000000000000000000000001'
    }

    let response = {}
    if (process.env.netType === 'main' || process.env.netType === undefined) {
      response.status = '0'
      response.info = 'Main network does not support free charging'
      console.timeEnd('sen_freeCharge id: ' + requestID)
      return callback(null, response)
    } else {
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
        console.timeEnd('sen_freeCharge id: ' + requestID)
        callback(null, response)
      })
    }
  },

  sec_rebuildAccTree: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_rebuildAccTree id: ' + requestID)
    let response = {}
    core.senAPIs.rebuildAccTree((err) => {
      if (err) {
        response.status = '0'
        response.info = `Failed to rebuild account tree db, reason: ${err}`
      } else {
        response.status = '1'
        response.message = 'OK'
      }
      console.timeEnd('sen_rebuildAccTree id: ' + requestID)
      callback(null, response)
    })
  },

  sec_getSyncInfo: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_getSyncInfo id: ' + requestID)
    let response = {}
    response.status = '1'
    response.message = core.senAPIs.getSyncInfo()
    console.timeEnd('sen_getSyncInfo id: ' + requestID)
    callback(null, response)
  },

  sec_validateAddress: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_validateAddress id: ' + requestID)
    let response = {}
    let address = args[0]
    core.senAPIs.validateAddress(address, (result) => {
      if (result === true) {
        response.status = '1'
        response.jsonrpc = '2.0'
        response.result = 'true'
      } else {
        response.status = '0'
        response.info = `Address format is wrong, error info: ${result}`
      }
      console.timeEnd('sen_validateAddress id: ' + requestID)
      callback(null, response)
    })
  },

  /**
   * @param {array} args
   * @param {string} args[0].companyName 'coinegg', 'biki', 'bigone' 或者 'fcoin'才可以调用该rpc方法。
   * @param {string} args[0].privateKey 钱包私钥
   * @param {string} args[0].transfer 交易信息的json结构
   * @param {string} args[0].transfer.walletAddress 发起交易的钱包地址
   * @param {string} args[0].transfer.sendToAddress 收款方的钱包地址
   * @param {string} args[0].transfer.amount 交易的BIUT金额
   * @param {string} args[0].transfer.txFee 交易BIU手续费
   * @param {function} callback(err, response) rpc回调函数
   * @param {json} callback.response 回调函数的传入参数response
   * @param {string} response.status '0' error; '1': 'success'
   * @param {string} response.message response的信息
   * @param {array} response.signedTrans 签名过后的交易数组。可直接作为下一步发送交易直接使用
   */
  sec_signedTransaction: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_signedTransaction id: ' + requestID)
    let response = {}
    try {
      let companyName = args[0].companyName
      let privateKey = args[0].privateKey
      let transfer = args[0].transfer
      if (companyName !== 'coinegg' && companyName !== 'fcoin' && companyName !== 'biki' && companyName !== 'bigone') {
        response.status = '0'
        response.message = 'No authorized to use the api'
      } else {
        let signedTrans = _signTransaction(privateKey, transfer)
        response.status = '1'
        response.message = 'signed transaction success'
        response.signedTrans = signedTrans
      }
    } catch (e) {
      response.status = '0'
      response.message = 'Bad Request.'
    }
    console.timeEnd('sen_signedTransaction id: ' + requestID)
    callback(null, response)
  },

  // _syncFromIp: function (args, callback) {
  //   let response = {}
  //   if (args[0].ip === null) {
  //     response.status = '0'
  //     response.message = 'Needs a valid ip address'
  //     callback(response)
  //   } else {
  //     core.senAPIs.syncFromIp(args[0].ip, (err) => {
  //       if (err) {
  //         response.status = '0'
  //         response.message = 'Failed, reason: ' + err
  //       } else {
  //         response.status = '1'
  //         response.message = 'OK'
  //       }
  //       callback(null, response)
  //     })
  //   }
  // }
  sec_getHashList: function (args, callback) {
    let requestID = ++_requestID
    console.time('sen_getHashList id: ' + requestID)
    let response = {}
    const start = isNaN(parseInt(args[0])) ? undefined : args[0]
    const end = isNaN(parseInt(args[1])) ? undefined : args[1]
    core.senAPIs.getHashList((err, HashList) => {
      if (err) {
        response.status = '0'
        response.message = err
      } else {
        response.status = '1'
        response.HashList = HashList
      }
      console.timeEnd('sen_getHashList id: ' + requestID)
      callback(null, response)
    }, start, end)
  },

  sec_getPoolTransactions: function (args, callback) {
    const requestID = ++_requestID
    console.time('sen_getPoolTransactions id: ' + requestID)
    const response = {}
    const accAddr = args[0] // address
    const txArraryInPool = core.senAPIs.getTokenTxInPoolByAddress(accAddr)
    response.status = '1'
    response.txArraryInPool = txArraryInPool
    console.timeEnd('sen_getPoolTransactions id: ' + requestID)
    callback(null, response)
  },

  sec_getPool: function (args, callback) {
    const requestID = ++_requestID
    console.time('sec_getPool id: ' + requestID)
    const response = {}
    const txArraryInPool = core.senAPIs.getAllPool()
    response.status = '1'
    response.txArraryInPool = txArraryInPool
    console.timeEnd('sec_getPool id: ' + requestID)
    callback(null, response)
  },

  sec_removeBlocks: function (args, callback) {
    const response = {}
    core.CenterController.getSenChain().chain.delBlockFromHeight(44969, (err, txArray) => {
      if (err) {
        response.status = '0'
        response.info = `Error occurs: ${err}`
      } else {
        response.status = '1'
        response.info = 'OK'
        response.txArray = txArray
      }
      callback(null, response)
    })
  }
})

exports.runRpc = function (_core) {
  core = _core
  server.http().listen(3003)
}
