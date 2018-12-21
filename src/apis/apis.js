const Big = require('big.js')
const secTransaction = require('@sec-block/secjs-tx')
const secUtils = require('@sec-block/secjs-util')
const nodeData = require('../node/node-data')
const getSize = require('get-folder-size')

const DEC_NUM = 8

class APIs {
  constructor (config) {
    this.SECTokenDataHandler = config.SECTokenDataHandler
    this.SECTxDbDict = config.SECTxDbDict
    this.CenterController = config.CenterController
  }

  // ----------------------------  TOKEN CHAIN  ---------------------------
  getTokenBlock (hash, callback) {
    this.SECTokenDataHandler.getTokenBlockFromDB(hash, (err, data) => {
      if (err) {
        callback(err, null)
      } else {
        callback(null, data[0])
      }
    })
  }

  getTokenBlockchain (minHeight, maxHeight, callback) {
    this.SECTokenDataHandler.getTokenChain(minHeight, maxHeight, callback)
  }

  getWholeTokenBlockchain (callback) {
    this.SECTokenDataHandler.getTokenBlockChainDB(callback)
  }

  getTokenTx (TxHash, callback) {
    this.SECTokenDataHandler.getTokenBlockChainDB((err, wholechain) => {
      if (err) {
        throw new Error(`Can not Token Transaction from database`)
      }
      wholechain.forEach(block => {
        let transaction = block.Transactions.filter(tx => {
          return tx.TxHash === TxHash
        })
        if (transaction.length) {
          return callback(transaction[0])
        }
      })
      callback(null)
    })
  }

  getTokenTxForUser (userAddress, callback) {
    this.SECTokenDataHandler.findTxForUser(userAddress, callback)
  }

  getTokenTxInPool (txHash, callback) {
    let tokenPool = this.CenterController.getBlockchain().TokenPool
    let transaction = tokenPool.getAllTxFromPool().filter(tx => {
      return tx.TxHash === txHash
    })
    callback(transaction[0])
  }

  getTokenTxInPoolByAddress (userAddress) {
    let tokenPool = this.CenterController.getBlockchain().TokenPool
    return tokenPool.getAllTxFromPool().filter(tx => (tx.TxFrom === userAddress || tx.TxTo === userAddress))
  }

  // -------------------------  TRANSACTION CHAIN  ------------------------
  getTransactionBlock (ID, hash, callback) {
    this.SECTxDbDict[ID].getTxBlockFromDB(hash, (err, data) => {
      if (err) {
        callback(err, null)
      } else {
        callback(null, data[0])
      }
    })
  }

  getTransactionBlockchain (ID, minHeight, maxHeight, callback) {
    this.SECTxDbDict[ID].getTxChain(minHeight, maxHeight, callback)
  }

  getWholeTransactionBlockchain (ID, callback) {
    this.SECTxDbDict[ID].getTxBlockChainDB(callback)
  }

  getTxforUser (ID, userAddress, callback) {
    this.SECTxDbDict[ID].findTxForUser(userAddress, callback)
  }

  getTransactionTx (ID, txHash, callback) {
    this.SECTxDbDict[ID].getTxBlockChainDB((err, wholechain) => {
      if (err) {
        throw new Error(`Can not Token Transaction from database`)
      }
      wholechain.forEach(block => {
        let transaction = block.Transactions.filter(tx => {
          return tx.TxHash === txHash
        })
        if (transaction.length) {
          callback(transaction[0])
        }
      })
    })
  }

  getTransactionTxInPool (ID, txHash) {
    let txPoolDict = this.CenterController.getBlockchain().TxPoolDict
    return txPoolDict[ID].getAllTxFromPool().filter(tx => { return tx.TxHash === txHash })
  }

  // ---------------------------  secjs libs  --------------------------
  asyncGetUTCTimeFromServer (timeServer) {
    return secUtils.asyncGetUTCTimeFromServer(timeServer)
  }

  createSecTxObject (tokenTx) {
    return new secTransaction.SECTokenTx(tokenTx)
  }

  getNodeIpv4 (callback) {
    nodeData.PublicIPV4(callback)
  }

  // -------------------------  Other functions  ------------------------

  /**
   * Calculate user account balance
   * @param  {String} userAddress - user account address
   * @return {None}
   */
  calAccBalance (userAddress, callback) {
    let txBuffer = this.CenterController.getBlockchain().SECTokenBlockChain.getTxBuffer()
    try {
      let balance = new Big(10)
      txBuffer.forEach((txInfo) => {
        if (txInfo[0] === userAddress) {
          balance = balance.minus(txInfo[2]).minus(txInfo[3])
        }
        if (txInfo[1] === userAddress) {
          balance = balance.plus(txInfo[2])
        }
      })

      let tokenPool = this.CenterController.getBlockchain().TokenPool
      let txArray = tokenPool.getAllTxFromPool().filter(tx => (tx.TxFrom === userAddress || tx.TxTo === userAddress))
      txArray.forEach((tx) => {
        if (tx.TxFrom === userAddress) {
          balance = balance.minus(tx.Value).minus(tx.TxFee)
        }
      })

      balance = balance.toFixed(DEC_NUM)
      callback(null, balance)
    } catch (e) {
      let err = new Error(`Unexpected error occurs in calAccBalance(), error info: ${e}`)
      callback(err, null)
    }
  }

  getUserTxNonce (userAddress, callback) {
    let txBuffer = this.CenterController.getBlockchain().SECTokenBlockChain.getTxBuffer()
    let nonce = 0
    txBuffer.forEach((txInfo) => {
      if (txInfo[0] === userAddress || txInfo[1] === userAddress) {
        nonce++
      }
    })
    nonce = nonce.toString()
    callback(null, nonce)
  }

  getTokenChainSize (callback) {
    getSize(this.CenterController.dbconfig.DBPath + 'tokenBlockChain', (err, size) => {
      if (err) {
        callback(err, null)
      } else {
        callback(null, size)
      }
    })
  }

  enablePOW () {
    this.CenterController.tokenConsensus.powEnableFlag = true
  }

  disablePOW () {
    this.CenterController.tokenConsensus.resetPOW()
    this.CenterController.tokenConsensus.powEnableFlag = false
  }

  startNetworkEvent (callback) {
    if (this.CenterController.runningFlag) {
      callback('network event is already running')
    } else {
      try {
        this.CenterController.initNetwork()
        callback(true)
      } catch (err) {
        callback(err)
      }
    }
  }

  setAddress (address) {
    this.CenterController.config.SECAccount.setAddress(address)
    return true
  }
}

module.exports = APIs
