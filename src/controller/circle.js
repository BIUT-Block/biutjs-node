const SECUtil = require('@biut-block/biutjs-util')
// const ntpPort = 123

class SECJSTimeCircle {
  /**
   * constructor of secjs time circle class
   * @param {string} config.timeServer the server's local; 'DE': German 'USA': USA 'ZH': China
   * @param {string} config.periodTime
   * @param {string} config.intervalTime
   * @param {string} config.timeResolution
   * @param {string} config.timeTolerance
   * @param {string} config.minGroup
   * @param {string} config.maxGroup
   * @param {string} config.ntpTryOut try out time for udp transport
   */
  constructor (config) {
    this.config = config.config
    this.timeServer = config.timeServer
    this.circleStartTime = config.circleStartTime
    this.periodTime = config.periodTime
    this.intervalTime = config.intervalTime
    this.timeResolution = config.timeResolution
    this.timeTolerance = config.timeTolerance
    this.ntpTryOut = config.ntpTryOut // how many times should retry to get unix time

    this.minGroup = config.minGroup
    this.maxGroup = config.maxGroup
    this.numGroups = config.maxGroup - config.minGroup + 1
    this.timeDiff = 0 // the time difference between server unix time and local unix time
    this.calcTimeDifference(() => {
      this.currentPeriod = this.getCurrentPeriodNumber()
    })
  }

  /**
   * get local host unix time (ms)
   * @returns {number} local unix time
   */
  getLocalHostTime () {
    let localHostTime = 0
    try {
      localHostTime = new Date().getTime()
    } catch (err) {
      this.config.logger.error('ERROR：' + err)
      console.error('ERROR：' + err)
    }
    return localHostTime
  }

  /**
   * get remote host unix time (s)
   */
  getRemoteHostTime (callback, tryOut = 0) {
    SECUtil.asyncGetUTCTimeFromServer(this.timeServer).then((remoteHostTime) => {
      callback(null, remoteHostTime)
    }).catch((err) => {
      if (tryOut < this.ntpTryOut) {
        this.getRemoteHostTime(callback, tryOut + 1)
      } else {
        callback(err, null)
      }
    })
  }

  /**
   * calculate the time difference between server unix time and local unix time
   */
  calcTimeDifference (callback) {
    this.getRemoteHostTime((err, remoteTime) => {
      if (err) {
        this.timeDiff = 0
        callback(err)
      } else {
        // let localTime = this.getLocalHostTime()
        this.timeDiff = 0 // 1000 * remoteTime - localTime
        callback()
      }
    })
  }

  /**
   * get current period number
   */
  getCurrentPeriodNumber () {
    let currentCalibratedTime = this.getLocalHostTime() + this.timeDiff
    let periodNumber = Math.floor((currentCalibratedTime - this.circleStartTime) / this.periodTime)
    return periodNumber
  }

  /**
   * get host group id for current time
   */
  getHostGroupId (address) {
    if (typeof address !== 'string') {
      this.config.logger.error('Error: Invalid input type, should be string')
      console.log('Error: Invalid input type, should be string')
    }
    let periodNumber = this.getCurrentPeriodNumber()
    periodNumber = periodNumber.toString()
    let hashResult = SECUtil.hasha256(address + periodNumber)

    // only uses last 12 bytes for my group id calculation
    hashResult = hashResult.slice(-6).readUIntBE(0, 6)
    let groupId = (hashResult % this.numGroups) + this.minGroup
    return groupId
  }

  /**
   * get group id for a specific time instant
   */
  getTimestampGroupId (address, timestamp) {
    if (typeof address !== 'string') {
      this.config.logger.error('Error: Invalid input type, should be string')
      console.log('Error: Invalid input type, should be string')
    }
    let periodNumber = Math.floor((timestamp - this.circleStartTime) / this.periodTime)
    periodNumber = periodNumber.toString()
    let hashResult = SECUtil.hasha256(address + periodNumber)

    // only uses first 12 bytes for my group id calculation
    hashResult = hashResult.slice(-6).readUIntBE(0, 6)
    let groupId = (hashResult % this.numGroups) + this.minGroup
    return groupId
  }

  /**
   * get current working group id, return false if circle is in init status
   */
  getWorkingGroupId () {
    let currentCalibratedTime = this.getLocalHostTime() + this.timeDiff
    let currentPeriodRunTime = (currentCalibratedTime - this.circleStartTime) % this.periodTime
    let numGroupsAlreadyRun = Math.floor(currentPeriodRunTime / this.intervalTime)
    let currentWorkingGroup = (numGroupsAlreadyRun % this.numGroups) + this.minGroup
    return currentWorkingGroup
  }

  /**
   * get group id for a specific time instant
   */
  getTimestampWorkingGroupId (timestamp) {
    let currentPeriodRunTime = (timestamp - this.circleStartTime) % this.periodTime
    let numGroupsAlreadyRun = Math.floor(currentPeriodRunTime / this.intervalTime)
    let currentWorkingGroup = (numGroupsAlreadyRun % this.numGroups) + this.minGroup
    return currentWorkingGroup
  }

  /**
   * Verify if it is in a new period
   */
  isNextPeriod () {
    let periodNumber = this.getCurrentPeriodNumber()
    if (this.currentPeriod !== periodNumber) {
      this.currentPeriod = periodNumber
      return true
    }
    return false
  }

  /**
   * Verify whether the local time with offset is valid
   */
  checkTimeValid (callback) {
    this.getRemoteHostTime((err, remoteTime) => {
      if (err) {
        callback(err)
      }
      let localTime = this.getLocalHostTime()
      if (localTime + this.timeDiff - 1000 * remoteTime >= this.timeTolerance) {
        callback(new Error('time is not well calibrated'))
      } else {
        callback()
      }
    })
  }

  getGroupStartTime (timestamp) {
    let currentPeriodRunTime = (timestamp - this.circleStartTime) % this.periodTime
    let currentGroupRunTime = currentPeriodRunTime % this.intervalTime
    let groupStartTime = timestamp - currentGroupRunTime
    return groupStartTime
  }

  getLastPowDuration (chain, callback) {
    let lastPowDuration = 0
    if (chain.getCurrentHeight() !== 0) {
      // |----------|----------|----------|----------|----------|----------|----------| //
      // |----------|----------|------t2--|----------|----------|-------t1-|----------| //
      // |----------|----------|------t2--|----------|----------|    t3   -|----------| //
      // |----------|----------|------t2--|         t4          |    t3   -|----------| //
      // |----------|----------|------t2--|        lastPowDuration        -|----------| //
      // '|' means changing groups, 't1/t2' is the timestamp for first/second last block
      chain.getLastBlock((err, lastBlock) => {
        if (err) callback(err, null)
        else {
          let t1 = lastBlock.TimeStamp
          chain.getSecondLastBlock((err, secondLastBlock) => {
            if (err) callback(err, null)
            else {
              let t2 = secondLastBlock.TimeStamp
              let t3 = t1 - this.getGroupStartTime(t1)
              let t4 = this.getGroupStartTime(t1) - this.getGroupStartTime(t2) - this.intervalTime
              lastPowDuration = t3 + t4
              callback(null, lastPowDuration)
            }
          })
        }
      })
    } else {
      callback(null, lastPowDuration)
    }
  }

  /**
   * reset circle object
   */
  resetCircle (callback) {
    try {
      this.timeDiff = 0 // the time difference between server unix time and local unix time
      this.currentPeriod = this.getCurrentPeriodNumber()
      this.calcTimeDifference((err) => {
        if (err) {
          callback(err)
        } else {
          callback()
        }
      })
    } catch (err) {
      callback(err)
    }
  }
}

module.exports = SECJSTimeCircle
