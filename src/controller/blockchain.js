const ms = require('ms')
const chalk = require('chalk')
const Big = require('big.js')
const createDebugLogger = require('debug')
const debug = createDebugLogger('core:blockchain')

const MainUtils = require('../utils/utils')
const SECDEVP2P = require('@sec-block/secjs-devp2p')
const SECBlockChain = require('@sec-block/secjs-blockchain')
const SECTransaction = require('@sec-block/secjs-tx')
const SECTransactionPool = require('@sec-block/secjs-transactionpool')
const SECRandomData = require('@sec-block/secjs-randomdatagenerator')
const SECUtils = require('@sec-block/secjs-util')

const DEC_NUM = 8
const INIT_BALANCE = 1000
const tokenPoolConfig = {
  poolname: 'tokenpool'
}
const txPoolConfig = {
  poolname: 'transactionpool'
}

class BlockChain {
  constructor (config) {
    this.config = config
    this.SECAccount = this.config.SECAccount

    // token block chain
    this.tokenPool = new SECTransactionPool(tokenPoolConfig)
    this.SECTokenChain = new SECBlockChain.SECTokenBlockChain(this.config.dbconfig)

    // transaction block chain
    this.TxPoolDict = {}
    this.SECTxChainDict = {}
    for (let txChainID in this.config.dbconfig.ID) {
      this.TxPoolDict[txChainID] = new SECTransactionPool(txPoolConfig)
      let SECTxChain = new SECBlockChain.SECTransactionBlockChain({
        DBPath: this.config.dbconfig.DBPath,
        ID: txChainID
      })
      this.SECTxChainDict[txChainID] = SECTxChain
    }
  }

  init (rlp, callback) {
    this.rlp = rlp
    let initFlag = 0
    let chainsNum = Object.keys(this.config.dbconfig.ID).length + 1

    this.SECTokenChain.init(() => {
      initFlag++
      debug(chalk.blue('Token Blockchain init success'))
      if (initFlag >= chainsNum) {
        callback()
      }
    })

    for (let txChain in this.SECTxChainDict) {
      txChain.init(() => {
        initFlag++
        debug(chalk.blue('Tx Blockchain init success'))
        if (initFlag >= chainsNum) {
          callback()
        }
      })
    }
  }

  run () {
    if (process.env.tx) {
      this.TxTimer = setInterval(() => {
        for (let txChainID in this.TxPoolDict) {
          this.generateTxTx(txChainID)
        }
      }, ms('200s'))
      this.TokenTimer = setInterval(() => {
        this.generateTokenTx()
      }, ms('200s'))
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

  generateTokenTx () {
    const tx = SECRandomData.generateTokenTransaction()
    const tokenTx = new SECTransaction.SECTokenTx(tx)
    this.tokenPool.addTxIntoPool(tokenTx.getTx())
    this.sendNewTokenTx(tokenTx)
  }

  initiateTokenTx (tx) {
    let tokenTx = new SECTransaction.SECTokenTx(tx)
    if (!tokenTx.verifySignature()) {
      // failed to verify signature
      return false
    }

    if (!this.isTokenTxExist(tokenTx.getTxHash())) {
      this.tokenPool.addTxIntoPool(tokenTx.getTx())
    }

    debug(`this.tokenPool: ${JSON.stringify(this.tokenPool.getAllTxFromPool())}`)
    this.sendNewTokenTx(tokenTx)

    return true
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

  generateTxTx (txChainID) {
    const tx = SECRandomData.generateTxTransaction()
    const txTx = new SECTransaction.SECTransactionTx(tx)
    this.TxPoolDict[txChainID].addTxIntoPool(tx)
    this.sendNewTokenTx(txTx)
  }

  generateTxBlock (TxChainID) {
    let SECTxChain = this.SECTxChainDict[TxChainID]
    let block = SECRandomData.generateTransactionBlock(SECTxChain)
    block.Number = SECTxChain.getCurrentHeight() + 1
    let TxsInPoll = this.TxPoolDict[TxChainID].getAllTxFromPool()
    TxsInPoll.forEach((tx) => {
      if (typeof tx !== 'object') {
        tx = JSON.parse(tx)
      }
      tx.TxReceiptStatus = 'success'
    })
    block.Transactions = TxsInPoll
    block.Beneficiary = this.SECAccount.getAddress()
    let SECTxBlock = new SECBlockChain.SECTransactionBlock(block)
    SECTxChain.putBlockToDB(SECTxBlock.getBlock(), () => {
      debug(chalk.green(`Tx Blockchain | New Block generated, ${this.TxPoolDict[TxChainID].getAllTxFromPool().length} Transactions saved in the new Block, Current Tx Blockchain Height: ${SECTxChain.getCurrentHeight()}`))
      this.sendNewTxBlockHash(SECTxBlock, TxChainID)
      this.TxPoolDict[TxChainID].clear()
    })
  }

  // --------------------------------------------------------------------------------- //
  // -------------------------------  Other Functions  ------------------------------- //
  // --------------------------------------------------------------------------------- //

  /**
   * Get user account balance
   */
  getBalance (userAddress, callback) {
    let txBuffer = this.SECTokenChain.tokenTx
    try {
      let balance = new Big(INIT_BALANCE)
      Object.keys(txBuffer).forEach((key) => {
        if (txBuffer[key][0] === userAddress) {
          balance = balance.minus(txBuffer[key][2]).minus(txBuffer[key][3])
        }
        if (txBuffer[key][1] === userAddress) {
          balance = balance.plus(txBuffer[key][2])
        }
      })

      let tokenPool = this.tokenPool
      let txArray = tokenPool.getAllTxFromPool().filter(tx => (tx.TxFrom === userAddress || tx.TxTo === userAddress))
      txArray.forEach((tx) => {
        if (tx.TxFrom === userAddress) {
          balance = balance.minus(tx.Value).minus(tx.TxFee)
        }
      })

      balance = balance.toFixed(DEC_NUM)
      balance = parseFloat(balance).toString()
      callback(null, balance)
    } catch (e) {
      let err = new Error(`Unexpected error occurs in getBalance(), error info: ${e}`)
      callback(err, null)
    }
  }

  /**
   * Get user account address
   */
  getNonce (userAddress, callback) {
    let txBuffer = this.SECTokenChain.tokenTx
    let nonce = 0
    Object.keys(txBuffer).forEach((key) => {
      if (txBuffer[key][0] === userAddress || txBuffer[key][1] === userAddress) {
        nonce++
      }
    })
    nonce = nonce.toString()
    callback(null, nonce)
  }

  checkBalance (userAddress, callback) {
    if (userAddress === '0000000000000000000000000000000000000000') {
      return callback(null, true)
    }

    this.getBalance(userAddress, (err, balance) => {
      if (err) {
        callback(err, null)
      } else {
        let result = false
        if (balance >= 0) {
          result = true
        }
        callback(null, result)
      }
    })
  }

  genPowRewardTx () {
    // reward transaction
    let rewardTx = {
      Version: '0.1',
      TxReceiptStatus: 'success',
      TimeStamp: SECUtils.currentUnixTimeInMillisecond(),
      TxFrom: '0000000000000000000000000000000000000000',
      TxTo: this.SECAccount.getAddress(),
      Value: '2',
      ContractAddress: '',
      GasLimit: '0',
      GasUsedByTxn: '0',
      GasPrice: '0',
      Nonce: this.SECTokenChain.getCurrentHeight().toString(),
      InputData: `Mining reward`
    }
    rewardTx = new SECTransaction.SECTokenTx(rewardTx).getTx()
    return rewardTx
  }

  isTokenTxExist (txHash) {
    // check if token tx already in previous blocks
    if (txHash in this.SECTokenChain.tokenTx) {
      return true
    }

    return false
  }
}

module.exports = BlockChain
