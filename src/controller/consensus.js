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
    // this.logger = config.SECLogger
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
    let blockBuffer = {}
    // Calculate pow difficulty
    let parentPOWCalcTime = 0
    let lastBlockTimestamp = this.BlockChain.SECTokenBlockChain.getLastBlock().TimeStamp
    let secondLastBlockTimestamp = 0
    if (this.BlockChain.SECTokenBlockChain.getCurrentHeight() > 2) {
      secondLastBlockTimestamp = this.BlockChain.SECTokenBlockChain.getSecondLastBlock().TimeStamp
      parentPOWCalcTime = lastBlockTimestamp - this.secCircle.getGroupStartTime(lastBlockTimestamp)
      parentPOWCalcTime += this.secCircle.getGroupStartTime(lastBlockTimestamp) - this.secCircle.getGroupStartTime(secondLastBlockTimestamp) - SECConfig.SECBlock.circleConfig.intervalTime
    } else {
      parentPOWCalcTime = lastBlockTimestamp - secondLastBlockTimestamp
    }

    blockBuffer = SECRandomData.generateTokenBlock(this.BlockChain.SECTokenBlockChain)
    blockBuffer.Number = this.BlockChain.SECTokenBlockChain.getCurrentHeight() + 1
    blockBuffer.Beneficiary = this.BlockChain.SECAccount.getAddress()
    blockBuffer.Transactions = []
    let blockHeader = new SECBlockChain.SECTokenBlock(blockBuffer)

    let blockForPOW = {
      Number: blockBuffer.Number,
      Difficulty: this.BlockChain.SECTokenBlockChain.getLastBlock().Difficulty,
      parentPOWCalcTime: parentPOWCalcTime,
      Header: blockHeader.getPowHeaderBuffer().toString('hex'),
      cacheDBPath: this.cacheDBPath
    }
    console.log(chalk.magenta(`Starting POW with Difficulty ${blockForPOW.Difficulty} ...`))
    // this.logger.debug(`DEBUG: Starting POW with Difficulty ${blockForPOW.Difficulty} ...`)
    this.powWorker.send(blockForPOW)
    this.isPowRunning = true
    this.powWorker.on('message', (result) => {
      // this.logger.debug('DEBUG: pow result is: ', result)
      // this.logger.debug('DEBUG: generated block height is: ', blockBuffer.Number)
      if (result.result) {
        blockBuffer.Difficulty = result.Difficulty
        blockBuffer.MixHash = result.MixHash
        blockBuffer.Nonce = result.Nonce

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

        let TxsInPoll = JSON.parse(JSON.stringify(this.BlockChain.TokenPool.getAllTxFromPool()))
        TxsInPoll.unshift(rewardTx)
        let txHeight = 0
        TxsInPoll.forEach((tx, index, TxsInPoll) => {
          if (typeof TxsInPoll[index] !== 'object') {
            TxsInPoll[index] = JSON.parse(TxsInPoll[index])
          }
          TxsInPoll[index].TxReceiptStatus = 'success'
          TxsInPoll[index].TxHeight = txHeight
          txHeight = txHeight + 1
        })
        blockBuffer.Transactions = TxsInPoll
        blockBuffer.TimeStamp = SECUtils.currentUnixTimeInMillisecond()
        let newSECTokenBlock = new SECBlockChain.SECTokenBlock(blockBuffer)
        try {
          this.BlockChain.SECTokenBlockChain.putBlockToDB(newSECTokenBlock.getBlock(), () => {
            console.log(chalk.green(`Token Blockchain | New Block generated, ${blockBuffer.Transactions.length} Transactions saved in the new Block, Current Token Blockchain Height: ${this.BlockChain.SECTokenBlockChain.getCurrentHeight()}`))
            this.BlockChain.sendNewTokenBlockHash(newSECTokenBlock)
            this.BlockChain.TokenPool.clear()
            this.resetPOW()
          })
        } catch (error) {
          // this.logger.error('ERROR: pow child process something wrong when writing new block to DB: ', error)
          console.error(error)
          this.resetPOW()
        }
      } else {
        // this.logger.error('ERROR: pow child process POW result verification failed')
        this.resetPOW()
      }
    })
  }

  resetPOW () {
    if (process.env.pow || this.powEnableFlag) {
      console.log(chalk.magenta('Reset POW'))
      // this.logger.debug('reset POW')
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
              // this.logger.error('ERROR: error when running this.secCircle.resetCircle function, err: ', err)
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
