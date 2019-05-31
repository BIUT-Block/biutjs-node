const async = require('async')
const cloneDeep = require('clone-deep')
const SECUtils = require('@biut-block/biutjs-util')
const SECTransaction = require('@biut-block/biutjs-tx')

const MAX_MORTGAGE = 100000
exports.MIN_MORTGAGE = 10
const START_INSTANT = 1555338208000
const PERIOD_INTERVAL = 7776000000
const INIT_TX_AMOUNT = 100000
const INIT_TOT_REWARD = 90000

class SENReward {
  constructor (chain) {
    this.chain = chain
    this.reset(() => {})
  }

  reset (cb) {
    let currentTimeStamp = SECUtils.currentUnixTimeInMillisecond()
    let currentPeriodId = Math.floor((currentTimeStamp - START_INSTANT) / PERIOD_INTERVAL)
    this.periodList = [] // [[txAmount, rewardAmount], ...]
    for (let i = 0; i <= currentPeriodId; i++) {
      this.periodList[i] = i
    }

    async.eachSeries(this.periodList, (index, callback) => {
      if (index === 0) {
        this.periodList[0] = [INIT_TX_AMOUNT, INIT_TOT_REWARD]
      } else {
        let sTimeStamp = START_INSTANT + (index - 1) * PERIOD_INTERVAL
        let eTimestamp = START_INSTANT + index * PERIOD_INTERVAL
        this._getPeriodTxsInfo(sTimeStamp, eTimestamp, (err, data) => {
          if (err) {
            callback(err)
          } else {
            this.periodList[index] = data
          }
        })
      }
    }, (err) => {
      cb(err)
    })
  }

  _getPeriodTxsInfo (sTimeStamp, eTimestamp, callback) {
    let txAmount = 0
    let rewardAmount = 0
    this.chain.chain.chainDB.createReadStream().on('data', function (data) {
      if (data.key.length !== 64) {
        data.value = JSON.parse(data.value)
        // if the block is generated within the period
        if (data.value['TimeStamp'] >= sTimeStamp && data.value['TimeStamp'] <= eTimestamp) {
          txAmount = txAmount + data.value['Transactions'].length - 1
          rewardAmount = rewardAmount + data.value['Transactions'][0].Value
        }
      }
    }).on('error', function (err) {
      // console.log('Stream occurs an error when trying to read all data!')
      callback(err, null)
    }).on('close', function () {
      // console.log('Stream closed')
    }).on('end', function () {
      // console.log('Stream ended')
      callback(null, [txAmount, rewardAmount])
    })
  }

  _outputAdjustment (lastTxAmount, secondLastTxAmount) {
    let outAdj = Math.sqrt(lastTxAmount / secondLastTxAmount)
    if (outAdj > 100) {
      outAdj = 100
    }
    return outAdj
  }

  _currPeriodOutput () {
    let currentTimeStamp = SECUtils.currentUnixTimeInMillisecond()
    let currentPeriodId = Math.floor((currentTimeStamp - START_INSTANT) / PERIOD_INTERVAL)
    if (currentPeriodId > this.periodList.length) {
      throw new Error('SENReward class need reset')
    }

    if (currentPeriodId === 0) {
      return this.periodList[currentPeriodId][0]
    } else {
      let outAdj = this._outputAdjustment(this.periodList[currentPeriodId][0], this.periodList[currentPeriodId - 1][0])
      return outAdj * this.periodList[currentPeriodId][1]
    }
  }
  
  _getReward (addr, tokenName, callback) {
    // TODO: only for short time, later must be corrected
    let rewardFactor = 41.66666666 / 6
    // let rewardFactor = this._currPeriodOutput() / ((3 * 30 * 24 * 60) / 20)
    this.chain.getBalance(addr, tokenName, (err, balance) => {
      if (err) {
        callback(err, null)
      } else {
        if (balance > MAX_MORTGAGE) {
          balance = MAX_MORTGAGE
        } else if (balance < exports.MIN_MORTGAGE) {
          balance = 0
        }
        let reward = balance * rewardFactor / 100000
        callback(null, reward)
      }
    })
  }

  getRewardTx (callback) {
    this._getReward(this.chain.SECAccount.getAddress(), 'SEC', (err, reward) => {
      if (err) {
        callback(err)
      } else {
        // reward transaction
        let rewardTx = {
          Version: '0.1',
          TxReceiptStatus: 'success',
          TimeStamp: SECUtils.currentUnixTimeInMillisecond(),
          TxFrom: '0000000000000000000000000000000000000000',
          TxTo: this.chain.SECAccount.getAddress(),
          Value: reward.toString(),
          GasLimit: '0',
          GasUsedByTxn: '0',
          GasPrice: '0',
          TxFee: '0',
          Nonce: this.chain.chain.getCurrentHeight().toString(),
          InputData: `Mining reward`
        }
        rewardTx = cloneDeep(new SECTransaction.SECTokenTx(rewardTx).getTx())
        if (reward <= 0) {
          return callback(null, null)
        } else {
          return callback(null, rewardTx)
        }
      }
    })
  }

  // ------------------------------------------------------------------------------------------------ //
  // ----------------------------------  SEC blockchain Functions  ---------------------------------- //
  // ------------------------------------------------------------------------------------------------ //
  getSecTxFeeTx (block) {
    let txFee = 0
    block.Transactions.forEach((tx) => {
      txFee = txFee + parseFloat(tx.TxFee)
    })
    let txFeeTx = {
      Version: '0.1',
      TxReceiptStatus: 'success',
      TimeStamp: SECUtils.currentUnixTimeInMillisecond(),
      TxFrom: '0000000000000000000000000000000000000000',
      TxTo: block.Beneficiary,
      Value: txFee.toString(),
      GasLimit: '0',
      GasUsedByTxn: '0',
      GasPrice: '0',
      TxFee: '0',
      Nonce: this.chain.chain.getCurrentHeight().toString(),
      InputData: `BIUT blockchain transactions service charge`
    }
    let txFeeTxObject = cloneDeep(new SECTransaction.SECTokenTx(txFeeTx))

    if (txFee <= 0) {
      return null
    }    
    return txFeeTxObject
  }

  // ------------------------------------------------------------------------------------------------ //
  // ----------------------------------  SEN blockchain Functions  ---------------------------------- //
  // ------------------------------------------------------------------------------------------------ //
  getSenTxFeeTx (txArray, beneficiary) {
    let txFee = 0
    txArray.forEach((tx) => {
      txFee = txFee + parseFloat(tx.TxFee)
    })
    let txFeeTx = {
      Version: '0.1',
      TxReceiptStatus: 'success',
      TimeStamp: SECUtils.currentUnixTimeInMillisecond(),
      TxFrom: '0000000000000000000000000000000000000000',
      TxTo: beneficiary,
      Value: txFee.toString(),
      GasLimit: '0',
      GasUsedByTxn: '0',
      GasPrice: '0',
      TxFee: '0',
      Nonce: this.chain.chain.getCurrentHeight().toString(),
      InputData: `BIU blockchain transactions service charge`
    }
    let txFeeTxObject = cloneDeep(new SECTransaction.SECTokenTx(txFeeTx))
    if (txFee <= 0) {
      return null
    }    
    return txFeeTxObject
  }
}

module.exports = SENReward
