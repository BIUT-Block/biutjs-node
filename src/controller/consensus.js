const _ = require('lodash')
const chalk = require('chalk')
const cp = require('child_process')
const path = require('path')
const SECConfig = require('../../config/default.json')
const SECUtils = require('@sec-block/secjs-util')
const SECRunContract = require('./run-contract')
const SECBlockChain = require('@sec-block/secjs-blockchain')
const SECRandomData = require('@sec-block/secjs-randomdatagenerator')
const SECCircle = require('./circle')

class SECConsensus {
  constructor (config) {
    // -------------------------------  Init class global variables  -------------------------------
    this.rlp = config.rlp
    this.BlockChain = config.BlockChain
    this.cacheDBPath = config.dbconfig.cacheDBPath
    this.isTokenChain = config.isTokenChain
    this.syncInfo = config.syncInfo
    this.powEnableFlag = false

    // -------------------------------  Check block chain type  -------------------------------
    if (this.isTokenChain) {
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
    } else {
      // init variables
      this.ID = config.ID
      this.txChainMinGenPeriod = SECConfig.SECBlock.txChainConfig.minGenPeriod
      this.txChainMaxGenPeriod = SECConfig.SECBlock.txChainConfig.maxGenPeriod
    }
  }

  runPOW () {
    let newBlock = SECRandomData.generateTokenBlock(this.BlockChain.SECTokenChain)

    this.BlockChain.SECTokenChain.getLastBlock((err, lastBlock) => {
      if (err) console.error(`Error: ${err}`)
      else {
        newBlock.Number = lastBlock.Number + 1
        newBlock.ParentHash = lastBlock.Hash
        this.secCircle.getLastPowDuration(this.BlockChain.SECTokenChain, (err, lastPowCalcTime) => {
          if (err) console.error(`Error: ${err}`)
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
        newBlock.StateRoot = this.BlockChain.SECTokenChain.accTree.getRoot()
        newBlock.TimeStamp = this.secCircle.getLocalHostTime()

        let groupId = this.secCircle.getTimestampWorkingGroupId(newBlock.TimeStamp)
        let BeneGroupId = this.secCircle.getTimestampGroupId(newBlock.Beneficiary, newBlock.TimeStamp)

        if (result.result && groupId === BeneGroupId) {
          let TxsInPoll = JSON.parse(JSON.stringify(this.BlockChain.tokenPool.getAllTxFromPool()))
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
            if (SECUtils.isContractAddr(tx.TxTo)) {
              let secRunContract = new SECRunContract(tx, this.BlockChain.SECTokenChain)
              secRunContract.run((err, contractResult)=>{
                console.log(contractResult)
                if (Object.keys(contractResult.transferResult).length > 0){
                  this.BlockChain.SECTokenChain.accTree.getNonce(tx.To, (err, nonce) => {
                    if (err) {
                      
                    }
                    else {
                      nonce = parseInt(nonce)
                      let txArray = this.tokenPool.getAllTxFromPool().filter(tx => (tx.TxFrom === userAddress || tx.TxTo === userAddress))
                      nonce = nonce + txArray.length
                      nonce = nonce.toString()
                      let tokenTx = {
                        Version: '0.1',
                        TxReceiptStatus: 'success',
                        TimeStamp: SECUtils.currentUnixTimeInMillisecond(),
                        TxFrom: tx.TxTo,
                        TxTo: contractResult.transferResult.TxToAddr,
                        Value: contractResult.transferResult.TxAmount,
                        GasLimit: '0',
                        GasUsedByTxn: '0',
                        GasPrice: '0',
                        Nonce: nonce,
                        InputData: `Smart Contract Transaction`
                      }
                      console.log(tokenTx)
                      contractTransactions.push(tokenTx)
                    }
                  })
                } else {
                  console.log(contractResult.otherResults)
                }
              })
            }
          })

          newBlock.Transactions = TxsInPoll
          let _newBlock = JSON.parse(JSON.stringify(newBlock))
          // write the new block to DB, then broadcast the new block, clear tokenTx pool and reset POW
          try {
            let newSECTokenBlock = new SECBlockChain.SECTokenBlock(_newBlock)
            this.BlockChain.SECTokenChain.putBlockToDB(newSECTokenBlock.getBlock(), (err) => {
              if (err) console.error(`Error: ${err}`)
              else {
                console.log(chalk.green(`Token Blockchain | New Block generated, ${_newBlock.Transactions.length} Transactions saved in the new Block, Current Token Blockchain Height: ${this.BlockChain.SECTokenChain.getCurrentHeight()}`))
                console.log(chalk.green(`New generated block hash is: ${newSECTokenBlock.getHeaderHash()}`))
                this.BlockChain.sendNewTokenBlockHash(newSECTokenBlock)
                this.BlockChain.tokenPool.clear()
                this.resetPOW()
              }
            })
          } catch (error) {
            console.error(`Error: ${error}`)
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

  runTxBlockChain (delay = _.random(this.txChainMinGenPeriod, this.txChainMaxGenPeriod)) {
    this.TxTimer = setTimeout(() => {
      this.BlockChain.generateTxBlock(this.ID)
      this.runTxBlockChain()
    }, delay)
  }

  run () {
    setTimeout(() => {
      if (this.isTokenChain) {
        // token chain consensus
        this.runCircle()
        this.BlockChain.run()
      } else {
        // transaction chain consensus
        this.runTxBlockChain()
      }
    }, 2000)
  }
}

module.exports = SECConsensus
