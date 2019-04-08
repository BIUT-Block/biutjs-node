const secTransaction = require('@sec-block/secjs-tx')
const secUtils = require('@sec-block/secjs-util')
const nodeData = require('../node/node-data')
const getSize = require('get-folder-size')

class APIs {
  constructor (config) {
    this.CenterController = config.CenterController
    this.secChain = this.CenterController.getSecChain()
    this.secChainDB = this.secChain.chain.chainDB
    this.dbconfig = config.dbconfig
  }

  // ----------------------------  SEC CHAIN  ---------------------------
  getTokenBlock (hash, callback) {
    this.secChainDB.getTokenBlockFromDB(hash, (err, data) => {
      if (err) {
        callback(err, null)
      } else {
        callback(null, data[0])
      }
    })
  }

  getTokenBlockchain (minHeight, maxHeight, callback) {
    this.secChainDB.getTokenChain(minHeight, maxHeight, callback)
  }

  getWholeTokenBlockchain (callback) {
    this.secChainDB.getTokenBlockChainDB(callback)
  }

  getTokenTx (TxHash, callback) {
    this.secChainDB.getTokenBlockChainDB((err, wholechain) => {
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
    this.secChainDB.findTxForUser(userAddress, callback)
  }

  getTokenTxInPool (txHash, callback) {
    let transaction = this.secChain.pool.getAllTxFromPool().filter(tx => {
      return tx.TxHash === txHash
    })
    callback(transaction[0])
  }

  getTokenTxInPoolByAddress (userAddress) {
    return this.secChain.pool.getAllTxFromPool().filter(tx => (tx.TxFrom === userAddress || tx.TxTo === userAddress))
  }

  writeBlock (block, callback) {
    this.secChain.chain.writeBlock(block, callback)
  }

  syncFromIp (ip, callback) {
    let foundFlag = false
    this.CenterController.NetworkEventContainer.forEach((networkEvent) => {
      if (networkEvent.getInstanceID().indexOf(ip) > -1 && !foundFlag) {
        foundFlag = true
        return networkEvent.syncFromIp(ip, callback)
      }
    })
    if (!foundFlag) {
      callback(new Error('Node with the IP address not found!'))
    }
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

  getAccTreeAccInfo (accAddr, callback) {
    this.secChain.chain.getFromAccTree(accAddr, callback)
  }

  /**
   * Calculate user account balance
   * @param  {String} userAddress - user account address
   * @return {None}
   */
  getBalance (userAddress, callback) {
    this.secChain.getBalance(userAddress, callback)
  }

  getNonce (userAddress, callback) {
    this.secChain.getNonce(userAddress, callback)
  }

  getTokenChainSize (callback) {
    getSize(this.dbconfig.SecDBPath + 'tokenBlockChain', (err, size) => {
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
    this.secChainDB.clearDB(callback)
  }

  getNodesTable () {
    return this.CenterController.nodesIPSync.getNodesTable()
  }

  getTokenChainHeight () {
    return this.secChain.chain.getCurrentHeight()
  }
}

module.exports = APIs
