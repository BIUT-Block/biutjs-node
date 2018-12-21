const SECConfig = require('../config/default.json')
const crypto = require('crypto')

// -------------------------------  SEC LIBRARIES  -------------------------------
const SECDatahandler = require('@sec-block/secjs-datahandler')

const dbconfig = {
  // DBPath: process.cwd() + SECConfig.SECBlock.dbConfig.Path,
  ID: [
    '1897984547'
    // '1897984548'
    // '1897984549',
    // '1897984550'
  ]
}

const Account = require('./account/account')
const APIs = require('./apis/apis')
const CenterController = require('./controller/center-controller.js')

class Core {
  constructor (config = { DBPath: process.cwd() + SECConfig.SECBlock.dbConfig.Path, cacheDBPath: process.cwd() + SECConfig.SECBlock.dbConfig.Path + SECConfig.SECBlock.powConfig.path }) {
    dbconfig.DBPath = config.DBPath
    dbconfig.cacheDBPath = config.cacheDBPath

    // -------------------------------  SEC DATAHANDLER  ------------------------------- //
    let TokenBlockchainDataHandler = new SECDatahandler.TokenBlockChainDB(dbconfig)
    let txDbDict = {}
    dbconfig.ID.forEach((TxChainID) => {
      let TxBlockchainDataHandler = new SECDatahandler.TxBlockChainDB({
        DBPath: dbconfig.DBPath,
        ID: TxChainID
      })
      txDbDict[TxChainID] = TxBlockchainDataHandler
    })

    // -------------------------------  OTHER SEC OBJECTS  ------------------------------- //
    this.Account = new Account()
    this.CenterController = new CenterController({
      PRIVATE_KEY: crypto.randomBytes(32),
      SECTokenDataHandler: TokenBlockchainDataHandler,
      SECTxDbDict: txDbDict,
      SECAccount: this.Account,
      dbconfig: dbconfig
    })

    this.APIs = new APIs({
      SECTokenDataHandler: TokenBlockchainDataHandler,
      SECTxDbDict: txDbDict,
      CenterController: this.CenterController
    })
  }

  run () {
  }
}

module.exports = Core
