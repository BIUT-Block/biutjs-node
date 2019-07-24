const fs = require('fs')
const path = require('path')

// console.log(path.join(__dirname, '../temp.txt'))

// console.log( __dirname)

let test = { table: [] }
let obj1 = { status: '1', message: 'OK', resultInPool: [], currentPage: 2, totalNumber: 74 }
let obj2 = { status: '2', message: 'OK', resultInPool: [], currentPage: 2, totalNumber: 74 }

/*
var content = JSON.stringify(obj2) + ','
fs.appendFile(path.join(__dirname, '../temp.json'), content, 'utf-8', (err) => {
  if (err) {
    console.log(err)
  }
  console.log('Store key successed')
})
*/

/* fs.readFile(path.join(__dirname, '../temp.json'), 'utf-8', (err, data) => {
  if (err) {
    console.log(err)
  } else {
    let _data = data.substring(0, data.length - 1)
    let transData = '{"table": [' + _data + ']}'
    let obj = JSON.parse(transData)
    for (var i = 0; i < obj.table.length; i++) {
      if (obj.table[i].status === '1') {
        console.log(obj.table[i].status)
      }
    }
  }
})
*/

function _getPrivateKeysFromAddress (userAddress) {
  fs.readFile(path.join(__dirname, '../keylib.json'), 'utf-8', (err, data) => {
    if (err) {
      console.log(err)
    } else {
      let _data = data.substring(0, data.length - 1)
      let transData = '{"table": [' + _data + ']}'
      let jsonData = JSON.parse(transData)
      for (var i = 0; i < jsonData.table.length; i++) {
        if (jsonData.table[i].userAddress === userAddress) {
          console.log(jsonData.table[i].privateKey)
          // return 
        }
      }
    }
  })
}

_getPrivateKeysFromAddress('9abbd811b727e4671d4ab9aebeeb126337aa719b')
