const _ = require('lodash')
const chalk = require('chalk')
const cp = require('child_process')
const path = require('path')
const SECConfig = require('../../config/default.json')

const SECUtils = require('@sec-block/secjs-util')
const SECBlockChain = require('@sec-block/secjs-blockchain')
const SECRandomData = require('@sec-block/secjs-randomdatagenerator')
const SECTransaction = require('@sec-block/secjs-tx')
const SECCircle = require('./circle')

class SECConsensus {
  constructor (config) {
    // -------------------------------  Init class global variables  -------------------------------
    this.rlp = config.rlp
    this.BlockChain = config.BlockChain
    this.cacheDBPath = config.dbconfig.cacheDBPath
    this.isTokenChain = config.isTokenChain
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
    let newBlock = SECRandomData.generateTokenBlock(this.BlockChain.SECTokenBlockChain)

    let blockForPOW = {
      Number: newBlock.Number,
      lastBlockDifficulty: parseFloat(this.BlockChain.SECTokenBlockChain.getLastBlock().Difficulty),
      lastPowCalcTime: this.secCircle.getLastPowDuration(this.BlockChain.SECTokenBlockChain),
      Header: new SECBlockChain.SECTokenBlock(newBlock).getPowHeaderBuffer().toString('hex'),
      cacheDBPath: this.cacheDBPath
    }
    console.log(chalk.magenta(`Starting POW, last block Difficulty is ${blockForPOW.Difficulty} ...`))
    this.powWorker.send(blockForPOW)
    this.isPowRunning = true
    this.powWorker.on('message', (result) => {
      if (result.result) {
        newBlock.Difficulty = result.Difficulty.toString()
        newBlock.MixHash = result.MixHash
        newBlock.Nonce = result.Nonce
        newBlock.Beneficiary = this.BlockChain.SECAccount.getAddress()
        newBlock.TimeStamp = SECUtils.currentUnixTimeInMillisecond()

        let TxsInPoll = JSON.parse(JSON.stringify(this.BlockChain.TokenPool.getAllTxFromPool()))
        // append the pow reward tx
        TxsInPoll.unshift(this.genPowRewardTx())

        // remove txs which already exist in previous blocks
        _.remove(TxsInPoll, (tx) => {
          if (typeof tx !== 'object') {
            tx = JSON.parse(tx)
          }

          return this.BlockChain.isTokenTxExist(tx.TxHash)
        })

        // assign txHeight
        let txHeight = 0
        TxsInPoll.forEach((tx) => {
          tx.TxReceiptStatus = 'success'
          tx.TxHeight = txHeight
          txHeight = txHeight + 1
        })

        newBlock.Transactions = TxsInPoll
        // write the new block to DB, then broadcast the new block, clear tokenTx pool and reset POW
        try {
          let newSECTokenBlock = new SECBlockChain.SECTokenBlock(newBlock)
          this.BlockChain.SECTokenBlockChain.putBlockToDB(newSECTokenBlock.getBlock(), (txArray) => {
            console.log(chalk.green(`Token Blockchain | New Block generated, ${newBlock.Transactions.length} Transactions saved in the new Block, Current Token Blockchain Height: ${this.BlockChain.SECTokenBlockChain.getCurrentHeight()}`))
            this.BlockChain.sendNewTokenBlockHash(newSECTokenBlock)
            this.BlockChain.TokenPool.clear()
            this.resetPOW()
          })
        } catch (error) {
          console.error(error)
          this.resetPOW()
        }
      } else {
        this.resetPOW()
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
      TxTo: this.BlockChain.SECAccount.getAddress(),
      Value: '2',
      ContractAddress: '',
      GasLimit: '0',
      GasUsedByTxn: '0',
      GasPrice: '0',
      Nonce: _.random(1, 1000).toString(),
      InputData: `Mining reward`
    }
    rewardTx = new SECTransaction.SECTokenTx(rewardTx).getTx()
    return rewardTx
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

    let lockFlag = false
    this.circleInterval = setInterval(() => {
      let groupId = this.secCircle.getWorkingGroupId()
      if (this.currentGroup !== groupId && !lockFlag) {
        let isNextPeriod = this.secCircle.isNextPeriod()
        if (isNextPeriod) {
          lockFlag = true
          this.secCircle.resetCircle((err) => {
            if (err) {
              // do nothing
            }
            lockFlag = false
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
