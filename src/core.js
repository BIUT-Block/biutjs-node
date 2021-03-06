const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const args = require('minimist')(process.argv.slice(2))
const SECLogger = require('@biut-block/biutjs-logger')

const APIs = require('./apis/apis')
const Account = require('./account/account')
const CenterController = require('./controller/center-controller.js')
const SECConfig = require('../config/default.json')

// -------------------------------  set SEC DataBase configuration  -------------------------------
class Core {
  constructor (config = {
    DBPath: process.cwd() + SECConfig.SECBlock.dbConfig.Path,
    SecDBPath: process.cwd() + SECConfig.SECBlock.dbConfig.Path + SECConfig.SECBlock.dbConfig.SecPath,
    SenDBPath: process.cwd() + SECConfig.SECBlock.dbConfig.Path + SECConfig.SECBlock.dbConfig.SenPath,
    cacheDBPath: process.cwd() + SECConfig.SECBlock.dbConfig.Path + SECConfig.SECBlock.powConfig.path,
    address: '',
    loggerPath: 'biutlogs'
  }) {
    config.logger = SECLogger.createLogger(config.loggerPath)
    config.logger.info('Start Logger (new restart)')
    if (process.env.netType === 'test') {
      config.SecDBPath = config.SecDBPath + 'test/'
      config.SenDBPath = config.SenDBPath + 'test/'
    } else if (process.env.netType === 'develop') {
      config.SecDBPath = config.SecDBPath + 'develop/'
      config.SenDBPath = config.SenDBPath + 'develop/'
    }

    // ----------------------  SETUP MINING ADDRESS  ----------------------
    if (args['addr'] !== undefined) {
      config.address = args['addr']
    }
    let addrFilePath = path.join(process.cwd(), '/address')
    if (fs.existsSync(addrFilePath)) {
      config.address = fs.readFileSync(addrFilePath, 'utf8')
    }

    // --------------------  GENERATE NDP PRIVATE_KEY  --------------------
    if (args['NDPPrivKey'] !== undefined) {
      config.NDPPrivKey = args['NDPPrivKey']
    }
    let NDPPrivKeyFilePath = config.NDPPrivKeyFilePath || path.join(process.cwd(), '/ndpprivatekey')
    if (fs.existsSync(NDPPrivKeyFilePath)) {
      config.NDPPrivKey = fs.readFileSync(NDPPrivKeyFilePath, 'utf8')
    } else {
      config.NDPPrivKey = config.NDPPrivKey || crypto.randomBytes(32).toString('hex')
      fs.writeFileSync(NDPPrivKeyFilePath, config.NDPPrivKey)
    }

    // -------------------------------  OTHER SEC OBJECTS  ------------------------------- //
    this.Account = new Account(config.address)
    this.CenterController = new CenterController({
      PRIVATE_KEY: Buffer.from(config.NDPPrivKey, 'hex'),
      SECAccount: this.Account,
      dbconfig: config
    })

    this.secAPIs = new APIs({
      CenterController: this.CenterController,
      config: config,
      ChainName: 'SEC'
    })

    this.senAPIs = new APIs({
      CenterController: this.CenterController,
      config: config,
      ChainName: 'SEN'
    })
  }

  run () {
  }
}

module.exports = Core
