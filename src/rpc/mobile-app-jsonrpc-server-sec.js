const geoip = require('geoip-lite')
const jayson = require('jayson')
const SECUtil = require('@biut-block/biutjs-util')
let core = {}

function _getWalletKeys () {
  let keys = SECUtil.generateSecKeys()
  let privKey64 = keys.privKey
  let privateKey = privKey64
  let englishWords = SECUtil.entropyToMnemonic(privKey64)
  let pubKey128 = keys.publicKey
  let pubKey128ToString = pubKey128.toString('hex')
  let userAddressToString = keys.secAddress

  return {
    privateKey: privateKey,
    publicKey: pubKey128ToString,
    englishWords: englishWords,
    userAddress: userAddressToString
  }
}

function _getKeysFromPrivateKey (privateKey) {
  try {
    let privateKeyBuffer = SECUtil.privateToBuffer(privateKey)
    let extractAddress = SECUtil.privateToAddress(privateKeyBuffer).toString('hex')
    let extractPublicKey = SECUtil.privateToPublic(privateKeyBuffer).toString('hex')
    let extractPhrase = SECUtil.entropyToMnemonic(privateKeyBuffer)
    return {
      privateKey: privateKey,
      publicKey: extractPublicKey,
      englishWords: extractPhrase,
      walletAddress: extractAddress
    }
  } catch (e) {
    throw new Error(e)
  }
}

function _signTransaction (privateKey, transfer) {
  let transferData = [{
    timestamp: transfer.timeStamp,
    from: transfer.walletAddress.replace('0x', ''),
    to: transfer.sendToAddress.replace('0x', ''),
    value: transfer.amount,
    txFee: transfer.txFee,
    gasLimit: '0',
    gas: '0',
    gasPrice: '0',
    data: '',
    nonce: transfer.nonce,
    inputData: ''
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
    Buffer.from('SEC')
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
    console.time('sec_getBalance')
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
        tokenName = 'SEC'
      }
      // let time = args[1] 'latest'
      core.secAPIs.getBalance(accAddr, tokenName, (err, balance) => {
        if (err) {
          response.status = '0'
          response.info = `Failed to get user balance, error info: ${err}`
        } else {
          response.status = '1'
          response.info = 'OK'
          response.value = balance
          // response.value = {}
        }
        console.timeEnd('sec_getBalance')
        callback(null, response)
      })
    } catch (err) {
      response.status = 'false'
      response.info = 'Arg[0] is empty, no account address received'
      response.value = '0'
      console.timeEnd('sec_getBalance')
      callback(null, response)
    }
  },

  /**
   * get all the previous transactions for a specific address
   */
  /* sec_getTransactions: function (args, callback) {
    console.time('sec_getTransactions')
    let response = {}
    let accAddr = args[0] // address

    // verify accAddr
    if (accAddr[0] === '0' && accAddr[1] === 'x') {
      accAddr = accAddr.substr(2)
    }
    if (accAddr.length !== 40) {
      response.status = '0'
      response.message = `Invalid accAddress length (${accAddr.length}), should be 40`
      console.timeEnd('sec_getTransactions')
      callback(null, response)
    } else {
      core.secAPIs.getTokenTxForUser(accAddr, (err, txArray) => {
        if (err) {
          response.status = '0'
          response.message = `Failed to get user transactions, error info: ${err}`
          response.resultInChain = []
          response.resultInPool = []
        } else {
          let txArraryInPool = core.secAPIs.getTokenTxInPoolByAddress(accAddr)
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
        console.timeEnd('sec_getTransactions')
        callback(null, response)
      })
    }
  },
  */
  /**
   * get all the previous transactions for a specific address with paging
   */
  sec_getTransactions: function (args, callback) {
    console.time('sec_getTransactions')
    let response = {}
    let accAddr = args[0] // address

    let currentPage = parseInt(args[1] || 1)
    let pageSize = parseInt(args[2] || Number.MAX_SAFE_INTEGER)
    let sortType = args[3]

    // verify accAddr
    if (accAddr[0] === '0' && accAddr[1] === 'x') {
      accAddr = accAddr.substr(2)
    }
    if (accAddr.length !== 40) {
      response.status = '0'
      response.message = `Invalid accAddress length (${accAddr.length}), should be 40`
      console.timeEnd('sec_getTransactions')
      callback(null, response)
    } else {
      core.secAPIs.getTokenTxForUser(accAddr, (err, txArray) => {
        if (err) {
          response.status = '0'
          response.message = `Failed to get user transactions, error info: ${err}`
          response.resultInChain = []
          response.resultInPool = []
        } else {
          let txArraryInPool = core.secAPIs.getTokenTxInPoolByAddress(accAddr)
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
        console.timeEnd('sec_getTransactions')
        callback(null, response)
      })
    }
  },

  /**
   * request to initiate a transaction
   */
  sec_sendRawTransaction: function (args, callback) {
    console.time('sec_sendRawTransaction')
    let response = {}
    try {
      if (parseFloat(args[0].value) === 0 || parseFloat(args[0].value) < 0) {
        response.status = '0'
        response.info = `Value Can not equal 0 or smaller than 0`
        console.timeEnd('sen_sendRawTransaction')
        return callback(null, response)
      }

      let tokenTx = {
        Nonce: args[0].nonce,
        TxReceiptStatus: 'pending',
        TimeStamp: args[0].timestamp,
        TxFrom: args[0].from.replace('0x', ''),
        TxTo: args[0].to.replace('0x', ''),
        Value: args[0].value,
        GasLimit: args[0].gasLimit,
        GasUsedByTxn: args[0].gas,
        GasPrice: args[0].gasPrice,
        TxFee: args[0].txFee,
        InputData: args[0].inputData,
        Signature: args[0].data
      }
      tokenTx = core.secAPIs.createSecTxObject(tokenTx).getTx()
      let txHash = tokenTx.TxHash
      core.CenterController.getSecChain().initiateTokenTx(tokenTx, (err) => {
        if (err) {
          response.status = '0'
          response.info = `Error occurs: ${err}`
        } else {
          response.status = '1'
          response.info = 'OK'
          response.txHash = txHash
        }
        console.timeEnd('sec_sendRawTransaction')
        callback(null, response)
      })
    } catch (err) {
      response.status = '0'
      response.info = `Unexpected error occurs, error info: ${err}`
      console.timeEnd('sen_sendRawTransaction')
      callback(null, response)
    }
  },

  sec_createContractTransaction: function (args, callback) {
    let response = {}
    let tokenName = args[1]
    core.secAPIs.getContractAddress(tokenName, (err, address) => {
      if (err) {
        response.status = '0'
        response.info = `Unexpected error occurs, error info: ${err.stack}`
        callback(null, response)
      } else if (address) {
        response.status = '0'
        response.info = `Contract for TokenName already exists under: ${address}`
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
        tokenTx = core.secAPIs.createSecTxObject(tokenTx).getTx()
        core.CenterController.getSecChain().initiateTokenTx(tokenTx, (err) => {
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
  },

  sec_sendContractTransaction: function (args, callback) {
    let response = {}
    core.secAPIs.getContractInfo(args[0].to, (err, tokenInfo) => {
      if (err) {
        response.status = '0'
        response.info = `Unexpected error occurs, error info: ${err}`
        callback(null, response)
      } else if (!tokenInfo.tokenName) {
        response.status = '0'
        response.info = `ContractAddress doesn't exist`
        callback(null, response)
      } else {
        // let regexPattern = /transfer\(\s*(\w+),\s*([0-9]+[.]*[0-9]*)\)/
        // if(args[0].inputData.match(regexPattern)){
        //   let txAmount = RegExp.$2
        //   if (txAmount > args[0].value) {
        //     response.status = '0'
        //     response.info = 'Smart Contract transaction requires more than sent'
        //     callback(null, response)
        //   }
        // }
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
        tokenTx = core.secAPIs.createSecTxObject(tokenTx).getTx()
        core.CenterController.getSecChain().initiateTokenTx(tokenTx, (err) => {
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
  },

  // sec_getTimeLock: function(args, callback) {
  //   console.time('sec_getTimeLock')
  //   let response = {}
  //   let contractAddress = args[0]
  //   let senderAddress = args[1]

  //   core.secAPIs.getTimeLock(contractAddress, (err, timeLock)=>{
  //     if(err) {
  //       response.status = '0'
  //       response.info = `Error occurs: ${err.stack}`
  //     } else {
  //       if(senderAddress){
  //         if(senderAddress in timeLock && senderAddress in timeLock[senderAddress]){
  //           response.status = '1'
  //           response.info = 'OK'
  //           response.timeLock = timeLock[senderAddress][senderAddress]
  //         } else {
  //           response.status = '1'
  //           response.info = 'OK'
  //           response.timeLock = []
  //         }
  //       } else {
  //         response.status = '1'
  //         response.info = 'OK'
  //         response.timeLock = timeLock
  //       }
  //     }
  //     console.timeEnd('sec_getTimeLock')
  //     callback(null, response)
  //   })
  // },

  sec_getContractInfo: function (args, callback) {
    console.time('sec_getContractInfo')
    let response = {}
    let contractAddress = args[0]

    core.secAPIs.getContractInfo(contractAddress, (err, contractInfo) => {
      if (err) {
        response.status = '0'
        response.info = `Error occurs: ${err.stack}`
      } else {
        response.status = '1'
        response.info = 'OK'
        response.contractInfo = contractInfo
      }
      console.timeEnd('sec_getContractInfo')
      callback(null, response)
    })
  },

  sec_getCreatorContract: function (args, callback) {
    console.time('sec_getCreatorContract')
    let response = {}
    let creatorAddress = args[0]
    core.secAPIs.getCreatorContract(creatorAddress, (err, contractInfo) => {
      if (err) {
        response.status = '0'
        response.info = `Error occurs: ${err.stack}`
      } else {
        response.status = '1'
        response.info = 'OK'
        response.contractAddress = contractInfo
      }
      console.timeEnd('sec_getCreatorContract')
      callback(null, response)
    })
  },

  sec_getLockerContract: function (args, callback) {
    console.time('sec_getLockerContract')
    let response = {}
    let walletAddress = args[0]
    core.secAPIs.getLockerContract(walletAddress, (err, contractAddrArr) => {
      if (err) {
        response.status = '0'
        response.info = `Error occurs: ${err.stack}`
      } else {
        response.status = '1'
        response.info = 'OK'
        response.contractAddrArr = contractAddrArr
      }
      console.timeEnd('sec_getLockerContract')
      callback(null, response)
    })
  },

  sec_getMultiCreatorContract: function (args, callback) {
    console.time('sec_getCreatorContract')
    let response = {}
    let creatorAddressArr = args[0]
    let promiseList = []

    let promFunction = function (creatorAddress) {
      return new Promise(function (resolve, reject) {
        core.secAPIs.getCreatorContract(creatorAddress, (err, contractAddress) => {
          if (err) {
            reject(err)
          } else {
            resolve({ [creatorAddress]: contractAddress })
          }
        })
      })
    }

    creatorAddressArr.forEach((creatorAddress) => {
      promiseList.push(promFunction(creatorAddress))
    })

    Promise.all(promiseList).then((contractAddressArr) => {
      response.status = '1'
      response.info = 'OK'
      response.contractAddress = contractAddressArr
      callback(null, response)
      console.timeEnd('sec_getCreatorContract')
    }).catch((err) => {
      response.status = '0'
      response.info = `Error occurs: ${err.stack}`
      callback(null, response)
      console.timeEnd('sec_getCreatorContract')
    })
  },

  sec_getChainHeight: function (args, callback) {
    console.time('sec_getChainHeight')
    let response = {}
    response.ChainHeight = core.secAPIs.getTokenChainHeight()
    console.timeEnd('sec_getChainHeight')
    callback(null, response)
  },

  sec_getNodeInfo: function (args, callback) {
    console.time('sec_getNodeInfo')
    let response = {}
    core.secAPIs.getNodeIpv4((ipv4) => {
      response.status = '1'
      response.time = new Date().getTime()
      // response.ipv4 = ipv4
      response.ipv4 = 'test'
      response.timeZone = geoip.lookup(ipv4).timezone
      console.timeEnd('sec_getNodeInfo')
      callback(null, response)
    })
  },

  sec_getTokenChainSize: function (args, callback) {
    console.time('sec_getTokenChainSize')
    core.secAPIs.getTokenChainSize((err, size) => {
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
      console.timeEnd('sec_getTokenChainSize')
      callback(null, response)
    })
  },

  sec_setPOW: function (args, callback) {
    console.time('sec_setPOW')
    let response = {}
    let command = args[0] // '0' means disable POW, '1' means enable POW

    if (command === '0') {
      core.secAPIs.disablePOW()
      response.status = '1'
      response.info = 'OK'
    } else if (command === '1') {
      core.secAPIs.enablePOW()
      response.status = '1'
      response.info = 'OK'
    } else {
      response.status = '0'
      response.info = 'Invalid input argument'
    }
    console.timeEnd('sec_setPOW')
    callback(null, response)
  },

  sec_startNetworkEvent: function (args, callback) {
    console.time('sec_startNetworkEvent')
    let response = {}
    core.secAPIs.startNetworkEvent((result) => {
      if (result === true) {
        response.status = '1'
        response.info = 'OK'
      } else {
        response.status = '0'
        response.info = `Unexpected error occurs, error info: ${result}`
      }
      console.timeEnd('sec_startNetworkEvent')
      callback(null, response)
    })
  },

  sec_getBlockByHash: function (args, callback) {
    console.time('sec_getBlockByHash')
    let response = {}
    let blockHash = args[0]
    core.secAPIs.getTokenBlock(blockHash, (err, block) => {
      if (err) {
        response.status = '0'
        response.message = `Failed to get user Block, error info: ${err}`
        response.blockInfo = []
      } else {
        response.status = '1'
        response.message = 'OK'
        response.blockInfo = block
      }
      console.timeEnd('sec_getBlockByHash')
      callback(null, response)
    })
  },

  sec_getBlockByHeight: function (args, callback) {
    console.time('sec_getBlockByHeight')
    let response = {}
    let blockHeight = args[0]
    core.secAPIs.getTokenBlockchain(blockHeight, blockHeight, (err, block) => {
      if (err) {
        response.status = '0'
        response.message = `Failed to get block, error info: ${err}`
        response.blockInfo = []
      } else {
        response.status = '1'
        response.message = 'OK'
        response.blockInfo = block
      }
      console.timeEnd('sec_getBlockByHeight')
      callback(null, response)
    })
  },

  sec_getWholeTokenBlockchain: function (args, callback) {
    console.time('sec_getWholeTokenBlockchain')
    let response = {}
    core.secAPIs.getWholeTokenBlockchain((err, value) => {
      if (err) {
        response.status = '0'
        response.info = `Failed to get Whole TokenBlockchain, error info: ${err}`
      } else {
        response.status = '1'
        response.message = 'OK'
        response.info = value
      }
      console.timeEnd('sec_getWholeTokenBlockchain')
      callback(null, response)
    })
  },

  sec_debug_getAccTreeAccInfo: function (args, callback) {
    console.time('sec_debug_getAccTreeAccInfo')
    let response = {}
    core.secAPIs.getAccTreeAccInfo(args[0], (err, info) => {
      if (err) {
        response.status = '0'
        response.info = `Failed to get Account Info, error info: ${err}`
      } else {
        response.status = '1'
        response.message = 'OK'
        response.info = info
      }
      console.timeEnd('sec_debug_getAccTreeAccInfo')
      callback(null, response)
    })
  },

  sec_setAddress: function (args, callback) {
    console.time('sec_setAddress')
    let response = {}
    core.secAPIs.setAddress(args[0])
    response.status = '1'
    response.message = 'OK'
    console.timeEnd('sec_setAddress')
    callback(null, response)
  },

  sec_getNonce: function (args, callback) {
    let response = {}
    let address = args[0]
    core.secAPIs.getNonce(address, (err, nonce) => {
      if (err) {
        response.status = '0'
        response.info = `Unexpected error occurs, error info: ${err}`
      } else {
        response.status = '1'
        response.info = 'OK'
        response.Nonce = nonce
      }
      callback(null, response)
    })
  },

  /**
   * free charging function, for testing purpose
   */
  sec_freeCharge: function (args, callback) {
    console.time('sec_freeCharge')
    const userInfo = {
      secAddress: '0000000000000000000000000000000000000001'
    }

    let response = {}
    if (process.env.netType === 'main' || process.env.netType === undefined) {
      response.status = '0'
      response.info = 'Main network does not support free charging'
      console.timeEnd('sec_freeCharge')
      return callback(null, response)
    } else {
      core.secAPIs.getNonce(userInfo.secAddress, (err, nonce) => {
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

          tokenTx = core.secAPIs.createSecTxObject(tokenTx).getTx()
          core.CenterController.getSecChain().initiateTokenTx(tokenTx, (err) => {
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
        console.timeEnd('sec_freeCharge')
        callback(null, response)
      })
    }
  },

  sec_rebuildAccTree: function (args, callback) {
    console.time('sec_rebuildAccTree')
    let response = {}
    core.secAPIs.rebuildAccTree((err) => {
      if (err) {
        response.status = '0'
        response.info = `Failed to rebuild account tree db, reason: ${err}`
      } else {
        response.status = '1'
        response.message = 'OK'
      }
      console.timeEnd('sec_rebuildAccTree')
      callback(null, response)
    })
  },

  sec_getSyncInfo: function (args, callback) {
    console.time('sec_getSyncInfo')
    let response = {}
    response.status = '1'
    response.message = core.secAPIs.getSyncInfo()
    console.timeEnd('sec_getSyncInfo')
    callback(null, response)
  },

  sec_getRLPPeersNumber: function (args, callback) {
    console.time('sec_getRLPPeersNumber')
    let response = {}
    response.status = '1'
    response.message = core.secAPIs.getRLPPeersNumber() + 1
    console.timeEnd('sec_getRLPPeersNumber')
    callback(null, response)
  },

  sec_validateAddress: function (args, callback) {
    console.time('sec_validateAddress')
    let response = {}
    let address = args[0]
    core.secAPIs.validateAddress(address, (result) => {
      if (result === true) {
        response.status = '1'
        response.jsonrpc = '2.0'
        response.result = 'true'
      } else {
        response.status = '0'
        response.info = `Address format is wrong, error info: ${result}`
      }
      console.timeEnd('sec_validateAddress')
      callback(null, response)
    })
  },

  /**
   * @param {array} args
   * @param {string} args[0] 'coinegg' 或者 'fcoin'才可以调用该rpc方法。
   * @param {function} callback(err, response) rpc回调函数
   * @param {json} callback.response 回调函数的传入参数response
   * @param {string} response.status '0' error; '1': 'success'
   * @param {string} response.message response的信息
   * @param {json} response.keys 生成的keys
   * @param {string} keys.privateKey 钱包的私钥
   * @param {string} keys.publicKey 钱包的公钥
   * @param {string} keys.englishWords 钱包助记词
   * @param {string} keys.useraddress 钱包的地址
   */
  sec_generateWalletKeys: function (args, callback) {
    let response = {}
    let companyName = args[0]
    if (companyName !== 'coinegg' && companyName !== 'fcoin' && companyName !== 'biki') {
      response.status = '0'
      response.message = 'No authorized to use the api'
    } else {
      let generatedKeys = _getWalletKeys()
      response.status = '1'
      response.keys = generatedKeys
      response.message = 'Generate key success'
    }
    callback(null, response)
  },

  /**
   * @param {array} args
   * @param {string} args[0].companyName 'coinegg' 或者 'fcoin'才可以调用该rpc方法.
   * @param {string} args[0].privateKey 钱包的私钥。
   * @param {function} callback(err, response) rpc回调函数
   * @param {json} callback.response 回调函数的传入参数response
   * @param {string} response.status '0' error; '1': 'success'
   * @param {string} response.message response的信息
   * @param {json} response.keys 通过privateKey转换的keys
   * @param {string} keys.privateKey 钱包的私钥
   * @param {string} keys.publicKey 钱包的公钥
   * @param {string} keys.englishWords 钱包助记词
   * @param {string} keys.useraddress 钱包的地址
   */
  sec_getKeysFromPrivate: function (args, callback) {
    let response = {}
    try {
      let companyName = args[0].companyName
      let privateKey = args[0].privateKey
      if (companyName !== 'coinegg' && companyName !== 'fcoin' && companyName !== 'biki') {
        response.status = '0'
        response.message = 'No authorized to use the api'
      } else {
        let keys = _getKeysFromPrivateKey(privateKey)
        response.status = '1'
        response.keys = keys
        response.message = 'Get keys successed'
      }
    } catch (e) {
      response.status = '0'
      response.message = 'Bad Request.'
    }
    callback(null, response)
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
    callback(null, response)
  }

  // _setBlock: function (args, callback) {
  //   let response = {}
  //   core.secAPIs.writeBlock(args[0], (err) => {
  //     if (err) {
  //       response.status = '0'
  //       response.message = 'Failed, reason: ' + err
  //     } else {
  //       response.status = '1'
  //       response.message = 'OK'
  //     }
  //     callback(null, response)
  //   })
  // },

  // _syncFromIp: function (args, callback) {
  //   let response = {}
  //   if (args[0].ip === null) {
  //     response.status = '0'
  //     response.message = 'Needs a valid ip address'
  //     callback(response)
  //   } else {
  //     core.secAPIs.syncFromIp(args[0].ip, (err) => {
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
})

exports.runRpc = function (_core) {
  core = _core
  server.http().listen(3002)
}
