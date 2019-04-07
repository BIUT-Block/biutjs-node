const ms = require('ms')
const chalk = require('chalk')
const Big = require('big.js')
const createDebugLogger = require('debug')
const debug = createDebugLogger('core:blockchain')

const Consensus = require('./consensus')
const MainUtils = require('../utils/utils')
const SECDEVP2P = require('@sec-block/secjs-devp2p')
const SECBlockChain = require('@sec-block/secjs-blockchain')
const SECTransaction = require('@sec-block/secjs-tx')
const SECTransactionPool = require('@sec-block/secjs-transactionpool')
const SECRandomData = require('@sec-block/secjs-randomdatagenerator')
const SECUtils = require('@sec-block/secjs-util')

const DEC_NUM = 8
const MAX_TRANSFER_VALUE = 10 ** 8

class BlockChain {
  constructor (config) {
    this.config = config
    this.SECAccount = this.config.SECAccount
    this.consensus = new Consensus(config)

    // block chain
    this.pool = new SECTransactionPool({ poolname: 'pool' })
    this.chain = new SECBlockChain.SECTokenBlockChain(this.config.dbconfig)
  }

  init (rlp, callback) {
    this.rlp = rlp

    this.chain.init(() => {
      debug(chalk.blue('Token Blockchain init success'))
      callback()
    })
  }

  run () {
    if (process.env.tx) {
      this.Timer = setInterval(() => {
        this.generateTx()
      }, ms('200s'))
    }
    this.consensus.run()
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
          peer.getProtocols()[0].sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NEW_BLOCK_HASHES, [Buffer.from('token', 'utf-8'), Buffer.from(blockHeaderHash, 'hex')])
        }
      } catch (err) {
        console.error(`Error: ${err}`)
      }
    })
  }

  generateTx () {
    const tx = SECRandomData.generateTokenTransaction()
    const tokenTx = new SECTransaction.SECTokenTx(tx)
    this.pool.addTxIntoPool(tokenTx.getTx())
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
              this.pool.addTxIntoPool(tokenTx.getTx())
            }

            debug(`this.pool: ${JSON.stringify(this.pool.getAllTxFromPool())}`)
            this.sendNewTokenTx(tokenTx)
            callback(null)
          }
        })
      }
    })
  }

  // --------------------------------------------------------------------------------- //
  // -------------------------------  Other Functions  ------------------------------- //
  // --------------------------------------------------------------------------------- //

  /**
   * Get user account balance
   */
  getBalance (userAddress, callback) {
    this.chain.accTree.getBalance(userAddress, (err, balance) => {
      if (err) callback(err)
      else {
        balance = new Big(balance)

        let txArray = this.pool.getAllTxFromPool().filter(tx => (tx.TxFrom === userAddress || tx.TxTo === userAddress))
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
    this.chain.accTree.getNonce(userAddress, (err, nonce) => {
      if (err) callback(err, null)
      else {
        nonce = parseInt(nonce)
        let txArray = this.pool.getAllTxFromPool().filter(tx => (tx.TxFrom === userAddress || tx.TxTo === userAddress))
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
      GasLimit: '0',
      GasUsedByTxn: '0',
      GasPrice: '0',
      Nonce: this.chain.getCurrentHeight().toString(),
      InputData: `Mining reward`
    }
    rewardTx = new SECTransaction.SECTokenTx(rewardTx).getTx()
    return rewardTx
  }

  isTokenTxExist (txHash, callback) {
    // check if token tx already in previous blocks
    this.chain.txDB.getTx(txHash, (err, txData) => {
      if (err) callback(null, false)
      else {
        callback(null, true)
      }
    })
  }
}

module.exports = BlockChain
