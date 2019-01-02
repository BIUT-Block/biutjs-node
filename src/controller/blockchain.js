const ms = require('ms')
const chalk = require('chalk')
// const util = require('util')

const SECDEVP2P = require('@sec-block/secjs-devp2p')
const SECBlockChain = require('@sec-block/secjs-blockchain')
const SECTransaction = require('@sec-block/secjs-tx')
const SECTransactionPool = require('@sec-block/secjs-transactionpool')
const SECRandomData = require('@sec-block/secjs-randomdatagenerator')
const createDebugLogger = require('debug')
const debug = createDebugLogger('core:blockchain')

const MainUtils = require('../utils/utils')
const txPoolConfig = {
  poolname: 'transactionpool'
}
const tokenPoolConfig = {
  poolname: 'tokenpool'
}

class BlockChain {
  constructor (config, callback) {
    this.SECAccount = config.SECAccount
    this.rlp = config.rlp
    let initFlag = 0

    // token block chain object creates and init
    this.SECTokenBlockChain = new SECBlockChain.SECTokenBlockChain(config.SECTokenDataHandler)
    this.SECTokenBlockChain.init(() => {
      initFlag++
      debug(chalk.blue('Token Blockchain init success'))
      if (initFlag >= Object.keys(config.SECTxDbDict).length + 1) {
        callback()
      }
    })
    // transaction pool
    this.TokenPool = new SECTransactionPool(tokenPoolConfig)
    this.TxPoolDict = {}
    for (let txChainID in config.SECTxDbDict) {
      this.TxPoolDict[txChainID] = new SECTransactionPool(txPoolConfig)
    }

    // transaction block chain object creates and init
    this.SECTransactionBlockChainDict = {}
    for (let txChainID in config.SECTxDbDict) {
      let SECTransactionBlockChain = new SECBlockChain.SECTransactionBlockChain(config.SECTxDbDict[txChainID])
      this.SECTransactionBlockChainDict[txChainID] = SECTransactionBlockChain
      SECTransactionBlockChain.init(() => {
        initFlag++
        debug(chalk.blue('Tx Blockchain init success'))
        if (initFlag >= Object.keys(config.SECTxDbDict).length + 1) {
          callback()
        }
      })
    }
  }

  run () {
    if (process.env.tx) {
      this.TxTimer = setInterval(() => {
        for (let txChainID in this.TxPoolDict) {
          this.generateTxTransaction(txChainID)
        }
      }, ms('200s'))
      this.TokenTimer = setInterval(() => {
        this.generateTokenTransaction()
      }, ms('100s'))
    }
  }

  // -------------------------------------------------------------------------------------------------- //
  // ----------------------------------  Token blockchain Functions  ---------------------------------- //
  // -------------------------------------------------------------------------------------------------- //

  sendNewTokenTx (TokenTx, excludePeer = { _socket: {} }) {
    debug(chalk.blue('Send Tx -> sendNewTokenTx()'))
    this.rlp.getPeers().forEach(peer => {
      try {
        if (MainUtils.getPeerAddr(peer) !== MainUtils.getPeerAddr(excludePeer)) {
          debug('Send new Token Tx to Peer: ' + MainUtils.getPeerAddr(peer))
          peer.getProtocols()[0].sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.TX, [Buffer.from('token', 'utf-8'), [TokenTx.getTxBuffer()]])
        }
      } catch (err) {
        console.error(err)
      }
    })
  }

  sendNewTokenBlockHash (tokenBlock, excludePeer = { _socket: {} }) {
    debug(chalk.blue('Send Token Block Hash -> sendNewTokenBlockHash()'))
    let blockHeaderHash = tokenBlock.getHeaderHash()
    this.rlp.getPeers().forEach(peer => {
      try {
        if (MainUtils.getPeerAddr(peer) !== MainUtils.getPeerAddr(excludePeer)) {
          debug('Send new token block to Peer: ' + MainUtils.getPeerAddr(peer))
          peer.getProtocols()[0].sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NEW_BLOCK_HASHES, [Buffer.from('token', 'utf-8'), [Buffer.from(blockHeaderHash, 'hex')]])
        }
      } catch (err) {
        console.error(err)
      }
    })
  }

  generateTokenTransaction () {
    const tx = SECRandomData.generateTokenTransaction(this.SECTokenBlockChain)
    const tokenTx = new SECTransaction.SECTokenTx(tx)
    this.TokenPool.addTxIntoPool(tokenTx.getTx())
    this.sendNewTokenTx(tokenTx)
  }

  initiateTokenTx (tx) {
    let tokenTx = new SECTransaction.SECTokenTx(tx)
    if (!tokenTx.verifySignature()) {
      // failed to verify signature
      return false
    }

    if (!this.isTokenTxExist(tokenTx.getTxHash())) {
      this.TokenPool.addTxIntoPool(tokenTx.getTx())
    }

    debug(`this.TokenPool: ${JSON.stringify(this.TokenPool.getAllTxFromPool())}`)
    this.sendNewTokenTx(tokenTx)

    return true
  }

  getTokenBlockchain () {
    return this.SECTokenBlockChain
  }

  // -------------------------------------------------------------------------------------------------- //
  // -------------------------------  Transaction blockchain Functions  ------------------------------- //
  // -------------------------------------------------------------------------------------------------- //

  sendNewTxTx (TxTx, txChainID, excludePeer = { _socket: {} }) {
    debug(chalk.blue(`Send Tx -> sendNewTxTx(), chain ID: ${txChainID}`))
    this.rlp.getPeers().forEach(peer => {
      try {
        if (MainUtils.getPeerAddr(peer) !== MainUtils.getPeerAddr(excludePeer)) {
          debug('Send new Transaction Tx to Peer: ' + MainUtils.getPeerAddr(peer))
          peer.getProtocols()[0].sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.TX, [Buffer.from(txChainID, 'utf-8'), [TxTx.getTxBuffer()]])
        }
      } catch (err) {
        console.error(err)
      }
    })
  }

  sendNewTxBlockHash (txBlock, txChainID, excludePeer = { _socket: {} }) {
    debug(chalk.blue(`Send Transaction Block ${txChainID} Hash -> sendNewTxBlockHash()`))
    let blockHeaderHash = txBlock.getHeaderHash()
    this.rlp.getPeers().forEach(peer => {
      try {
        if (MainUtils.getPeerAddr(peer) !== MainUtils.getPeerAddr(excludePeer)) {
          debug('Send new transaction block to Peer: ' + MainUtils.getPeerAddr(peer))
          peer.getProtocols()[0].sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NEW_BLOCK_HASHES, [Buffer.from(txChainID, 'utf-8'), [Buffer.from(blockHeaderHash, 'hex')]])
        }
      } catch (err) {
        console.error(err)
      }
    })
  }

  generateTxBlock (TxChainID) {
    let SECTransactionBlockChain = this.SECTransactionBlockChainDict[TxChainID]
    let block = SECRandomData.generateTransactionBlock(SECTransactionBlockChain)
    block.Number = SECTransactionBlockChain.getCurrentHeight() + 1
    let TxsInPoll = this.TxPoolDict[TxChainID].getAllTxFromPool()
    TxsInPoll.forEach((tx) => {
      if (typeof tx !== 'object') {
        tx = JSON.parse(tx)
      }
      tx.TxReceiptStatus = 'success'
    })
    block.Transactions = TxsInPoll
    block.Beneficiary = this.SECAccount.getAddress()
    let SECTransactionBlock = new SECBlockChain.SECTransactionBlock(block)
    this.SECTransactionBlockChainDict[TxChainID] = SECTransactionBlockChain
    SECTransactionBlockChain.putBlockToDB(SECTransactionBlock.getBlock(), () => {
      debug(chalk.green(`Tx Blockchain | New Block generated, ${this.TxPoolDict[TxChainID].getAllTxFromPool().length} Transactions saved in the new Block, Current Tx Blockchain Height: ${SECTransactionBlockChain.getCurrentHeight()}`))
      this.sendNewTxBlockHash(SECTransactionBlock, TxChainID)
      this.TxPoolDict[TxChainID].clear()
    })
  }

  generateTxTransaction (txChainID) {
    const tx = SECRandomData.generateTxTransaction(this.SECTransactionBlockChainDict[txChainID])
    const TransactionTx = new SECTransaction.SECTransactionTx(tx)
    this.TxPoolDict[txChainID].addTxIntoPool(tx)
    this.rlp.getPeers().forEach(peer => {
      try {
        this.sendNewTxTx(TransactionTx, txChainID)
        debug('Send new Transaction Tx to Peer: ' + MainUtils.getPeerAddr(peer))
      } catch (err) {
        console.error(err)
      }
    })
  }

  getTxBlockchain (txChainID) {
    return this.SECTransactionBlockChainDict[txChainID]
  }

  // --------------------------------------------------------------------------------- //
  // -------------------------------  Other Functions  ------------------------------- //
  // --------------------------------------------------------------------------------- //

  isTokenTxExist (txHash) {
    // check if token tx already in previous blocks
    if (txHash in this.SECTokenBlockChain.tokenTx) {
      return true
    }

    return false
  }
}

module.exports = BlockChain
