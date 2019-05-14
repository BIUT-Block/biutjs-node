const SECUtils = require('@biut-block/biutjs-util')

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
