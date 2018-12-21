const SECUtils = require('@sec-block/secjs-util')

class Account {
  constructor () {
    let userInfo = SECUtils.generateSecKeys()
    this.Address = userInfo.secAddress
  }

  getAddress () {
    return this.Address
  }

  setAddress (address) {
    this.Address = address
  }
}

module.exports = Account
