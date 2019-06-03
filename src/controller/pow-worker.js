const chalk = require('chalk')

let secPow = {}

process.on('message', blockForPOW => {
  secPow = blockForPOW.secPow
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
