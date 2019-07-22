const chalk = require('chalk')
const SECConfig = require('../../config/default.json')

const SECPow = require('@biut-block/biutjs-pow')
let secPow = {}

process.on('message', blockForPOW => {
  let randomInt = Math.floor(Math.random() * Math.floor(20))
  secPow = new SECPow({
    cacheDBPath: blockForPOW.cacheDBPath + randomInt.toString() || process.cwd() + SECConfig.SECBlock.dbConfig.Path + SECConfig.SECBlock.powConfig.path + randomInt.toString(),
    expectedDifficulty: SECConfig.SECBlock.powConfig.expectedDifficulty
  })

  blockForPOW.Header = Buffer.from(blockForPOW.Header)
  blockForPOW.Difficulty = secPow.calcDifficulty(blockForPOW.lastBlockDifficulty, blockForPOW.Number, blockForPOW.lastPowCalcTime)
  console.time(`POW Calculation Duration with Diffculty ${blockForPOW.Difficulty}`)
  secPow.mineLight(blockForPOW, blockForPOW.Difficulty, (nonce, result) => {
    console.timeEnd(`POW Calculation Duration with Diffculty ${blockForPOW.Difficulty}`)
    blockForPOW.MixHash = result.mix
    blockForPOW.Nonce = nonce
    console.log(chalk.magenta('POW RESULT: '))
    console.log(chalk.magenta('Mix Hash: ' + blockForPOW.MixHash.toString('hex')))
    console.log(chalk.magenta('Nonce: ' + blockForPOW.Nonce.toString('hex')))
    secPow.verifyPOW(blockForPOW, (result) => {
      console.log(chalk.magenta('Verified POW: ' + result))
      process.send({
        result: result,
        Difficulty: blockForPOW.Difficulty,
        MixHash: blockForPOW.MixHash.toString('hex'),
        Nonce: blockForPOW.Nonce
      })
    })
  })
})

process.on('close', () => {
  secPow.cacheDB.close()
})

process.on('SIGINT', () => {
  secPow.cacheDB.close()
})

process.on('SIGTERM', () => {
  secPow.cacheDB.close()
})
