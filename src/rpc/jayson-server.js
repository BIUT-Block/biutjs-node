const jayson = require('jayson')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')

let core = {}

/**
 * verify user json web token
 * @param  {string} token 24 hours valid token
 * @param  {} callback
 */
/*
function jwtVerify (token, callback) {
  jwt.verify(token, 'MongoX-Block', callback)
} */

/**
  * create a server at localhost:3001
  */
let server = jayson.server({

  /**
   * example json rpc code
   * @param  {object or array} args
   * @param  {} callback
   */
  add: function (args, callback) {
    callback(null, args[0] + args[1])
  },

  /**
   * support service for user login
   * need user account and user password
   * @param  {object} args includes account and password
   * @param  {} callback
   * it will read data bank and verify user account and password
   * if it is right, and it will generate jwt token and callback
   */
  userLogin: function (args, callback) {
    let response = {}
    let tokenInfo = {}

    core.APIs.readUserInfofromAccountDB(args.account).then((data) => {
      if (data[0].privateKey === args.privateKey) {
        response.status = 'success'
        response.info = 'Login Successfull'
        tokenInfo.account = data[0].account
        tokenInfo.email = data[0].email
        tokenInfo.telefon = data[0].telefon
        /**
         * generate a token and give user for next time
         */
        let token = jwt.sign(tokenInfo, 'MongoX-Block', {
          /**
           * setting token aktiv time
           */
          'expiresIn': 60 * 60 * 24
        })
        response.account = {
          'username': data[0].account,
          'email': data[0].email,
          'telefon': data[0].telefon,
          'userAddress': data[0].address,
          'message': 'Enjoy your token',
          'token': token
        }
        response.wallet = {
          publicKey: data[0].publicKey,
          addressString: data[0].addressString,
          balance: data[0].balance
        }

        callback(null, response)
      } else {
        response.status = 'fail'
        response.info = 'Invalid Private Key'
        let token = ''
        response.token = token
        callback(null, response)
      }
    }).catch((err) => {
      response.status = err
      response.info = 'Invalid account, pleaes register'
      callback(null, response)
    })
  },

  /*
  userLoginWithToken: function (args, callback) {
    let userToken = args.token
    let response = {}
    jwtVerify(userToken, (err, decoded) => {
      if (err) {
        response.status = 'InvalidToken'
        callback(null, response)
      } else {
        core.APIs.readUserInfofromAccountDB(decoded.account).then((data) => {
          response.status = 'success'
          response.info = 'Login Successfull'
          response.account = {
            'username': data[0].account,
            'email': data[0].email,
            'telefon': data[0].telefon,
            'userAddress': data[0].address
          }
          response.wallet = {
            publicKey: data[0].publicKey,
            addressString: data[0].addressString,
            balance: data[0].balance
          }
          callback(null, response)
        })
      }
    })
  }, */

  /**
   * support user private key and just check user token without account and password
   * give input as token
   * @param  {Object} args
   * @param  {} callback
   */
  /*
  accountKey: function (args, callback) {
    let response = {}
    let token = args.token

    jwtVerify(token, (err, decoded) => {
      if (err) {
        response.status = 'false'
        response.info = 'Invalid Token'
        callback(null, response)
      } else {
        core.APIs.readUserInfofromAccountDB(decoded.account).then((data) => {
          response.status = 'true'
          response.info = decoded
          response.privateKey = data[0].privateKey
          callback(null, response)
        }).catch((err) => {
          response.status = err
          response.info = 'read data DB error'
          callback(null, response)
        })
      }
    })
  }, */

  /*
  getPublicKey: function (args, callback) {
    let response = {}
    let token = args.token

    jwtVerify(token, (err, decoded) => {
      if (err) {
        response.status = 'false'
        response.info = 'Invalid Token'
        callback(null, response)
      } else {
        core.APIs.readUserInfofromAccountDB(decoded.account).then((data) => {
          response.status = 'true'
          response.info = decoded
          response.publicKey = data[0].publicKey
          callback(null, response)
        }).catch((err) => {
          response.status = err
          response.info = 'read data DB error'
          callback(null, response)
        })
      }
    })
  }, */

  /*
  getAddress: function (args, callback) {
    let response = {}
    let token = args.token

    jwtVerify(token, (err, decoded) => {
      if (err) {
        response.status = 'false'
        response.info = 'Invalid Token'
        callback(null, response)
      } else {
        core.APIs.readUserInfofromAccountDB(decoded.account).then((data) => {
          response.status = 'true'
          response.info = decoded
          response.addressString = data[0].addressString
          callback(null, response)
        }).catch((err) => {
          response.status = err
          response.info = 'read data DB error'
          callback(null, response)
        })
      }
    })
  }, */

  /**
   * get all token block chain infomation
   */
  getWholeTokenBlockchain: function (args, callback) {
    let response = {}
    core.APIs.getWholeTokenBlockchain((err, value) => {
      if (err) {
        response.status = 'false'
        response.info = 'get Whole TokenBlockchain Error'
        callback(null, response)
      } else {
        response.status = 'true'
        response.info = value
        callback(null, response)
      }
    })
  },

  getTokenTxForUser: function (args, callback) {
    let response = {}
    core.APIs.getTokenTxForUser(args.address, (err, txArray) => {
      if (err) {
        response.status = 'false'
        response.info = 'get Token Transactions Error'
        callback(null, response)
      } else {
        response.status = 'true'
        response.info = txArray
        callback(null, response)
      }
    })
  },

  getTokenChainBlocksByHash: function (args, callback) {
    let response = {}
    core.APIs.getTokenBlock(args.blockHash, (err, value) => {
      if (err) {
        response.status = 'false'
        response.info = 'get Token Transactions Error'
        callback(null, response)
      } else {
        response.status = 'true'
        response.info = value
        callback(null, response)
      }
    })
  },

  /**
   * crea a new transaction in token chain
   */
  newTokenChainTx: function (args, callback) {
    let response = {}
    let tokenTxHash = crypto.randomBytes(32).toString('hex')
    let transaction = {
      TxHash: tokenTxHash,
      TxReceiptStatus: 'pending',
      Version: '0.0.1',
      TimeStamp: new Date().getTime(),
      TxFrom: args.From,
      TxTo: args.To,
      Value: args.value,
      GasLimit: '6416',
      GasUsedByTxn: '729',
      GasPrice: '0.001',
      TxFee: args.TxFee,
      Nonce: '8267',
      InputData: 'Test Token Transaction'
    }
    core.CenterController.getBlockchain().initiateTokenTx(transaction)
    response.status = 'true'
    response.tokenTxHash = tokenTxHash
    response.info = 'wrote in transaction pool, waiting blockchain'
    callback(null, response)
  },

  /**
   *find user wallet balance
   */
  getBalance: function (args, callback) {
    let response = {}
    core.APIs.getBalance(args.address, (err, userBalance) => {
      if (err) {
        response.status = 'true'
        response.info = 'no previous transactions found'
        response.address = args.address
        response.balance = 0
        callback(null, response)
      } else {
        response.status = 'true'
        response.info = 'get user balance success'
        response.address = args.address
        response.balance = userBalance
        callback(null, response)
      }
    })
  }
})

exports.runRpc = function (_core) {
  core = _core
  server.http().listen(3000)
}
