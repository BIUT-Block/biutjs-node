const secTransaction = require('@biut-block/biutjs-tx')
const secUtils = require('@biut-block/biutjs-util')
const nodeData = require('../node/node-data')
const getSize = require('get-folder-size')

class APIs {
  constructor (config) {
    this.CenterController = config.CenterController
    this.config = config.config

    if (config.ChainName === 'SEC') {
      this.chain = this.CenterController.getSecChain()
      this.chainDB = this.chain.chain.chainDB
      this.txDB = this.chain.chain.txDB
      this.accTree = this.chain.chain.accTree
    } else {
      this.chain = this.CenterController.getSenChain()
      this.chainDB = this.chain.chain.chainDB
      this.txDB = this.chain.chain.txDB
      this.accTree = this.chain.chain.accTree
    }
  }

  // ----------------------------  SEC CHAIN  ---------------------------
  getTokenBlock (hash, callback) {
    this.chainDB.getTokenBlockFromDB(hash, (err, data) => {
      if (err) {
        callback(err, null)
      } else {
        callback(null, data[0])
      }
    })
  }

  getTokenBlockchain (minHeight, maxHeight, callback) {
    this.chainDB.getTokenChain(minHeight, maxHeight, callback)
  }

  getWholeTokenBlockchain (callback) {
    this.chainDB.getTokenBlockChainDB(callback)
  }

  getTokenTx (txHash, callback) {
    this.txDB.getTx(txHash, (err, txData) => {
      if (err) {
        this.config.logger.error(`Error: Can not find transaction with hash ${txHash} from database`)
        console.error(`Error: Can not find transaction with hash ${txHash} from database`)
      }
      callback(txData)
    })
  }

  getTokenTxForUser (userAddress, callback) {
    this.chain.chain.getTxForUser(userAddress, callback)
  }

  getTokenTxInPool (txHash, callback) {
    let transaction = this.chain.pool.getAllTxFromPool().filter(tx => {
      return tx.TxHash === txHash
    })
    callback(transaction[0])
  }

  getTokenTxInPoolByAddress (userAddress) {
    return this.chain.pool.getAllTxFromPool().filter(tx => (tx.TxFrom === userAddress || tx.TxTo === userAddress))
  }

  writeBlock (block, callback) {
    this.chain.chain.writeBlock(block, callback)
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

  getTxAmount (callback) {
    this.txDB.getTxAmount(callback)
  }

  getTotalRewards (callback) {
    this.chainDB.getTotalRewards(callback)
  }

  getChainHeight () {
    return this.chain.chain.getCurrentHeight()
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
    this.chain.chain.getFromAccTree(accAddr, callback)
  }

  /**
   * Calculate user account balance
   * @param  {String} userAddress - user account address
   * @return {None}
   */
  getBalance (userAddress, tokenName, callback) {
    this.chain.getBalance(userAddress, tokenName, callback)
  }

  getNonce (userAddress, callback) {
    this.chain.getNonce(userAddress, callback)
  }

  getTokenChainSize (callback) {
    getSize(this.config.SecDBPath + 'tokenBlockChain', (err, size) => {
      if (err) {
        callback(err, null)
      } else {
        callback(null, size)
      }
    })
  }

  enablePOW () {
    this.CenterController.senChain.consensus.powEnableFlag = true
  }

  disablePOW () {
    this.CenterController.senChain.consensus.resetPOW()
    this.CenterController.senChain.consensus.powEnableFlag = false
  }

  startNetworkEvent (callback) {
    if (this.CenterController.runningFlag) {
      let msg = 'network event is already running'
      callback(msg)
    } else {
      try {
        this.CenterController.initNetwork()
        let flag = true
        callback(flag)
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
    this.chainDB.clearDB((err) => {
      if (err) return callback(err)
      else {
        this.txDB.clearDB((err) => {
          if (err) return callback(err)
          else {
            this.accTree.clearDB((err) => {
              if (err) return callback(err)
              else {
                callback()
              }
            })
          }
        })
      }
    })
  }

  rebuildAccTree (callback) {
    this.chain.chain.rebuildAccTree(callback)
  }

  getNodesTable () {
    return this.CenterController.nodesIPSync.getNodesTable()
  }

  getTokenChainHeight () {
    return this.chain.chain.getCurrentHeight()
  }
  getSyncInfo () {
    let response = {
      isSyncing: null,
      lastBlockNumber: null
    }
    response.isSyncing = this.CenterController.syncInfo.flag
    response.lastBlockNumber = this.chain.chain.getCurrentHeight()
    return response
  }

  getRLPPeersNumber () {
    return this.CenterController.rlp.getPeers().length
  }

  validateAddress (userAddress, callback) {
    let result = false
    if (userAddress.match(/[0-9A-Fa-f]{40}/)) {
      result = true
    }
    callback(result)
  }
  // ----------------------------------  SmartContract Mapping DB Functions  ---------------------------------- //

  // getTokenName(addr, callback) {
  //   this.chain.getTokenName(addr, callback)
  // }

  getContractAddress(tokenname, callback){
    this.chain.getContractAddress(tokenname, callback)
  }

  getCreatorContract(creatorAddress, callback){
    this.chain.getCreatorContract(creatorAddress, callback)
  }
  
  getContractInfo(contractAddr, callback){
    this.chain.getContractInfo(contractAddr, callback)
  }

  // getTimeLock(addr, callback) {
  //   this.chain.chain.getTimeLock(addr, callback)
  // }

  // addTokenMap(tokenInfo, addr, callback) {
  //   this.chain.chain.addTokenMap(tokenInfo, addr, callback)
  // }
  
}

module.exports = APIs
