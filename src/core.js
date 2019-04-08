const crypto = require('crypto')

const APIs = require('./apis/apis')
const Account = require('./account/account')
const CenterController = require('./controller/center-controller.js')
const SECConfig = require('../config/default.json')

// -------------------------------  set SEC DataBase configuration  -------------------------------
class Core {
  constructor (dbconfig = {
    DBPath: process.cwd() + SECConfig.SECBlock.dbConfig.Path,
    cacheDBPath: process.cwd() + SECConfig.SECBlock.dbConfig.Path + SECConfig.SECBlock.powConfig.path,
    ID: []
  }) {
    if (process.env.txChain) {
      dbconfig.ID.push('1897984547')
    }
    if (process.env.secTest) {
      dbconfig.DBPath = dbconfig.DBPath + 'test/'
    }

    // -------------------------------  OTHER SEC OBJECTS  ------------------------------- //
    this.Account = new Account()
    this.CenterController = new CenterController({
      PRIVATE_KEY: crypto.randomBytes(32),
      SECAccount: this.Account,
      dbconfig: dbconfig
    })

    this.APIs = new APIs({
      CenterController: this.CenterController,
      dbconfig: dbconfig
    })
  }

  run () {
  }
}

module.exports = Core
