const chalk = require('chalk')
const SECConfig = require('../../config/default.json')

const SECPow = require('@sec-block/secjs-pow')
let secPow = {}

process.on('message', blockForPOW => {
  secPow = new SECPow({
    cacheDBPath: blockForPOW.cacheDBPath || process.cwd() + SECConfig.SECBlock.dbConfig.Path + SECConfig.SECBlock.powConfig.path,
    expectedDifficulty: SECConfig.SECBlock.powConfig.expectedDifficulty
  })
  let difficulty = secPow.calcDifficulty(blockForPOW.lastBlockDifficulty, blockForPOW.Number, blockForPOW.lastPowCalcTime)
  blockForPOW.Header = Buffer.from(blockForPOW.Header, 'hex')
  console.time(`POW Calculation Duration with Diffculty ${difficulty}`)
  secPow.mineLight(blockForPOW, difficulty, (nonce, result) => {
    console.timeEnd(`POW Calculation Duration with Diffculty ${difficulty}`)
    blockForPOW.MixHash = result.mix
    blockForPOW.Nonce = nonce
    console.log(chalk.magenta('POW RESULT: '))
    console.log(chalk.magenta('Mix Hash: ' + blockForPOW.MixHash.toString('hex')))
    console.log(chalk.magenta('Nonce: ' + blockForPOW.Nonce.toString('hex')))
    secPow.verifyPOW(blockForPOW, (result) => {
      console.log(chalk.magenta('Verified POW: ' + result))
      process.send({
        result: result,
        Difficulty: difficulty,
        MixHash: blockForPOW.MixHash.toString('hex'),
        Nonce: blockForPOW.Nonce
      })
    })
  })
})

process.on('close', () => {
  secPow.cacheDB.close()
})
