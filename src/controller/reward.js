const SECUtils = require('@sec-block/secjs-util')
const SECTransaction = require('@sec-block/secjs-tx')

class SENReward {
  constructor (config) {
    this.startInstant = 1555318590000
    this.periodInterval = 777600000 // 3 months
    this.firstPeriodTxAmount = 100
  }

  lastPeriodRewardAmount () {
    // 近三个月产出量
  }

  lastPeriodTxAmount () {
    // 上一周期交易量
  }

  currentPeriodTxAmount () {
    // 当前周期交易量
  }

  parameterA () {
    let B = (this.currentPeriodTxAmount - this.lastPeriodTxAmount) / this.lastPeriodTxAmount
    if (B >= 0) {
      return B
    } else {
      return 1 + B
    }
  }

  outputAdjustment () {
    Math.sqrt(this.currentPeriodTxAmount - this.lastPeriodTxAmount)
  }

  getReward () {
    return this.lastPeriodRewardAmount * this.parameterA * this.outputAdjustment
  }

  getRewardTx () {
    // reward transaction
    let rewardTx = {
      Version: '0.1',
      TxReceiptStatus: 'success',
      TimeStamp: SECUtils.currentUnixTimeInMillisecond(),
      TxFrom: '0000000000000000000000000000000000000000',
      TxTo: this.SECAccount.getAddress(),
      Value: this.getReward.toString(),
      GasLimit: '0',
      GasUsedByTxn: '0',
      GasPrice: '0',
      Nonce: this.SECTokenChain.getCurrentHeight().toString(),
      InputData: `Mining reward`
    }
    rewardTx = new SECTransaction.SECTokenTx(rewardTx).getTx()
    return rewardTx
  }
}

module.exports = SENReward
