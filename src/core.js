const crypto = require('crypto')

const APIs = require('./apis/apis')
const Account = require('./account/account')
const CenterController = require('./controller/center-controller.js')
const SECConfig = require('../config/default.json')

// -------------------------------  set SEC DataBase configuration  -------------------------------
class Core {
  constructor (dbconfig = {
    DBPath: process.cwd() + SECConfig.SECBlock.dbConfig.Path,
    SecDBPath: process.cwd() + SECConfig.SECBlock.dbConfig.Path + SECConfig.SECBlock.dbConfig.SecPath,
    SenDBPath: process.cwd() + SECConfig.SECBlock.dbConfig.Path + SECConfig.SECBlock.dbConfig.SenPath,
    cacheDBPath: process.cwd() + SECConfig.SECBlock.dbConfig.Path + SECConfig.SECBlock.powConfig.path,
    address: ''
  }) {
    if (process.env.netType === 'test') {
      dbconfig.SecDBPath = dbconfig.SecDBPath + 'test/'
      dbconfig.SenDBPath = dbconfig.SenDBPath + 'test/'
    } else if (process.env.netType === 'develop') {
      dbconfig.SecDBPath = dbconfig.SecDBPath + 'develop/'
      dbconfig.SenDBPath = dbconfig.SenDBPath + 'develop/'
    }

    if (process.argv['--addr'] !== undefined) {
      dbconfig.address = process.argv['--addr']
    }

    // -------------------------------  OTHER SEC OBJECTS  ------------------------------- //
    this.Account = new Account(dbconfig.address)
    this.CenterController = new CenterController({
      PRIVATE_KEY: crypto.randomBytes(32),
      SECAccount: this.Account,
      dbconfig: dbconfig
    })

    this.secAPIs = new APIs({
      CenterController: this.CenterController,
      Dbconfig: dbconfig,
      ChainName: 'SEC'
    })

    this.senAPIs = new APIs({
      CenterController: this.CenterController,
      Dbconfig: dbconfig,
      ChainName: 'SEN'
    })
  }

  run () {
  }
}

module.exports = Core
