const SECUtils = require('@biut-block/biutjs-util')

class Account {
  constructor (privateKey = '') {
    if (privateKey === '') {
      let userInfo = SECUtils.generateSecKeys()
      this.setAddress(userInfo.secAddress)
    } else {
      this.setAddress(privateKey)
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
