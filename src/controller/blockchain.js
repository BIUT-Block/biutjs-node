const ms = require('ms')
const chalk = require('chalk')
const Big = require('bignumber.js')
const async = require('async')
const createDebugLogger = require('debug')
const cloneDeep = require('clone-deep')
const debug = createDebugLogger('core:blockchain')

const Consensus = require('./consensus')
const MainUtils = require('../utils/utils')
const SECDEVP2P = require('@biut-block/biutjs-devp2p')
const SECBlockChain = require('@biut-block/biutjs-blockchain')
const SECTransaction = require('@biut-block/biutjs-tx')
const SECTransactionPool = require('@biut-block/biutjs-transactionpool')
const SECRandomData = require('@biut-block/biutjs-randomdatagenerator')
const SECUtils = require('@biut-block/biutjs-util')

const DEC_NUM = 18
Big.config({
  ROUNDING_MODE: 0
})
Big.set({
  ROUNDING_MODE: Big.ROUND_DOWN
})

class BlockChain {
  constructor (config) {
    this.config = config
    this.chainID = config.chainID
    this.chainName = config.chainName
    this.SECAccount = config.SECAccount
    this.CenterController = config.CenterController

    // only for SEC chain
    this.senChain = null

    config.self = this
    this.consensus = new Consensus(config)

    // block chain
    this.pool = new SECTransactionPool({
      poolname: 'pool'
    })
    this.chain = new SECBlockChain.SECTokenBlockChain(config, this.pool)
  }

  // only for SEC chain
  setSenChain (senChain) {
    this.senChain = senChain
  }

  init (rlp, callback) {
    this.rlp = rlp
    if (!this.CenterController.restartingFlag) {
      this.chain.init((err) => {
        debug(chalk.blue('Blockchain init success'))
        callback(err)
      })
    } else {
      callback()
    }
  }

  run () {
    // main network is not enabled to randomly generate transactions
    if (process.env.tx && (process.env.netType === 'test' || process.env.netType === 'develop')) {
      this.Timer = setInterval(() => {
        this.generateTx()
      }, ms('200s'))
    }
    this.consensus.run()
  }

  // -------------------------------------------------------------------------------------------------- //
  // ----------------------------------  Token blockchain Functions  ---------------------------------- //
  // -------------------------------------------------------------------------------------------------- //

  sendNewTokenTx (_tx, excludePeer = {
    _socket: {}
  }) {
    debug(chalk.blue('Send Tx -> sendNewTokenTx()'))
    let tx = cloneDeep(_tx)
    this.rlp.getPeers().forEach(peer => {
      try {
        if (MainUtils.getPeerAddr(peer) !== MainUtils.getPeerAddr(excludePeer)) {
          debug('Send new Token Tx to Peer: ' + MainUtils.getPeerAddr(peer))
          peer.getProtocols()[0].sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.TX, [Buffer.from(this.chainID), tx.getTxBuffer()])
        }
      } catch (err) {
        this.config.dbconfig.logger.error(`Error in sendNewTokenTx function: ${err}`)
        console.error(`Error in sendNewTokenTx function: ${err}`)
      }
    })
  }

  sendNewBlockHash (block, excludePeer = {
    _socket: {}
  }) {
    debug(chalk.blue('Send Token Block Hash -> sendNewBlockHash()'))
    let blockHeaderHash = block.getHeaderHash()
    this.rlp.getPeers().forEach(peer => {
      try {
        if (MainUtils.getPeerAddr(peer) !== MainUtils.getPeerAddr(excludePeer)) {
          debug(`Send new ${this.chainName} block to Peer: ${MainUtils.getPeerAddr(peer)}`)
          peer.getProtocols()[0].sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NEW_BLOCK_HASHES, [Buffer.from(this.chainID), Buffer.from(blockHeaderHash, 'hex')])
        }
      } catch (err) {
        this.config.dbconfig.logger.error(`Error in sendNewBlockHash function: ${err}`)
        console.error(`Error in sendNewBlockHash function: ${err}`)
      }
    })
  }

  generateTx () {
    const tx = SECRandomData.generateTokenTransaction()
    const tokenTx = cloneDeep(new SECTransaction.SECTokenTx(tx))
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

    let tokenTx = cloneDeep(new SECTransaction.SECTokenTx(tx))

    // check balance
    this.getContractInfo(tx.TxTo, (err, tokenInfo) => {
      if (err) return callback(err)
      let tokenName = Object.keys(tokenInfo) > 0 ? this.chain.checkSecSubContract(tokenInfo.tokenName) : this.chainName
      this.checkBalance(tx, tokenName, (err, result) => {
        if (err) callback(err)
        else if (!result) {
          return callback(new Error(`Balance not enough`))
        } else {
          // verify tx signature
          if (!freeChargeFlag) {
            if (!tokenTx.verifySignature(this.chainName)) {
              return callback(new Error('Failed to verify transaction signature'))
            }
          }
          this.isTokenTxExist(tokenTx.getTxHash(), (err, existed) => {
            if (err) {
              return callback(err)
            } else {
              if (!existed) {
                const _tx = tokenTx.getTx()
                if ((Number(_tx.TxFee) < 0.5) && (_tx.TxFrom !== '0000000000000000000000000000000000000000') && (_tx.TxFrom !== '0000000000000000000000000000000000000001') && (_tx.TxTo !== '0000000000000000000000000000000000000000') && (_tx.TxTo !== '0000000000000000000000000000000000000001')) {
                  return callback(new Error('Tx Fee must bigger than 0.5'))
                } else {
                  this.pool.addTxIntoPool(_tx)
                  this.sendNewTokenTx(tokenTx)
                  if (_tx.TxFee !== '0') {
                    const __tx = JSON.parse(JSON.stringify(_tx))
                    __tx.TxTo = '0000000000000000000000000000000000000000'
                    __tx.Value = tx.TxFee
                    __tx.TxFee = '0'
                    __tx.TxHeight = ''
                    __tx.InputData = 'Handling fee transaction'
                    const feeTx = cloneDeep(new SECTransaction.SECTokenTx(__tx))
                    if (this.chainName === 'SEC') {
                      this.senChain.pool.addTxIntoPool(feeTx.getTx())
                      this.senChain.sendNewTokenTx(feeTx)
                    } else if (this.chainName === 'SEN') {
                      this.pool.addTxIntoPool(feeTx.getTx())
                      this.sendNewTokenTx(feeTx)
                    }
                    debug(`this.pool: ${JSON.stringify(this.pool.getAllTxFromPool())}`)
                    this.sendNewTokenTx(tokenTx)
                  }
                  debug(`this.pool: ${JSON.stringify(this.pool.getAllTxFromPool())}`)
                  return callback(null)
                }
              } else {
                return callback(new Error('Transaction already existed'))
              }
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
    let self = this
    this.chain.accTree.getBalance(userAddress, tokenName, (err, value) => {
      if (err) {
        return callback(err)
      } else {
        let txArrayFromPool = self.pool.getAllTxFromPool()
        async.eachSeries(txArrayFromPool, (tx, _callback) => {
          if (SECUtils.isContractAddr(tx.TxTo)) {
            self.getContractInfo(tx.TxTo, (err, tokenInfo) => {
              if (err) return _callback(err)
              else {
                tx.TokenName = Object.keys(tokenInfo) > 0 ? self.chain.checkSecSubContract(tokenInfo.tokenName) : self.chainName
                _callback()
              }
            })
          } else {
            tx.TokenName = self.chainName
            _callback()
          }
        }, function (err) {
          if (err) return callback(err, null)
          if (tokenName === 'All') {
            let allBalanceJson = Object.assign({}, value)
            let tokenNameArr = Object.keys(value)
            tokenNameArr.forEach((tmpTokenName, index) => {
              let balance = allBalanceJson[tmpTokenName]
              balance = new Big(balance)
              let txArray = self.pool.getAllTxFromPool().filter(tx => (tx.TxFrom === userAddress && tx.TokenName === tmpTokenName))
              txArray.forEach((tx) => {
                balance = balance.minus(tx.Value)
              })
              balance = balance.toFixed(DEC_NUM)
              allBalanceJson[tmpTokenName] = parseFloat(balance).toString()
              callback(null, allBalanceJson)
            })
          } else {
            if (self.chainName === 'SEC' && tokenName === 'SEC') {
              let balance = value[tokenName]
              balance = new Big(balance)
              let txArray = self.pool.getAllTxFromPool().filter(tx => (tx.TxFrom === userAddress && tx.TokenName === 'SEC'))
              txArray.forEach((tx) => {
                balance = balance.minus(tx.Value)
              })
              balance = balance.toFixed(DEC_NUM)
              balance = parseFloat(balance).toString()
              callback(null, balance)
            } else if (self.chainName === 'SEN' && tokenName === 'SEN') {
              let balance = value[tokenName]
              balance = new Big(balance)
              let txArray = self.pool.getAllTxFromPool().filter(tx => (tx.TxFrom === userAddress && tx.TokenName === 'SEN'))
              txArray.forEach((tx) => {
                balance = balance.minus(tx.Value)
              })
              balance = balance.toFixed(DEC_NUM)
              balance = parseFloat(balance).toString()
              callback(null, balance)
            } else {
              let txArray = self.pool.getAllTxFromPool().filter(tx => (tx.TxFrom === userAddress && tx.TokenName === tokenName))
              let balance = value[tokenName]
              balance = new Big(balance)
              txArray.forEach((tx) => {
                balance = balance.minus(tx.Value)
              })
              balance = balance.toFixed(DEC_NUM)
              balance = parseFloat(balance).toString()
              callback(null, balance)
            }
          }
        })
      }
    })
  }

  getCreatorContract (creatorAddress, callback) {
    this.chain.getCreatorContract(creatorAddress, (err, contractAddrArr) => {
      if (err) {
        callback(err, null)
      } else if (contractAddrArr.length === 0) {
        let transactions = this.chain.pool.getAllTxFromPool().filter(tx => {
          return tx.TxFrom === creatorAddress && SECUtils.isContractAddr(tx.TxTo)
        })
        transactions.sort((a, b) => {
          return a.TimeStamp - b.TimeStamp
        })
        let contractAddrResult = []
        for (let transaction of transactions) {
          let oInputData = JSON.parse(transaction.InputData)
          if (oInputData.tokenName && oInputData.sourceCode && oInputData.totalSupply) {
            contractAddrResult.push({
              contractAddress: transaction.TxTo,
              contractInfo: {
                'tokenName': oInputData.tokenName,
                'sourceCode': oInputData.sourceCode,
                'totalSupply': oInputData.totalSupply,
                'timeLock': {},
                'approve': {},
                'creator': transaction.TxFrom,
                'txHash': transaction.TxHash,
                'time': transaction.TimeStamp
              },
              status: 'pending'
            })
          }
        }
        callback(null, contractAddrResult)
      } else {
        for (let contractAddrInfo of contractAddrArr) {
          contractAddrInfo.status = 'success'
        }
        callback(null, contractAddrArr)
      }
    })
  }

  getTokenName (contractAddr, callback) {
    this.chain.getTokenName(contractAddr, (err, tokenName) => {
      if (err) {
        callback(err, null, null)
      } else if (!tokenName) {
        let transactions = this.chain.pool.getAllTxFromPool().filter(tx => {
          return tx.TxTo === contractAddr
        })
        transactions.sort((a, b) => {
          return a.TimeStamp - b.TimeStamp
        })
        let transaction = transactions[0]
        let oInputData = {}
        let status = 'failed'
        if (transaction) {
          oInputData = JSON.parse(transaction.InputData)
          status = 'pending'
        }
        callback(null, oInputData.tokenName, status)
      } else {
        callback(null, tokenName, 'success')
      }
    })
  }

  getContractInfo (contractAddr, callback) {
    this.chain.getTokenInfo(contractAddr, (err, tokenInfo) => {
      if (err) {
        callback(err, null)
      } else if (!tokenInfo) {
        let transactions = this.chain.pool.getAllTxFromPool().filter(tx => {
          return tx.TxTo === contractAddr
        })
        transactions.sort((a, b) => {
          return a.TimeStamp - b.TimeStamp
        })
        let transaction = transactions[0]
        let oTokenInfo = {}
        if (transaction) {
          let oInputData = JSON.parse(transaction.InputData)
          if (oInputData.tokenName && oInputData.sourceCode && oInputData.totalSupply) {
            oTokenInfo = {
              'tokenName': oInputData.tokenName,
              'sourceCode': oInputData.sourceCode,
              'totalSupply': oInputData.totalSupply,
              'timeLock': {},
              'approve': {},
              'creator': transaction.TxFrom,
              'txHash': transaction.TxHash,
              'time': transaction.TimeStamp,
              'status': 'pending'
            }
          }
        }
        callback(null, oTokenInfo)
      } else {
        tokenInfo.status = 'success'
        callback(null, tokenInfo)
      }
    })
  }

  getLockerContract (walletAddr, callback) {
    this.chain.getLockerContract(walletAddr, callback)
  }

  getContractAddress (tokenName, callback) {
    this.chain.getContractAddress(tokenName, (err, contractAddr) => {
      if (err) {
        callback(err, null, null)
      } else if (!contractAddr) {
        let transactions = this.chain.pool.getAllTxFromPool().filter(tx => {
          return SECUtils.isContractAddr(tx.TxTo) && JSON.parse(tx.InputData).tokenName === tokenName
        })
        transactions.sort((a, b) => {
          return a.TimeStamp - b.TimeStamp
        })
        let transaction = transactions[0]
        let contractAddrResult = ''
        let status = 'failed'
        if (transaction) {
          let oInputData = JSON.parse(transaction.InputData)
          if (oInputData.tokenName && oInputData.sourceCode && oInputData.totalSupply) {
            contractAddrResult = transaction.TxTo
            status = 'pending'
          }
        }
        callback(null, contractAddrResult, status)
      } else {
        callback(null, contractAddr, 'success')
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
          if ((parseFloat(balance) >= parseFloat(tx.Value)) && (parseFloat(balance) >= 0)) {
            this.senChain.getBalance(tx.TxFrom, 'SEN', (err, _balance) => {
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
    tokenName = this.chain.checkSecSubContract(tokenName)
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
      this.getContractInfo(tx.TxTo, (err, tokenInfo) => {
        if (err) {
          return callback(err)
        } else {
          let tokenName = Object.keys(tokenInfo) > 0 ? this.chain.checkSecSubContract(tokenInfo.tokenName) : this.chainName
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
      } else {
        indexArray.reverse().forEach((i) => {
          _txArray.splice(i, 1)
        })
        cb(null, _txArray)
      }
    })
  }
}

module.exports = BlockChain
