const SECUtils = require('@biut-block/biutjs-util')

class Account {
  constructor (address = '') {
    if (address === '') {
      let userInfo = SECUtils.generateSecKeys()
      this.setAddress(userInfo.secAddress)
    } else {
      this.setAddress(address)
    }
  }

  getAddress () {
    return this.Address
  }

  setAddress (address) {
    this.Address = address
  }
}

module.exports = Account
