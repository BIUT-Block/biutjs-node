const chalk = require('chalk')
const cp = require('child_process')
const path = require('path')
const SECConfig = require('../../config/default.json')
const SECUtils = require('@biut-block/biutjs-util')
const SECRunContract = require('./run-contract')
const SECBlockChain = require('@biut-block/biutjs-blockchain')
// const SECTransaction = require('@biut-block/biutjs-tx')
const SECRandomData = require('@biut-block/biutjs-randomdatagenerator')
const SECCircle = require('./circle')
const SECReward = require('./reward')

class Consensus {
  constructor (config) {
    // -------------------------------  Init class global variables  -------------------------------
    this.rlp = config.rlp
    this.BlockChain = config.self
    this.cacheDBPath = config.dbconfig.cacheDBPath
    this.chainName = config.chainName
    this.syncInfo = config.syncInfo
    this.powEnableFlag = false

    // ---------------------------------------  block chain  ---------------------------------------
    this.powWorker = cp.fork(path.join(__dirname, '/pow-worker'))
    this.isPowRunning = false

    // create an secCircle object
    let configGroup = SECConfig.SECBlock.groupConfig
    let configCircle = SECConfig.SECBlock.circleConfig
    configCircle.minGroup = configGroup.minGroupId
    configCircle.maxGroup = configGroup.maxGroupId
    this.secCircle = new SECCircle(configCircle)

    // init variables
    this.myGroupId = 0
    this.groupIdBuffer = 0

    // init Reward object
    this.reward = new SECReward(this.BlockChain)

    if (this.chainName === 'SEN') {
      this.secChain = config.secChain
      this.secReward = new SECReward(this.secChain)
    }
  }

  // ---------------------------------------  SEN Block Chain  ---------------------------------------
  runPOW () {
    let newBlock = SECRandomData.generateTokenBlock(this.BlockChain.chain)

    this.BlockChain.chain.getLastBlock((err, lastBlock) => {
      if (err) console.error(`Error in consensus.js, runPow function, getLastBlock: ${err}`)
      else {
        newBlock.Number = lastBlock.Number + 1
        newBlock.ParentHash = lastBlock.Hash
        this.secCircle.getLastPowDuration(this.BlockChain.chain, (err, lastPowCalcTime) => {
          if (err) console.error(`Error in consensus.js, runPow function, getLastPowDuration: ${err}`)
          else {
            let blockForPOW = {
              Number: newBlock.Number,
              lastBlockDifficulty: parseFloat(lastBlock.Difficulty),
              lastPowCalcTime: lastPowCalcTime,
              Header: Buffer.concat(new SECBlockChain.SECTokenBlock(newBlock).getPowHeaderBuffer()),
              cacheDBPath: this.cacheDBPath
            }
            console.log(chalk.magenta(`Starting POW, last block difficulty is ${blockForPOW.lastBlockDifficulty} ...`))
            this.powWorker.send(blockForPOW)
          }
        })
      }
    })

    this.isPowRunning = true
    this.powWorker.on('message', (result) => {
      // verify the node is not synchronizing
      if (!this.syncInfo.flag) {
        // verify circle group id
        newBlock.Difficulty = result.Difficulty.toString()
        newBlock.MixHash = result.MixHash
        newBlock.Nonce = result.Nonce
        newBlock.Beneficiary = this.BlockChain.SECAccount.getAddress()
        newBlock.StateRoot = this.BlockChain.chain.accTree.getRoot()
        newBlock.TimeStamp = this.secCircle.getLocalHostTime()

        let groupId = this.secCircle.getTimestampWorkingGroupId(newBlock.TimeStamp)
        let BeneGroupId = this.secCircle.getTimestampGroupId(newBlock.Beneficiary, newBlock.TimeStamp)
        if (result.result && groupId === BeneGroupId) {
          let txsInPoll = JSON.parse(JSON.stringify(this.BlockChain.pool.getAllTxFromPool()))
          // append the pow reward tx
          this.secReward.getRewardTx((err, rewardTx) => {
            if (err) return this.resetPOW()
            let _rewardTx = JSON.parse(JSON.stringify(rewardTx))
            this.secChain.consensus.generateSecBlock(newBlock.Beneficiary, (err, secTxFeeTx) => {
              if (err) return this.resetPOW()

              let _secTxFeeTx = JSON.parse(JSON.stringify(secTxFeeTx))
              let senTxFeeTx = this.secReward.getSenTxFeeTx(txsInPoll, newBlock.Beneficiary).getTx()
              txsInPoll.unshift(senTxFeeTx)
              if (_secTxFeeTx !== null) {
                txsInPoll.unshift(_secTxFeeTx)
              }
              txsInPoll.unshift(_rewardTx)

              this.BlockChain.checkTxArray(txsInPoll, (err, txArray) => {
                if (err) {
                  return this.resetPOW()
                } else {
                  let runcontractPromise = function(tx){
                    return new Promise((resolve, reject) => {
                      let secRunContract = new SECRunContract(tx, this.BlockChain.chain)
                      secRunContract.run((err, contractResult)=>{
                        if (err) {
                          reject(err)
                        }
                        if ('transferResult' in contractResult){
                          this.BlockChain.chain.accTree.getNonce(tx.TxTo, (err, nonce) => {
                            if (err) {
                              reject(err)
                            }
                            else {
                              nonce = parseInt(nonce)
                              nonce = nonce + txArray.length
                              nonce = nonce.toString()
                              let tokenTx = {
                                Version: '0.1',
                                TxReceiptStatus: 'success',
                                TimeStamp: SECUtils.currentUnixTimeInMillisecond(),
                                TxFrom: tx.TxTo,
                                TxTo: contractResult.transferResult.Address,
                                Value: contractResult.transferResult.Amount.toString(),
                                GasLimit: '0',
                                GasUsedByTxn: '0',
                                GasPrice: '0',
                                Nonce: nonce,
                                InputData: `Smart Contract Transaction`
                              }
                              let txHashBuffer = [
                                Buffer.from(tokenTx.Version),
                                SECUtils.intToBuffer(tokenTx.TimeStamp),
                                Buffer.from(tokenTx.TxFrom, 'hex'),
                                Buffer.from(tokenTx.TxTo, 'hex'),
                                Buffer.from(tokenTx.Value),
                                Buffer.from(tokenTx.GasLimit),
                                Buffer.from(tokenTx.GasUsedByTxn),
                                Buffer.from(tokenTx.GasPrice),
                                Buffer.from(tokenTx.Nonce),
                                Buffer.from(tokenTx.InputData)
                              ]
                          
                              tokenTx.TxHash = SECUtils.rlphash(txHashBuffer).toString('hex')
                              resolve(tokenTx)
                            }
                          })
                        } else if('otherResult' in contractResult){
                          //reject(contractResult.otherResult)
                          resolve()
                        } else {
                          //reject(contractResult)
                          resolve()
                        }
                      })
                    })  
                  }.bind(this)
        
                  let txHeight = 0
                  let contractTransactions = []
                  txArray.forEach((tx) => {
                    tx.TxReceiptStatus = 'success'
                    tx.TxHeight = txHeight
                    txHeight = txHeight + 1
                    if (SECUtils.isContractAddr(tx.TxTo)){
                      contractTransactions.push(runcontractPromise(tx))
                    }
                  })
        
                  Promise.all(contractTransactions).then((contractTransactions) => {
                    contractTransactions = contractTransactions.filter(tx => (tx!=null))
                    newBlock.Transactions = txArray.concat(contractTransactions)
                    // write the new block to DB, then broadcast the new block, clear tokenTx pool and reset POW
                    try {
                      let senBlock = new SECBlockChain.SECTokenBlock(newBlock)
                      this.BlockChain.chain.putBlockToDB(senBlock.getBlock(), (err) => {
                        if (err) console.log(`Error in consensus.js, runPow function, putBlockToDB: ${err}`)
                        else {
                          console.log(chalk.green(`New SEN block generated, ${newBlock.Transactions.length} Transactions saved in the new Block, current blockchain height: ${this.BlockChain.chain.getCurrentHeight()}`))
                          console.log(chalk.green(`New generated block hash is: ${senBlock.getHeaderHash()}`))
                          this.BlockChain.sendNewBlockHash(senBlock)
                          this.BlockChain.pool.clear()
                          this.resetPOW()
                        }
                      })
                    } catch (err) {
                      console.log(`Error:`, err.stack)
                      this.resetPOW()
                    }
                  }).catch((err) => {
                    console.log(err.stack)
                  })
                }
              })
            })
          })
        } else {
          this.resetPOW()
        }
      } else {
        this.resetPOW()
      }
    })
  }

  resetPOW () {
    if (process.env.pow || this.powEnableFlag) {
      console.log(chalk.magenta('Reset POW'))
      this.powWorker.kill()
      this.powWorker = cp.fork(path.join(__dirname, '/pow-worker'))
    }
  }

  runCircle () {
    let accAddress = this.BlockChain.SECAccount.getAddress()
    this.myGroupId = this.secCircle.getHostGroupId(accAddress)

    this.circleInterval = setInterval(() => {
      let groupId = this.secCircle.getWorkingGroupId()

      if (this.currentGroup !== groupId) {
        let isNextPeriod = this.secCircle.isNextPeriod()
        if (isNextPeriod) {
          this.secCircle.resetCircle((err) => {
            if (err) console.log(err)
          })
          this.myGroupId = this.secCircle.getHostGroupId(accAddress)
        }

        if ((process.env.pow || this.powEnableFlag) && groupId === this.myGroupId) {
          this.resetPOW()
          this.runPOW()
        } else if (this.isPowRunning) {
          this.resetPOW()
          this.isPowRunning = false
        }

        this.currentGroup = groupId
      }
    }, this.secCircle.timeResolution)
  }

  resetCircle () {
    console.log(chalk.magenta('Reset Circle'))
    clearInterval(this.circleInterval)
  }

  // ---------------------------------------  SEC Block Chain  ---------------------------------------
  generateSecBlock (beneficiary, callback) {
    let txsInPoll = JSON.parse(JSON.stringify(this.BlockChain.pool.getAllTxFromPool()))
    this.BlockChain.checkTxArray(txsInPoll, (err, txArray) => {
      if (err) return callback(new Error(`Error in consensus.js, generateSecBlock function, checkTxArray: ${err}`), null)
      // assign txHeight
      if (txsInPoll.length !== 0) {
        // generate sec block
        let newBlock = SECRandomData.generateTokenBlock(this.BlockChain.chain)
        this.BlockChain.chain.getLastBlock((err, lastBlock) => {
          if (err) return callback(new Error(`Error in consensus.js, generateSecBlock function, getLastBlock: ${err}`), null)
          newBlock.Number = lastBlock.Number + 1
          newBlock.ParentHash = lastBlock.Hash
          newBlock.TimeStamp = this.secCircle.getLocalHostTime()
          newBlock.StateRoot = this.BlockChain.chain.accTree.getRoot()
          newBlock.Difficulty = ''
          newBlock.MixHash = ''
          newBlock.Nonce = ''
          newBlock.Beneficiary = beneficiary

          let txHeight = 0
          txArray.forEach((tx) => {
            tx.TxReceiptStatus = 'success'
            tx.TxHeight = txHeight
            txHeight = txHeight + 1
          })

          newBlock.Transactions = txArray
          let secBlock = new SECBlockChain.SECTokenBlock(newBlock)

          this.BlockChain.chain.putBlockToDB(secBlock.getBlock(), (err) => {
            if (err) return callback(new Error(`Error in consensus.js, generateSecBlock function, putBlockToDB: ${err}`), null)
            console.log(chalk.green(`New SEC block generated, ${secBlock.getBlock().Transactions.length} Transactions saved in the new Block, Current Blockchain Height: ${this.BlockChain.chain.getCurrentHeight()}`))
            console.log(chalk.green(`New generated block is: ${JSON.stringify(secBlock.getBlock())}`))
            this.BlockChain.sendNewBlockHash(secBlock)
            this.BlockChain.pool.clear()

            let txFeeTx = this.reward.getSecTxFeeTx(secBlock.getBlock())
            callback(null, txFeeTx.getTx())
          })
        })
      } else {
        callback(null, null)
        // do nothing if tx pool is empty
      }
    })
  }

  run () {
    if (this.chainName === 'SEC') {
      // do nothing
    } else if (this.chainName === 'SEN') {
      setTimeout(() => {
        // sen chain consensus
        this.runCircle()
      }, 2000)
    } else {
      console.log('Invalid chain name, no corresponding consensus method found')
    }
  }
}

module.exports = Consensus
