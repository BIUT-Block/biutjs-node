const _ = require('lodash')
const chalk = require('chalk')
const cp = require('child_process')
const path = require('path')
const SECConfig = require('../../config/default.json')

const SECBlockChain = require('@sec-block/secjs-blockchain')
const SECRandomData = require('@sec-block/secjs-randomdatagenerator')
const SECCircle = require('./circle')

class SECConsensus {
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

    if (this.chainName === 'SEN') {
      this.secChain = config.secChain
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
          let TxsInPoll = JSON.parse(JSON.stringify(this.BlockChain.pool.getAllTxFromPool()))
          // append the pow reward tx
          TxsInPoll.unshift(this.BlockChain.genPowRewardTx())

          // remove txs which already exist in previous blocks
          _.remove(TxsInPoll, (tx) => {
            if (typeof tx !== 'object') {
              tx = JSON.parse(tx)
            }

            this.BlockChain.checkBalance(tx.TxFrom, (err, balResult) => {
              if (err) {
                return true
              } else {
                this.BlockChain.isTokenTxExist(tx.TxHash, (err, exiResult) => {
                  if (err) return true
                  else {
                    return (exiResult || !balResult)
                  }
                })
              }
            })
          })

          // assign txHeight
          let txHeight = 0
          TxsInPoll.forEach((tx) => {
            tx.TxReceiptStatus = 'success'
            tx.TxHeight = txHeight
            txHeight = txHeight + 1
          })

          newBlock.Transactions = TxsInPoll
          let _newBlock = JSON.parse(JSON.stringify(newBlock))
          // write the new block to DB, then broadcast the new block, clear tokenTx pool and reset POW
          try {
            let newSenBlock = new SECBlockChain.SECTokenBlock(_newBlock)
            this.BlockChain.chain.putBlockToDB(newSenBlock.getBlock(), (err) => {
              if (err) console.error(`Error in consensus.js, runPow function, putBlockToDB: ${err}`)
              else {
                console.log(chalk.green(`New SEN block generated, ${_newBlock.Transactions.length} Transactions saved in the new Block, current blockchain height: ${this.BlockChain.chain.getCurrentHeight()}`))
                console.log(chalk.green(`New generated block hash is: ${newSenBlock.getHeaderHash()}`))
                this.BlockChain.sendNewBlockHash(newSenBlock)
                this.BlockChain.pool.clear()
                this.resetPOW()

                // generate Sec blockchain block
                this.secChain.consensus.generateSecBlock()
              }
            })
          } catch (error) {
            console.error(`Error in consensus.js, runPow function, catch: ${error}`)
            this.resetPOW()
          }
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
            if (err) {
              console.log(err)
            }
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
  generateSecBlock () {
    let txsInPoll = JSON.parse(JSON.stringify(this.BlockChain.pool.getAllTxFromPool()))
    if (txsInPoll.length !== 0) {
      // generate sec block
      let newBlock = SECRandomData.generateTokenBlock(this.BlockChain.chain)
      this.BlockChain.chain.getLastBlock((err, lastBlock) => {
        if (err) console.error(`Error in consensus.js, generateSecBlock function, getLastBlock: ${err}`)
        else {
          newBlock.Number = lastBlock.Number + 1
          newBlock.ParentHash = lastBlock.Hash
          newBlock.TimeStamp = this.secCircle.getLocalHostTime()
          newBlock.StateRoot = this.BlockChain.chain.accTree.getRoot()
          newBlock.Difficulty = ''
          newBlock.MixHash = ''
          newBlock.Nonce = ''
          newBlock.Beneficiary = ''

          // assign txHeight
          let txHeight = 0
          txsInPoll.forEach((tx) => {
            tx.TxReceiptStatus = 'success'
            tx.TxHeight = txHeight
            txHeight = txHeight + 1
          })

          newBlock.Transactions = txsInPoll
          let secBlock = new SECBlockChain.SECTokenBlock(newBlock)

          this.BlockChain.chain.putBlockToDB(secBlock.getBlock(), (err) => {
            if (err) console.error(`Error in consensus.js, generateSecBlock function, putBlockToDB: ${err}`)
            else {
              console.log(chalk.green(`New SEC block generated, ${secBlock.Transactions.length} Transactions saved in the new Block, Current Blockchain Height: ${this.BlockChain.chain.getCurrentHeight()}`))
              console.log(chalk.green(`New generated block hash is: ${secBlock.getHeaderHash()}`))
              this.BlockChain.sendNewBlockHash(secBlock)
              this.BlockChain.pool.clear()
            }
          })
        }
      })
    } else {
      // do nothing if tx pool is empty
    }
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

module.exports = SECConsensus
