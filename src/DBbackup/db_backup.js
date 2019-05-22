const exec = require('child_process').exec
const moment = require('moment')
const path = require('path')
const fs = require('fs')

class DBBackupHandler {
  constructor(path) {
    this.backupResult = ''
    this.dbPath = path
    this.result = ''
  }

  backupChainData(fnAfterBackup) {
    this._writeLog(`Executing [${moment().format('HH-mm-ss')}] all Data Backup at ${(new Date()).toISOString()}`)
    if (!fs.existsSync(path.join(path.resolve('../..'), '/backup'))) {
      fs.mkdirSync(path.join(path.resolve('../..'), '/backup'))
    }
    let cmd = 'tar -czf ' + path.join(path.resolve('../..'), '/backup/data_' + moment().format('YYYY-MM-DD_HH-mm-ss') + '.tar.gz ') + this.dbPath
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        this._writeLog(err)
        this._writeLog(`Backup [data_${moment().format('YYYY-MM-DD_HH-mm-ss')}] of Data at ${(new Date()).toISOString()} failed.`)
        fnAfterBackup()
      } else {
        this._writeLog(`Backup [data_${moment().format('YYYY-MM-DD_HH-mm-ss')}] of Data at ${(new Date()).toISOString()} successfully.`)
        exec('df -h | grep /dev/disk1', (err, stdout, stderr) => {
          if (err) throw new Error(err)
          this._writeLog(stdout)
          exec('sudo pm2 status', (err, stdout, stderr) => {
            if (err) throw new Error(err)
            this.writeLog(stdout)
            fnAfterBackup()
          })
        })
      }
    })
  }

  removeOutDatedBackup (backupPath, fnAfterRemove) {
    this._writeLog(`Remove [${moment().format('HH-mm-ss')}] all Data Backup at ${(new Date()).toISOString()}`)
    if (!fs.existsSync(path.join(path.resolve('../..'), '/backup'))) {
      this._writeLog('Backup folder not exits.')
      return
    }
    fs.readdir(backupPath, (err, files) => {
      if (err) throw new Error(err)
      let outDatedFiles = files.filter((filename) => {
        if (fs.statSync(backupPath + '/' + filename).mtime.getTime() < this._getOutDateTimestamp()) {
          return filename
        }
      })
      outDatedFiles.forEach((file) => {
        let cmd = `rm -rf ${backupPath}` + '/' + `${file}`
        exec(cmd, (err, stdout, stderr) => {
          if (err) throw new Error(err)
        })
      })
      fnAfterRemove()
    })
  }

  _getOutDateTimestamp () {
    var today = new Date()
    return new Date(today.getTime() - (6 * 24 * 60 * 60 * 1000)).getTime()
  }

  _writeLog (text) {
    console.log(text)
    this.result += text + '\r'
  }
}

module.exports = DBBackupHandler

/** start program to backup */
// let backupTime = 6000
// let backupTool = new DBBackupHandler('data/*')
// setInterval(() => {
//   backupTool.backupChainData(() => {
//     console.log('Backup !!')
//   })
// }, backupTime)

/** start program to cleanup */

// backupTool.removeOutDatedBackup(path.join(path.resolve('../..'), 'backup'), () => {
//   console.log('Clean up outdated file')
// })
