const jayson = require('jayson')
const SECUtil = require('@biut-block/biutjs-util')
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
  var content = JSON.stringify(privateKey) + ','
  fs.appendFileSync(path.join(__dirname, '../keylib.json'), content)
}

function _getPrivateKeysFromAddress (userAddress) {
  /* 同步 */
  let data = fs.readFileSync(path.join(__dirname, '../keylib.json'), 'utf-8')
  let _data = data.substring(0, data.length - 1)
  let transData = '{"table": [' + _data + ']}'
  let jsonData = JSON.parse(transData)
  let privateKey
  for (var i = 0; i < jsonData.table.length; i++) {
    if (jsonData.table[i].userAddress === userAddress) {
      privateKey = jsonData.table[i].privateKey
    }
  }
  return privateKey
}

function _biutSignTransaction (userAddress, transfer) {
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
  let privateKey = _getPrivateKeysFromAddress(userAddress)
  let signature = SECUtil.ecsign(txSigHash, Buffer.from(privateKey, 'hex'))
  transferData[0].data = {
    v: signature.v,
    r: signature.r.toString('hex'),
    s: signature.s.toString('hex')
  }
  return transferData
}

function _biuSignTransaction (userAddress, transfer) {
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
    Buffer.from('SEN')
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
    console.time('wallet_biut_getBalance')
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
        console.timeEnd('wallet_biut_getBalance')
        callback(null, response)
      })
    } catch (err) {
      response.status = 'false'
      response.info = 'Arg[0] is empty, no account address received'
      response.value = '0'
      console.timeEnd('wallet_biut_getBalance')
      callback(null, response)
    }
  },

  /**
  * get account balance
  */
  biu_getBalance: function (args, callback) {
    console.time('wallet_biu_getBalance')
    let response = {}
    // if (args[0].coinType = null) {
    // return all coins
    // } else {
    // args[0].coinType
    // }
    try {
      let accAddr = args[0]
      // let time = args[1] 'latest'
      core.senAPIs.getBalance(accAddr, (err, balance) => {
        if (err) {
          response.status = '0'
          response.info = `Failed to get user balance, error info: ${err}`
        } else {
          response.status = '1'
          response.info = 'OK'
          response.value = balance
          // response.value = {}
        }
        console.timeEnd('wallet_biu_getBalance')
        callback(null, response)
      })
    } catch (err) {
      response.status = 'false'
      response.info = 'Arg[0] is empty, no account address received'
      response.value = '0'
      console.timeEnd('wallet_biu_getBalance')
      callback(null, response)
    }
  },

  /**
    * get all the previous transactions for a specific address with paging
    */
  biut_getTransactions: function (args, callback) {
    console.time('wallet_biut_getTransactions')
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
      console.timeEnd('wallet_biut_getTransactions')
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
        console.timeEnd('wallet_biut_getTransactions')
        callback(null, response)
      })
    }
  },

  /**
  * get all the previous transactions for a specific address with paging
  */
  biu_getTransactions: function (args, callback) {
    console.time('wallet_biu_getTransactions')
    let response = {}
    let accAddr = args[0] // address

    let currentPage = parseInt(args[1] || 1)
    let pageSize = parseInt(args[2] || 39)
    let sortType = args[3]

    // verify accAddr
    if (accAddr[0] === '0' && accAddr[1] === 'x') {
      accAddr = accAddr.substr(2)
    }
    if (accAddr.length !== 40) {
      response.status = '0'
      response.message = `Invalid accAddress length (${accAddr.length}), should be 40`
      console.timeEnd('wallet_biu_getTransactions')
      callback(null, response)
    } else {
      core.senAPIs.getTokenTxForUser(accAddr, (err, txArray) => {
        if (err) {
          response.status = '0'
          response.message = `Failed to get user transactions, error info: ${err}`
          response.resultInChain = []
          response.resultInPool = []
        } else {
          let txArraryInPool = core.senAPIs.getTokenTxInPoolByAddress(accAddr)
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
        console.timeEnd('wallet_biu_getTransactions')
        callback(null, response)
      })
    }
  },

  /**
  * request to initiate a transaction
  */
  biut_sendRawTransaction: function (args, callback) {
    console.time('wallet_biut_sendRawTransaction')
    let response = {}
    // get nonce for signing the tx
    try {
      if (parseFloat(args[0].value) === 0 || parseFloat(args[0].value) < 0) {
        response.status = '0'
        response.info = `Value Can not equal 0 or smaller than 0`
        console.timeEnd('sen_sendRawTransaction')
        return callback(null, response)
      }

      let tokenTx = {
        Nonce: args[0].nonce || '0',
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
        console.timeEnd('wallet_biut_sendRawTransaction')
        callback(null, response)
      })
    } catch (err) {
      response.status = '0'
      response.info = `Unexpected error occurs, error info: ${err}`
      console.timeEnd('sen_sendRawTransaction')
      callback(null, response)
    }
  },

  /**
  * request to initiate a transaction
  */
  biu_sendRawTransaction: function (args, callback) {
    console.time('wallet_biut_sendRawTransaction')
    let response = {}
    // get nonce for signing the tx
    try {
      if (parseFloat(args[0].value) === 0 || parseFloat(args[0].value) < 0) {
        response.status = '0'
        response.info = `Value Can not equal 0 or smaller than 0`
        console.timeEnd('sen_sendRawTransaction')
        return callback(null, response)
      }
      let tokenTx = {
        Nonce: args[0].nonce || '0',
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
        console.timeEnd('wallet_biut_sendRawTransaction')
        callback(null, response)
      })
    } catch (err) {
      response.status = '0'
      response.info = `Unexpected error occurs, error info: ${err}`
      console.timeEnd('wallet_biut_sendRawTransaction')
      callback(null, response)
    }
  },

  biut_getChainHeight: function (args, callback) {
    console.time('wallet_biut_getChainHeight')
    let response = {}
    response.ChainHeight = core.secAPIs.getTokenChainHeight()
    console.timeEnd('wallet_biut_getChainHeight')
    callback(null, response)
  },

  biu_getChainHeight: function (args, callback) {
    console.time('wallet_biu_getChainHeight')
    let response = {}
    response.ChainHeight = core.senAPIs.getTokenChainHeight()
    console.timeEnd('wallet_biu_getChainHeight')
    callback(null, response)
  },

  biut_getBlockByHash: function (args, callback) {
    console.time('wallet_biut_getBlockByHash')
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
      console.timeEnd('wallet_biut_getBlockByHash')
      callback(null, response)
    })
  },

  biu_getBlockByHash: function (args, callback) {
    console.time('wallet_biu_getBlockByHash')
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
      console.timeEnd('wallet_biu_getBlockByHash')
      callback(null, response)
    })
  },

  biut_getBlockByHeight: function (args, callback) {
    console.time('wallet_biut_getBlockByHeight')
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
      console.timeEnd('wallet_biut_getBlockByHeight')
      callback(null, response)
    })
  },

  biu_getBlockByHeight: function (args, callback) {
    console.time('wallet_biu_getBlockByHeight')
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
      console.timeEnd('wallet_biu_getBlockByHeight')
      callback(null, response)
    })
  },

  validateAddress: function (args, callback) {
    console.time('wallet_biut_validateAddress')
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
      console.timeEnd('wallet_biut_validateAddress')
      callback(null, response)
    })
  },

  /**
   * @param {array} args
   * @param {string} args[0].companyName 'coinegg', 'fcoin', 'biki', 'bigone'才可以调用该rpc方法。
   * @param {function} callback(err, response) rpc回调函数
   * @param {json} callback.response 回调函数的传入参数response
   * @param {string} response.status '0' error; '1': 'success'
   * @param {string} response.message response的信息
   * @param {json} response.userAddress 生成的userAddress
  */
  getNewAddress: function (args, callback) {
    let response = {}
    let companyName = args[0]
    if (companyName !== 'coinegg' && companyName !== 'fcoin' && companyName !== 'biki' && companyName !== 'bigone') {
      response.status = '0'
      response.message = 'No authorized to use the api'
    } else {
      let generatedKeys = _getWalletKeys()
      _registerPrivateKey(generatedKeys)
      response.status = '1'
      response.userAddress = generatedKeys.userAddress
      response.message = 'Register successed'
    }
    callback(null, response)
  },

  /**
   * @param {array} args
   * @param {string} args[0].companyName 'coinegg', 'fcoin', 'biki', 'bigone'才可以调用该rpc方法。
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
  getKeysFromPrivate: function (args, callback) {
    let response = {}
    try {
      let companyName = args[0].companyName
      let privateKey = args[0].privateKey
      if (companyName !== 'coinegg' && companyName !== 'fcoin' && companyName !== 'biki' && companyName !== 'bigone') {
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
   * @param {string} args[0].companyName 'coinegg', 'fcoin', 'biki', 'bigone'才可以调用该rpc方法。
   * @param {string} args[0].userAddress 用户地址
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
      let userAddress = args[0].userAddress
      let transfer = args[0].transfer
      if (companyName !== 'coinegg' && companyName !== 'fcoin' && companyName !== 'biki' && companyName !== 'bigone') {
        response.status = '0'
        response.message = 'No authorized to use the api'
      } else {
        let signedTrans = _biutSignTransaction(userAddress, transfer)
        response.status = '1'
        response.message = 'signed transaction success'
        response.signedTrans = signedTrans
      }
    } catch (e) {
      console.log(e)
      response.status = '0'
      response.message = 'Bad Request.'
    }
    callback(null, response)
  },

  /**
  * @param {array} args
  * @param {string} args[0].companyName 'coinegg', 'fcoin', 'biki', 'bigone'才可以调用该rpc方法。
  * @param {string} args[0].userAddress 用户地址
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

  biu_signedTransaction: function (args, callback) {
    let response = {}
    try {
      let companyName = args[0].companyName
      let userAddress = args[0].userAddress
      let transfer = args[0].transfer
      if (companyName !== 'coinegg' && companyName !== 'fcoin' && companyName !== 'biki' && companyName !== 'bigone') {
        response.status = '0'
        response.message = 'No authorized to use the api'
      } else {
        let signedTrans = _biuSignTransaction(userAddress, transfer)
        response.status = '1'
        response.message = 'signed transaction success'
        response.signedTrans = signedTrans
      }
    } catch (e) {
      response.status = '0'
      response.message = 'Bad Request.'
    }
    callback(null, response)
  },

  /**
   * 用来测试，不对外使用
   */
  getkeyFromAddress: function (args, callback) {
    let response = {}
    try {
      let address = args[0]
      let key = _getPrivateKeysFromAddress(address)
      response.status = '1'
      response.key = key
      response.message = 'Get keys successed'
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
