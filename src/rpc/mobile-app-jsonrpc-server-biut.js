const geoip = require('geoip-lite')
const jayson = require('jayson')
const SECUtil = require('@biut-block/biutjs-util')
const CryptoJS = require('crypto-js')
let core = {}
const fs = require('fs')
const path = require('path')

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

function _registerPrivateKey (privateKey) {
  let keylib = { table: [] }
  let key = privateKey
  keylib.table.push(key)
  fs.appendFile(path.join(__dirname, '../keylib.json'), JSON.stringify(keylib), 'utf-8', (err) => {
    if (err) {
      console.log(err)
    }
    console.log('Register key successed')
  })
}

function _getPrivateKeysFromAddress (userAddress) {
  fs.readFile(path.join(__dirname, '../keylib.json'), 'utf-8', (err, data) => {
    if (err) {
      console.log(err)
    } else {
      let obj = JSON.parse(data)
      for (var i = 0; i < obj.table.length; i++) {
        if (obj.table[i].userAddress === userAddress) {
          return obj.table[i].privateKey
        }
      }
    }
  })
}

function _signTransaction (userAddress, transfer) {
  let transferData = [{
    timestamp: transfer.timeStamp,
    from: transfer.walletAddress,
    to: transfer.sendToAddress,
    value: transfer.amount,
    txFee: transfer.txFee,
    gasLimit: '0',
    gas: '0',
    gasPrice: '0',
    data: '',
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
    Buffer.from(transferData[0].inputData),
    'SEC'
  ]
  let txSigHash = Buffer.from(SECUtil.rlphash(tokenTxBuffer).toString('hex'), 'hex')
  let privateKey = _getPrivateKeysFromAddress(userAddress)
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
  biut_getBalance: function (args, callback) {
    console.time('biut_getBalance')
    let response = {}
    // if (args[0].coinType = null) {
    // return all coins
    // } else {
    // args[0].coinType
    // }
    try {
      let accAddr = args[0]
      // let time = args[1] 'latest'
      core.secAPIs.getBalance(accAddr, (err, balance) => {
        if (err) {
          response.status = '0'
          response.info = `Failed to get user balance, error info: ${err}`
        } else {
          response.status = '1'
          response.info = 'OK'
          response.value = balance
          // response.value = {}
        }
        console.timeEnd('biut_getBalance')
        callback(null, response)
      })
    } catch (err) {
      response.status = 'false'
      response.info = 'Arg[0] is empty, no account address received'
      response.value = '0'
      console.timeEnd('biut_getBalance')
      callback(null, response)
    }
  },

  /**
    * get all the previous transactions for a specific address with paging
    */
  biut_getTransactions: function (args, callback) {
    console.time('biut_getTransactions')
    let response = {}
    let accAddr = args[0] // address

    let currentPage = parseInt(args[1] || 1)
    let pageSize = parseInt(args[2] || 39)

    // verify accAddr
    if (accAddr[0] === '0' && accAddr[1] === 'x') {
      accAddr = accAddr.substr(2)
    }
    if (accAddr.length !== 40) {
      response.status = '0'
      response.message = `Invalid accAddress length (${accAddr.length}), should be 40`
      console.timeEnd('biut_getTransactions')
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
          response.resultInChain = txArray.reverse().slice((currentPage - 1) * pageSize, currentPage * pageSize)
          response.resultInPool = txArraryInPool.reverse().slice((currentPage - 1) * pageSize, currentPage * pageSize)
          response.currentPage = currentPage
          response.totalNumber = txArray.length
        }
        console.timeEnd('biut_getTransactions')
        callback(null, response)
      })
    }
  },

  /**
  * request to initiate a transaction
  */
  biut_sendRawTransaction: function (args, callback) {
    console.time('biut_sendRawTransaction')
    let response = {}
    // get nonce for signing the tx
    core.secAPIs.getNonce(args[0].from, (err, nonce) => {
      if (err) {
        response.status = '0'
        response.info = `Unexpected error occurs, error info: ${err}`
        console.timeEnd('biut_sendRawTransaction')
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
        tokenTx = core.secAPIs.createSecTxObject(tokenTx).getTx()
        core.CenterController.getSecChain().initiateTokenTx(tokenTx, (err) => {
          if (err) {
            response.status = '0'
            response.info = `Error occurs: ${err}`
          } else {
            response.status = '1'
            response.info = 'OK'
            response.txHash = tokenTx.TxHash
          }
          console.timeEnd('biut_sendRawTransaction')
          callback(null, response)
        })
      }
    })
  },

  biut_getChainHeight: function (args, callback) {
    console.time('biut_getChainHeight')
    let response = {}
    response.ChainHeight = core.secAPIs.getTokenChainHeight()
    console.timeEnd('biut_getChainHeight')
    callback(null, response)
  },

  biut_getNodeInfo: function (args, callback) {
    console.time('biut_getNodeInfo')
    let response = {}
    core.secAPIs.getNodeIpv4((ipv4) => {
      response.status = '1'
      response.time = new Date().getTime()
      // response.ipv4 = ipv4
      response.ipv4 = 'test'
      response.timeZone = geoip.lookup(ipv4).timezone
      console.timeEnd('biut_getNodeInfo')
      callback(null, response)
    })
  },

  biut_getTokenChainSize: function (args, callback) {
    console.time('biut_getTokenChainSize')
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
      console.timeEnd('biut_getTokenChainSize')
      callback(null, response)
    })
  },

  biut_setPOW: function (args, callback) {
    console.time('biut_setPOW')
    let response = {}
    let command = args[0] // '0' means disable POW, '1' means enable POW

    if (command === '0') {
      core.biutAPIs.disablePOW()
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
    console.timeEnd('biut_setPOW')
    callback(null, response)
  },

  biut_startNetworkEvent: function (args, callback) {
    console.time('biut_startNetworkEvent')
    let response = {}
    core.secAPIs.startNetworkEvent((result) => {
      if (result === true) {
        response.status = '1'
        response.info = 'OK'
      } else {
        response.status = '0'
        response.info = `Unexpected error occurs, error info: ${result}`
      }
      console.timeEnd('biut_startNetworkEvent')
      callback(null, response)
    })
  },

  biut_getBlockByHash: function (args, callback) {
    console.time('biut_getBlockByHash')
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
      console.timeEnd('biut_getBlockByHash')
      callback(null, response)
    })
  },

  sec_getBlockByHeight: function (args, callback) {
    console.time('biut_getBlockByHeight')
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
      console.timeEnd('biut_getBlockByHeight')
      callback(null, response)
    })
  },

  biut_getWholeTokenBlockchain: function (args, callback) {
    console.time('biut_getWholeTokenBlockchain')
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
      console.timeEnd('biut_getWholeTokenBlockchain')
      callback(null, response)
    })
  },

  biut_debug_getAccTreeAccInfo: function (args, callback) {
    console.time('biut_debug_getAccTreeAccInfo')
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
      console.timeEnd('biut_debug_getAccTreeAccInfo')
      callback(null, response)
    })
  },

  biut_setAddress: function (args, callback) {
    console.time('biut_setAddress')
    let response = {}
    core.secAPIs.setAddress(args[0])
    response.status = '1'
    response.message = 'OK'
    console.timeEnd('sec_setAddress')
    callback(null, response)
  },

  /**
  * free charging function, for testing purpose
  */
  biut_freeCharge: function (args, callback) {
    console.time('biut_freeCharge')
    const userInfo = {
      biutAddress: '0000000000000000000000000000000000000001'
    }

    let response = {}
    if (process.env.netType === 'main' || process.env.netType === undefined) {
      response.status = '0'
      response.info = 'Main network does not support free charging'
      console.timeEnd('biut_freeCharge')
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
        console.timeEnd('biut_freeCharge')
        callback(null, response)
      })
    }
  },

  biut_rebuildAccTree: function (args, callback) {
    console.time('biut_rebuildAccTree')
    let response = {}
    core.secAPIs.rebuildAccTree((err) => {
      if (err) {
        response.status = '0'
        response.info = `Failed to rebuild account tree db, reason: ${err}`
      } else {
        response.status = '1'
        response.message = 'OK'
      }
      console.timeEnd('biut_rebuildAccTree')
      callback(null, response)
    })
  },

  biut_getSyncInfo: function (args, callback) {
    console.time('biut_getSyncInfo')
    let response = {}
    response.status = '1'
    response.message = core.secAPIs.getSyncInfo()
    console.timeEnd('biut_getSyncInfo')
    callback(null, response)
  },

  biut_getRLPPeersNumber: function (args, callback) {
    console.time('biut_getRLPPeersNumber')
    let response = {}
    response.status = '1'
    response.message = core.secAPIs.getRLPPeersNumber() + 1
    console.timeEnd('biut_getRLPPeersNumber')
    callback(null, response)
  },

  biut_validateAddress: function (args, callback) {
    console.time('biut_validateAddress')
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
      console.timeEnd('biut_validateAddress')
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
  /*
  biut_generateWalletKeys: function (args, callback) {
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
  */

  /* 替代generatedWalletKeys, 不返回其他的key, 只返回address， 其他的可以存入本json文件中 */
  biut_getNewAddress: function (args, callback) {
    let response = {}
    let companyName = args[0]
    if (companyName !== 'coinegg' && companyName !== 'fcoin' && companyName !== 'biki') {
      response.status = '0'
      response.message = 'No authorized to use the api'
    } else {
      let generatedKeys = _getWalletKeys()
      _registerPrivateKey(generatedKeys)
      response.status = '1'
      response.result = generatedKeys.userAddress
      response.message = 'get new address success'
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
  biut_getKeysFromPrivate: function (args, callback) {
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
   * @param {string} args[0].companyName 'coinegg' 或者 'fcoin'才可以调用该rpc方法。
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

  biut_signedTransaction: function (args, callback) {
    let response = {}
    try {
      let companyName = args[0].companyName
      // let privateKey = args[0].privateKey
      let userAddress = args[0].userAddress
      let transfer = args[0].transfer
      if (companyName !== 'coinegg' && companyName !== 'fcoin' && companyName !== 'biki') {
        response.status = '0'
        response.message = 'No authorized to use the api'
      } else {
        let signedTrans = _signTransaction(userAddress, transfer)
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

})

exports.runRpc = function (_core) {
  core = _core
  server.http().listen(3004)
}
