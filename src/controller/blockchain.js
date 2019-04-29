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

const DEC_NUM = 8

class BlockChain {
  constructor (config) {
    this.config = config
    this.chainID = config.chainID
    this.chainName = config.chainName
    this.SECAccount = this.config.SECAccount

    // only for SEC chain
    this.senChain = null

    config.self = this
    this.consensus = new Consensus(config)

    // block chain
    this.pool = new SECTransactionPool({ poolname: 'pool' })
    this.chain = new SECBlockChain.SECTokenBlockChain(config)
  }

  // only for SEC chain
  setSenChain (senChain) {
    this.senChain = senChain
  }

  init (rlp, callback) {
    this.rlp = rlp

    this.chain.init(() => {
      debug(chalk.blue('Blockchain init success'))
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

  sendNewTokenTx (tx, excludePeer = { _socket: {} }) {
    debug(chalk.blue('Send Tx -> sendNewTokenTx()'))
    this.rlp.getPeers().forEach(peer => {
      try {
        if (MainUtils.getPeerAddr(peer) !== MainUtils.getPeerAddr(excludePeer)) {
          debug('Send new Token Tx to Peer: ' + MainUtils.getPeerAddr(peer))
          peer.getProtocols()[0].sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.TX, [Buffer.from(this.chainID), [tx.getTxBuffer()]])
        }
      } catch (err) {
        console.log(err.stack)
      }
    })
  }

  sendNewBlockHash (block, excludePeer = { _socket: {} }) {
    debug(chalk.blue('Send Token Block Hash -> sendNewBlockHash()'))
    let blockHeaderHash = block.getHeaderHash()
    this.rlp.getPeers().forEach(peer => {
      try {
        if (MainUtils.getPeerAddr(peer) !== MainUtils.getPeerAddr(excludePeer)) {
          debug('Send new token block to Peer: ' + MainUtils.getPeerAddr(peer))
          peer.getProtocols()[0].sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NEW_BLOCK_HASHES, [Buffer.from(this.chainID), Buffer.from(blockHeaderHash, 'hex')])
        }
      } catch (err) {
        console.log(err.stack)
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
    // pow reward tx
    if (tx.TxFrom === '0000000000000000000000000000000000000000') {
      return callback(new Error('Invalid TxFrom address'))
    }
    // free charge tx
    if (tx.TxFrom === '0000000000000000000000000000000000000001') {
      return callback(new Error('Invalid TxFrom address'))
    }

    let tokenTx = new SECTransaction.SECTokenTx(tx)
    this.SECTokenChain.getTokenName(tx.TxTo, (err, tokenName) => {
      if (err) return callback(err)
      let tokenTx = new SECTransaction.SECTokenTx(tx)

      // check balance
      this.getBalance(tx.TxFrom, tokenName, (err, value) => {
        if (err) callback(err)
        else if (value < parseFloat(tx.Value)) {
          let err = new Error(`Balance not enough`)
          return callback(err)
        } else {
        if (!tokenTx.verifySignature()) {
          let err = new Error('Failed to verify transaction signature')
          return callback(err)
        }
        this.isTokenTxExist(tokenTx.getTxHash(), (err, _result) => {
          if (err) callback(err)
          else {
            if (!_result) {
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
  getBalance (userAddress, tokenName, callback) {
    this.SECTokenChain.accTree.getBalance(userAddress, tokenName, (err, value) => {
      if (err) callback(err)
      else {
        let balance = value[tokenName]
        balance = new Big(balance)
        if (this.chainName === 'SEC') {
          let txArray = this.pool.getAllTxFromPool().filter(tx => (tx.TxFrom === userAddress))
          txArray.forEach((tx) => {
            balance = balance.minus(tx.Value)
          })

          balance = balance.toFixed(DEC_NUM)
          balance = parseFloat(balance).toString()
        }
        if (this.chainName === 'SEN') {
          let senArray = this.pool.getAllTxFromPool().filter(tx => (tx.TxFrom === userAddress))
          senArray.forEach((tx) => {
            balance = balance.minus(tx.Value).minus(tx.TxFee)
          })

          let secArray = this.config.secChain.pool.getAllTxFromPool().filter(tx => (tx.TxFrom === userAddress))
          secArray.forEach((tx) => {
            balance = balance.minus(tx.TxFee)
          })

          balance = balance.toFixed(DEC_NUM)
          balance = parseFloat(balance).toString()
        }

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

  checkBalance (userAddress, tokenName, callback) {
    // pow reward tx
    if (tx.TxFrom === '0000000000000000000000000000000000000000') {
      return callback(null, true)
    }
    // free charge tx
    if (tx.TxFrom === '0000000000000000000000000000000000000001') {
      return callback(null, true)
    }

    if (this.chainName === 'SEC') {
      this.getBalance(tx.TxFrom, (err, balance) => {
        if (err) {
          callback(err, null)
        } else {
          let result = false
          if (parseFloat(balance) >= parseFloat(tx.Value)) {
            this.senChain.getBalance(tx.TxFrom, (err, _balance) => {
              if (err) {
                callback(err, null)
              } else {
                if (parseFloat(_balance) >= parseFloat(tx.TxFee)) {
                  result = true
                }
                callback(null, result)
              }
            })
          } else {
            callback(null, result)
          }
        }
      })
    }

    if (this.chainName === 'SEN') {
      this.getBalance(tx.TxFrom, (err, balance) => {
        if (err) {
          callback(err, null)
        } else {
          let result = false
          if (parseFloat(balance) >= parseFloat(tx.Value) + parseFloat(tx.TxFee)) {
            result = true
          }
          callback(null, result)
        }
      })
    }
  }

  isPositiveBalance (addr, callback) {
    // pow reward tx
    if (addr === '0000000000000000000000000000000000000000') {
      return callback(null, true)
    }
    // free charge tx
    if (addr === '0000000000000000000000000000000000000001') {
      return callback(null, true)
    }

    this.getBalance(userAddress, tokenName, (err, balance) => {
      if (err) {
        callback(err, null)
      } else {
        let result = false
        if (parseFloat(balance) >= 0) {
          result = true
        }
        callback(null, result)
      }
    })
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
