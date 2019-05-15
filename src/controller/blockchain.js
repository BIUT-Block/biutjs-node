const ms = require('ms')
const chalk = require('chalk')
const Big = require('bignumber.js')
const async = require('async')
const createDebugLogger = require('debug')
const debug = createDebugLogger('core:blockchain')

const Consensus = require('./consensus')
const MainUtils = require('../utils/utils')
const SECDEVP2P = require('@biut-block/biutjs-devp2p')
const SECBlockChain = require('@biut-block/biutjs-blockchain')
const SECTransaction = require('@biut-block/biutjs-tx')
const SECTransactionPool = require('@biut-block/biutjs-transactionpool')
const SECRandomData = require('@biut-block/biutjs-randomdatagenerator')
const SECUtils = require('@biut-block/biutjs-util')

const DEC_NUM = 8
Big.config({ ROUNDING_MODE: 0 })
Big.set({ ROUNDING_MODE: Big.ROUND_DOWN })

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
          peer.getProtocols()[0].sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.TX, [Buffer.from(this.chainID), tx.getTxBuffer()])
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
          debug(`Send new ${this.chainName} block to Peer: ${MainUtils.getPeerAddr(peer)}`)
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
    let freeChargeFlag = false
    // pow reward tx
    // if (tx.TxFrom === '0000000000000000000000000000000000000000') {
    //   return callback(new Error('Invalid TxFrom address'))
    // }
    // free charge tx
    if (tx.TxFrom === '0000000000000000000000000000000000000001') {
      freeChargeFlag = true
      // return callback(new Error('Invalid TxFrom address'))
    }
    let tokenTx = new SECTransaction.SECTokenTx(tx)
      // check balance
    this.chain.getTokenName(tx.TxTo, (err, tokenName) => {
      if(err) return callback(err)
      this.checkBalance(tx, tokenName, (err, result) => {
        if (err) callback(err)
        else if (!result) {
          return callback(new Error(`Balance not enough`))
        } else {
          // verify tx signature
          if (!freeChargeFlag) {
            if (!tokenTx.verifySignature()) {
              let err = new Error('Failed to verify transaction signature')
              return callback(err)
            }
          }
          this.isTokenTxExist(tokenTx.getTxHash(), (err, _result) => {
            if (err) {
              callback(err)
            }
            else {
              if (!_result) {
                console.log('\n******************** FeeTx test ********************')
                let _tx = tokenTx.getTx()
                console.log(chalk.yellow('Origin Tx: '))
                console.log(_tx)
                this.pool.addTxIntoPool(_tx)
                this.sendNewTokenTx(tokenTx)
                if (_tx.TxFee !== '0') {
                  let __tx = JSON.parse(JSON.stringify(_tx))
                  __tx.TxTo = '0000000000000000000000000000000000000000'
                  __tx.Value = tx.TxFee
                  __tx.TxFee = '0'
                  __tx.TxHeight = ''
                  __tx.InputData = 'Handling fee transaction'
                  let feeTx = new SECTransaction.SECTokenTx(__tx)
                  console.log(chalk.yellow('Fee Tx: '))
                  console.log(feeTx.getTx())
                  if (this.chainName === 'SEC') {
                    this.senChain.pool.addTxIntoPool(feeTx.getTx())
                    this.senChain.sendNewTokenTx(feeTx)
                  } else if (this.chainName === 'SEN') {
                    this.pool.addTxIntoPool(feeTx.getTx())
                    this.sendNewTokenTx(feeTx)
                  }
                  console.log('******************** FeeTx test End ********************\n')
                  debug(`this.pool: ${JSON.stringify(this.pool.getAllTxFromPool())}`)
                  this.sendNewTokenTx(tokenTx)
                }
                console.log('******************** FeeTx test End ********************\n')
                debug(`this.pool: ${JSON.stringify(this.pool.getAllTxFromPool())}`)
              }
              callback(null)
            }
          })
      }
      })
    })
  }

  // --------------------------------------------------------------------------------- //
  // -------------------------------  Other Functions  ------------------------------- //
  // --------------------------------------------------------------------------------- //
  /**
   * Get user account balance
   */
  getBalance (userAddress, tokenName, callback) {
    this.chain.accTree.getBalance(userAddress, tokenName, (err, value) => {
      if (err) {
        callback(err)
      }
      else {
        if(tokenName === 'All') {
          let allBalanceJson = Object.assign({}, value)
          Object.keys(value).forEach((tmpTokenName, index) => {
            this.chain.getContractAddress(tmpTokenName, (err, contractAddr) => {
              let balance = allBalanceJson[tmpTokenName]
              balance = new Big(balance)
              if(err) callback(err, null)
              let txArray = this.pool.getAllTxFromPool().filter(tx => (tx.TxFrom === userAddress && (tx.TxFrom === contractAddr || tx.TxTo === contractAddr)))
              txArray.forEach((tx) => {
                balance = balance.minus(tx.Value)
              })
      
              balance = balance.toFixed(DEC_NUM)
              allBalanceJson[tmpTokenName] = parseFloat(balance).toString()
              
              callback(null, allBalanceJson)
            })
          })
        } else {
          if(tokenName === 'SEC') {
            let balance = value[tokenName]
            balance = new Big(balance)
            let txArray = this.pool.getAllTxFromPool().filter(tx => (tx.TxFrom === userAddress))
            txArray.forEach((tx) => {
              balance = balance.minus(tx.Value)
            })
            balance = balance.toFixed(DEC_NUM)
            balance = parseFloat(balance).toString()        
            callback(null, balance)  
          } else {
            this.chain.getContractAddress(tokenName, (err, contractAddr) => {
              if(err) callback(err, null)
              let balance = value[tokenName]
              balance = new Big(balance)
              let txArray = this.pool.getAllTxFromPool().filter(tx => (tx.TxFrom === userAddress && (tx.TxFrom === contractAddr || tx.TxTo === contractAddr)))
              txArray.forEach((tx) => {
                balance = balance.minus(tx.Value)
              })
              balance = balance.toFixed(DEC_NUM)
              balance = parseFloat(balance).toString()
              callback(null, balance)
            })
          }
        }
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

  checkBalance (tx, tokenName, callback) {
    // pow reward tx
    if (tx.TxFrom === '0000000000000000000000000000000000000000') {
      return callback(null, true)
    }
    // free charge tx
    if (tx.TxFrom === '0000000000000000000000000000000000000001') {
      return callback(null, true)
    }
    if (this.chainName === 'SEC') {
      this.getBalance(tx.TxFrom, tokenName, (err, balance) => {
        if (err) {
          callback(err, null)
        } else {
          let result = false
          if (parseFloat(balance) >= parseFloat(tx.Value)) {
            this.senChain.getBalance(tx.TxFrom, tokenName, (err, _balance) => {
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
      this.getBalance(tx.TxFrom, tokenName, (err, balance) => {
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

  isPositiveBalance (addr, tokenName, callback) {
    // pow reward tx
    if (addr === '0000000000000000000000000000000000000000') {
      return callback(null, true)
    }
    // free charge tx
    if (addr === '0000000000000000000000000000000000000001') {
      return callback(null, true)
    }

    this.getBalance(addr, tokenName, (err, balance) => {
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

  checkTxArray (txArray, cb) {
    let index = 0
    let indexArray = []
    let _txArray = txArray

    async.eachSeries(_txArray, (tx, callback) => {
      if (typeof tx !== 'object') {
        tx = JSON.parse(tx)
      }
      this.chain.getTokenName(tx.TxTo, (err, tokenName) => {
        if(err) {
          return callback(err)
        } else {
          this.isPositiveBalance(tx.TxFrom, tokenName, (err, balResult) => {
            if (err) return callback(err)
            this.isTokenTxExist(tx.TxHash, (_err, exiResult) => {
              if (_err) return callback(_err)
              else {
                if (exiResult || !balResult) {
                  indexArray.push(index)
                }
                index++
                callback()
              }
            })
          })
        }
      })
    }, (err) => {
      if (err) {
        cb(err, null)
      }
      else {
        indexArray.reverse().forEach((i) => {
          _txArray.splice(i, 1)
        })
        cb(null, _txArray)
      }
    })
  }
}

module.exports = BlockChain
