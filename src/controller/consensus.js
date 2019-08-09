const chalk = require('chalk')
const cp = require('child_process')
const path = require('path')
const cloneDeep = require('clone-deep')
const SECConfig = require('../../config/default.json')

const SECBlockChain = require('@biut-block/biutjs-blockchain')
// const SECTransaction = require('@biut-block/biutjs-tx')
const SECRandomData = require('@biut-block/biutjs-randomdatagenerator')
const SECCircle = require('./circle')
const SENReward = require('./reward')

class Consensus {
  constructor(config) {
    // -------------------------------  Init class global variables  -------------------------------
    this.config = config
    this.rlp = config.rlp
    this.BlockChain = config.self
    this.cacheDBPath = config.dbconfig.cacheDBPath
    this.chainName = config.chainName
    this.syncInfo = config.syncInfo
    this.powEnableFlag = false

    // ---------------------------------------  block chain  ---------------------------------------
    if (this.chainName === 'SEN') {
      this.powWorker = cp.fork(path.join(__dirname, '/pow-worker'))
      this.isPowRunning = false
    }

    // create an secCircle object
    let configGroup = SECConfig.SECBlock.groupConfig
    let configCircle = SECConfig.SECBlock.circleConfig
    configCircle.minGroup = configGroup.minGroupId
    configCircle.maxGroup = configGroup.maxGroupId
    configCircle.logger = config.logger
    this.secCircle = new SECCircle(configCircle)

    // init variables
    this.myGroupId = 0
    this.groupIdBuffer = 0

    // init Reward object
    this.reward = new SENReward(this.BlockChain)

    if (this.chainName === 'SEN') {
      this.secChain = config.secChain
      this.secReward = new SENReward(this.secChain)
    }
  }

  // ---------------------------------------  SEN Block Chain  ---------------------------------------
  runPOW() {
    this.secChain.getBalance(this.BlockChain.SECAccount.getAddress(), this.chainName, (err, balance) => {
      if (err) {
        this.config.dbconfig.logger.error(`Error in consensus.js, runPow function, getBalance: ${err}`)
        console.error(`Error in consensus.js, runPow function, getBalance: ${err}`)
      } else if (balance < this.reward.MIN_MORTGAGE) {
        return this.resetPOW()
      } else {
        let newBlock = cloneDeep(SECRandomData.generateTokenBlock(this.BlockChain.chain))

        this.BlockChain.chain.getLastBlock((err, _lastBlock) => {
          if (err) {
            this.config.dbconfig.logger.error(`Error in consensus.js, runPow function, getLastBlock: ${err}`)
            console.error(`Error in consensus.js, runPow function, getLastBlock: ${err}`)
          } else {
            let lastBlock = cloneDeep(_lastBlock)
            newBlock.Number = lastBlock.Number + 1
            newBlock.ParentHash = lastBlock.Hash
            this.secCircle.getLastPowDuration(this.BlockChain.chain, (err, lastPowCalcTime) => {
              if (err) {
                this.config.dbconfig.logger.error(`Error in consensus.js, runPow function, getLastPowDuration: ${err}`)
                console.error(`Error in consensus.js, runPow function, getLastPowDuration: ${err}`)
              } else {
                let blockForPOW = {
                  Number: newBlock.Number,
                  lastBlockDifficulty: parseFloat(lastBlock.Difficulty),
                  lastPowCalcTime: lastPowCalcTime,
                  Header: Buffer.concat(new SECBlockChain.SECTokenBlock(newBlock).getPowHeaderBuffer()),
                  cacheDBPath: this.cacheDBPath
                }
                this.config.dbconfig.logger.info(chalk.magenta(`Starting POW, last block difficulty is ${blockForPOW.lastBlockDifficulty} ...`))
                console.log(chalk.magenta(`Starting POW, last block difficulty is ${blockForPOW.lastBlockDifficulty} ...`))
                this.isPowRunning = true
                this.powWorker.send(blockForPOW)
              }
            })
          }
        })

        this.powWorker.once('message', (result) => {
          try {
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
                  if (rewardTx === null) return this.resetPOW()
                  let _rewardTx = JSON.parse(JSON.stringify(rewardTx))
                  this.secChain.consensus.generateSecBlock(newBlock.Beneficiary, (err, biutTxFeeTx) => {
                    if (err) return this.resetPOW()

                    let _secTxFeeTx = JSON.parse(JSON.stringify(biutTxFeeTx))
                    if (_secTxFeeTx !== null) {
                      txsInPoll.unshift(_secTxFeeTx)
                    }

                    this.BlockChain.checkTxArray(txsInPoll, (err, txArray) => {
                      if (err) return this.resetPOW()
                      let senTxFeeTx = this.secReward.getSenTxFeeTx(txArray, newBlock.Beneficiary)
                      if (senTxFeeTx !== null) {
                        senTxFeeTx = senTxFeeTx.getTx()
                        txArray.unshift(senTxFeeTx)
                      }
                      txArray.unshift(_rewardTx)
                      // assign txHeight
                      let txHeight = 0
                      txArray.forEach((tx) => {
                        tx.TxReceiptStatus = 'success'
                        tx.TxHeight = txHeight
                        txHeight = txHeight + 1
                      })

                      newBlock.Transactions = txArray
                      // write the new block to DB, then broadcast the new block, clear tokenTx pool and reset POW
                      let senBlock = cloneDeep(new SECBlockChain.SECTokenBlock(newBlock))
                      this.BlockChain.chain.putBlockToDB(senBlock.getBlock(), (err) => {
                        if (err) {
                          this.config.dbconfig.logger.error(`Error in consensus.js, runPow function, putBlockToDB: ${err}`)
                          console.error(`Error in consensus.js, runPow function, putBlockToDB: ${err}`)
                        } else {
                          this.config.dbconfig.logger.info(chalk.green(`New SEN block generated, ${newBlock.Transactions.length} Transactions saved in the new Block, current blockchain height: ${this.BlockChain.chain.getCurrentHeight()}`))
                          console.log(chalk.green(`New SEN block generated, ${newBlock.Transactions.length} Transactions saved in the new Block, current blockchain height: ${this.BlockChain.chain.getCurrentHeight()}`))
                          this.config.dbconfig.logger.info(chalk.green(`New generated block is: ${JSON.stringify(senBlock.getBlock())}`))
                          console.log(chalk.green(`New generated block is: ${JSON.stringify(senBlock.getBlock())}`))
                          senBlock = cloneDeep(new SECBlockChain.SECTokenBlock(newBlock))
                          // senBlock.StateRoot = newStateRoot
                          this.BlockChain.sendNewBlockHash(senBlock)
                          this.BlockChain.pool.clear()
                          this.resetPOW()
                        }
                      })
                    })
                  })
                })
              } else {
                this.resetPOW()
              }
            } else {
              this.resetPOW()
            }
          } catch (err) {
            this.config.dbconfig.logger.error(err)
            console.error(err)
          }
        })
      }
    })
  }

  resetPOW(callback) {
    if ((process.env.pow || this.powEnableFlag) && this.isPowRunning) {
      try {
        this.config.dbconfig.logger.info(chalk.magenta('Reset POW'))
        console.log(chalk.magenta('Reset POW'))
        this.powWorker.kill('SIGKILL')
        this.isPowRunning = false
        setTimeout(() => {
          this.powWorker = cp.fork(path.join(__dirname, '/pow-worker'))
          if (typeof callback === 'function') {
            callback()
          }
        }, 1000)
      } catch (err) {
        this.config.dbconfig.logger.error(err)
        console.error(err)
      }
    } else if (process.env.pow || this.powEnableFlag) {
      if (typeof callback === 'function') {
        setTimeout(() => {
          callback()
        }, 1000)
      }
    }
  }

  runCircle() {
    let accAddress = this.BlockChain.SECAccount.getAddress()
    this.myGroupId = this.secCircle.getHostGroupId(accAddress)

    this.circleInterval = setInterval(() => {
      let groupId = this.secCircle.getWorkingGroupId()

      if (this.currentGroup !== groupId) {
        let isNextPeriod = this.secCircle.isNextPeriod()
        if (isNextPeriod) {
          this.secCircle.resetCircle((err) => {
            if (err) {
              this.config.dbconfig.logger.error(err)
              console.error(err)
            }
          })
          let accAddress = this.BlockChain.SECAccount.getAddress()
          this.myGroupId = this.secCircle.getHostGroupId(accAddress)
        }

        if ((process.env.pow || this.powEnableFlag) && groupId === this.myGroupId && !this.syncInfo.flag) {
          this.resetPOW(() => {
            this.runPOW()
          })
        } else if (this.isPowRunning) {
          this.resetPOW()
          this.isPowRunning = false
        }

        this.currentGroup = groupId
      }
    }, this.secCircle.timeResolution)
  }

  resetCircle() {
    this.config.dbconfig.logger.info(chalk.magenta('Reset Circle'))
    console.log(chalk.magenta('Reset Circle'))
    clearInterval(this.circleInterval)
  }

  // ---------------------------------------  SEC Block Chain  ---------------------------------------
  generateSecBlock(beneficiary, callback) {
    let txsInPoll = JSON.parse(JSON.stringify(this.BlockChain.pool.getAllTxFromPool()))
    this.BlockChain.checkTxArray(txsInPoll, (err, txArray) => {
      if (err) return callback(new Error(`Error in consensus.js, generateSecBlock function, checkTxArray: ${err}`), null)
      // assign txHeight
      if (txsInPoll.length !== 0) {
        // generate sec block
        let newBlock = cloneDeep(SECRandomData.generateTokenBlock(this.BlockChain.chain))
        this.BlockChain.chain.getLastBlock((err, _lastBlock) => {
          if (err) return callback(new Error(`Error in consensus.js, generateSecBlock function, getLastBlock: ${err}`), null)
          let lastBlock = cloneDeep(_lastBlock)
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
          let secBlock = cloneDeep(new SECBlockChain.SECTokenBlock(newBlock))
          this.BlockChain.chain.putBlockToDB(secBlock.getBlock(), (err, newStateRoot) => {
            if (err) return callback(new Error(`Error in consensus.js, generateSecBlock function, putBlockToDB: ${err}`), null)
            this.config.dbconfig.logger.info(chalk.green(`New SEC block generated, ${newBlock.Transactions.length} Transactions saved in the new Block, Current Blockchain Height: ${this.BlockChain.chain.getCurrentHeight()}`))
            console.log(chalk.green(`New SEC block generated, ${newBlock.Transactions.length} Transactions saved in the new Block, Current Blockchain Height: ${this.BlockChain.chain.getCurrentHeight()}`))
            this.config.dbconfig.logger.info(chalk.green(`New generated block is: ${JSON.stringify(secBlock.getBlock())}`))
            console.log(chalk.green(`New generated block is: ${JSON.stringify(secBlock.getBlock())}`))
            secBlock = cloneDeep(new SECBlockChain.SECTokenBlock(newBlock))
            secBlock.StateRoot = newStateRoot
            this.BlockChain.sendNewBlockHash(secBlock)
            this.BlockChain.pool.clear()

            let txFeeTx = this.reward.getSecTxFeeTx(secBlock.getBlock())
            if (txFeeTx === null) {
              return callback(null, null)
            } else {
              return callback(null, txFeeTx.getTx())
            }
          })
        })
      } else {
        callback(null, null)
        // do nothing if tx pool is empty
      }
    })
  }

  run() {
    if (this.chainName === 'SEC') {
      // do nothing
    } else if (this.chainName === 'SEN') {
      setTimeout(() => {
        // sen chain consensus
        this.runCircle()
      }, 2000)
    } else {
      this.config.dbconfig.logger.info('Invalid chain name, no corresponding consensus method found')
      console.log('Invalid chain name, no corresponding consensus method found')
    }
  }
}

module.exports = Consensus