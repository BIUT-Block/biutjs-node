const secTransaction = require('@sec-block/secjs-tx')
const secUtils = require('@sec-block/secjs-util')
const nodeData = require('../node/node-data')
const getSize = require('get-folder-size')

class APIs {
  constructor (config) {
    this.CenterController = config.CenterController
    this.blockChain = this.CenterController.getBlockchain()
    this.SECTokenDB = this.blockChain.SECTokenChain.chainDB
    this.dbconfig = config.dbconfig

    this.SECTxDBDict = {}
    for (let txChainID in this.blockChain.SECTxChainDict) {
      this.SECTxDBDict[txChainID] = this.blockChain.SECTxChainDict[txChainID].chainDB
    }
  }

  // ----------------------------  TOKEN CHAIN  ---------------------------
  getTokenBlock (hash, callback) {
    this.SECTokenDB.getTokenBlockFromDB(hash, (err, data) => {
      if (err) {
        callback(err, null)
      } else {
        callback(null, data[0])
      }
    })
  }

  getTokenBlockchain (minHeight, maxHeight, callback) {
    this.SECTokenDB.getTokenChain(minHeight, maxHeight, callback)
  }

  getWholeTokenBlockchain (callback) {
    this.SECTokenDB.getTokenBlockChainDB(callback)
  }

  getTokenTx (TxHash, callback) {
    this.SECTokenDB.getTokenBlockChainDB((err, wholechain) => {
      if (err) {
        console.error(`Error: Can not Token Transaction from database`)
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
    this.SECTokenDB.findTxForUser(userAddress, callback)
  }

  getTokenTxInPool (txHash, callback) {
    let tokenPool = this.blockChain.tokenPool
    let transaction = tokenPool.getAllTxFromPool().filter(tx => {
      return tx.TxHash === txHash
    })
    callback(transaction[0])
  }

  getTokenTxInPoolByAddress (userAddress) {
    let tokenPool = this.blockChain.tokenPool
    return tokenPool.getAllTxFromPool().filter(tx => (tx.TxFrom === userAddress || tx.TxTo === userAddress))
  }

  writeBlock (block, callback) {
    this.blockChain.SECTokenChain.writeBlock(block, callback)
  }

  syncFromIp (ip, callback) {
    this.CenterController.NetworkEventContainer.forEach((networkEvent) => {
      if (networkEvent.ID.indexOf(ip) > -1) {
        networkEvent.syncFromIp(ip, callback)
      }
    })
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
        console.error(`Error: Can not Token Transaction from database`)
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
    let txPoolDict = this.blockChain.TxPoolDict
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
  getBalance (userAddress, callback) {
    this.blockChain.getBalance(userAddress, callback)
  }

  getNonce (userAddress, callback) {
    this.blockChain.getNonce(userAddress, callback)
  }

  getTokenChainSize (callback) {
    getSize(this.dbconfig.DBPath + 'tokenBlockChain', (err, size) => {
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

  clearDB (callback) {
    this.SECTokenDB.clearDB(callback)
  }

  getNodesTable () {
    return this.CenterController.nodesIPSync.getNodesTable()
  }

  getTokenChainHeight () {
    return this.blockChain.SECTokenChain.getCurrentHeight()
  }
}

module.exports = APIs
