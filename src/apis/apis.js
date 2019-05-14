const secTransaction = require('@biut-block/biutjs-tx')
const secUtils = require('@biut-block/biutjs-util')
const nodeData = require('../node/node-data')
const getSize = require('get-folder-size')

class APIs {
  constructor (config) {
    this.CenterController = config.CenterController
    this.dbconfig = config.Dbconfig

    if (config.ChainName === 'SEC') {
      this.chain = this.CenterController.getSecChain()
      this.chainDB = this.chain.chain.chainDB
    } else {
      this.chain = this.CenterController.getSenChain()
      this.chainDB = this.chain.chain.chainDB
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
    this.chain.chain.txDB.getTx(txHash, (err, txData) => {
      if (err) {
        console.error(`Error: Can not find transaction with hash ${txHash} from database`)
      }
      callback(txData)
    })
  }

  getTokenTxForUser (userAddress, callback) {
    this.chainDB.findTxForUser(userAddress, callback)
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
    this.chain.chain.txDB.getTxAmount(callback)
  }

  getTotalRewards (callback) {
    this.chain.chain.chainDB.getTotalRewards(callback)
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
    getSize(this.dbconfig.SecDBPath + 'tokenBlockChain', (err, size) => {
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
    this.chainDB.clearDB(callback)
  }

  getNodesTable () {
    return this.CenterController.nodesIPSync.getNodesTable()
  }

  getTokenChainHeight () {
    return this.chain.chain.getCurrentHeight()
  }
  
  // ----------------------------------  SmartContract Mapping DB Functions  ---------------------------------- //

  getTokenName(addr, callback) {
    this.chain.chain.getTokenName(addr, callback)
  }

  getContractAddress(tokenname, callback){
    this.chain.chain.getContractAddress(tokenname, callback)
  }

  addTokenNameMap(tokenname, addr, callback) {
    this.chain.chain.add(tokenname, addr, callback)
  }
  
}

module.exports = APIs
