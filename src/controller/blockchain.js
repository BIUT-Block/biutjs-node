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
const MAX_TRANSFER_VALUE = 10 ** 8
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
        console.error(`Error: ${err}`)
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
        console.error(`Error: ${err}`)
      }
    })
  }

  generateTokenTx () {
    const tx = SECRandomData.generateTokenTransaction()
    const tokenTx = new SECTransaction.SECTokenTx(tx)
    this.tokenPool.addTxIntoPool(tokenTx.getTx())
    this.sendNewTokenTx(tokenTx)
  }

  initiateTokenTx (tx, callback) {
    let tokenTx = new SECTransaction.SECTokenTx(tx)

    // check balance
    this.getBalance(tx.TxFrom, (err, value) => {
      if (err) callback(err)
      else if (value < parseFloat(tx.Value)) {
        let err = new Error(`Balance not enough`)
        return callback(err)
      } else if (value >= MAX_TRANSFER_VALUE) {
        let err = new Error(`Exceed max allowed transfer value`)
        return callback(err)
      } else {
        // free charge tx
        if (tx.TxFrom !== '0000000000000000000000000000000000000001') {
          // verify tx signature
          if (!tokenTx.verifySignature()) {
            let err = new Error('Failed to verify transaction signature')
            return callback(err)
          }
        }

        this.isTokenTxExist(tokenTx.getTxHash(), (err, result) => {
          if (err) callback(err)
          else {
            if (!result) {
              this.tokenPool.addTxIntoPool(tokenTx.getTx())
            }

            debug(`this.tokenPool: ${JSON.stringify(this.tokenPool.getAllTxFromPool())}`)
            this.sendNewTokenTx(tokenTx)
            callback(null)
          }
        })
      }
    })
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
        console.error(`Error: ${err}`)
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
        console.error(`Error: ${err}`)
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
    this.SECTokenChain.accTree.getBalance(userAddress, (err, balance) => {
      if (err) callback(err)
      else {
        balance = new Big(balance)

        let txArray = this.tokenPool.getAllTxFromPool().filter(tx => (tx.TxFrom === userAddress || tx.TxTo === userAddress))
        txArray.forEach((tx) => {
          if (tx.TxFrom === userAddress) {
            balance = balance.minus(tx.Value).minus(tx.TxFee)
          }
        })

        balance = balance.toFixed(DEC_NUM)
        balance = parseFloat(balance).toString()
        callback(null, balance)
      }
    })
  }

  /**
   * Get user account address
   */
  getNonce (userAddress, callback) {
    this.SECTokenChain.accTree.getNonce(userAddress, (err, nonce) => {
      if (err) callback(err, null)
      else {
        nonce = parseInt(nonce)
        let txArray = this.tokenPool.getAllTxFromPool().filter(tx => (tx.TxFrom === userAddress || tx.TxTo === userAddress))
        nonce = nonce + txArray.length
        nonce = nonce.toString()
        callback(null, nonce)
      }
    })
  }

  checkBalance (userAddress, callback) {
    // pow reward tx
    if (userAddress === '0000000000000000000000000000000000000000') {
      return callback(null, true)
    }
    // free charge tx
    if (userAddress === '0000000000000000000000000000000000000001') {
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

  isTokenTxExist (txHash, callback) {
    // check if token tx already in previous blocks
    this.SECTokenChain.txDB.getTx(txHash, (err, txData) => {
      if (err) callback(null, false)
      else {
        callback(null, true)
      }
    })
  }
}

module.exports = BlockChain
