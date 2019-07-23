const fs = require('fs')
const path = require('path')

// console.log(path.join(__dirname, '../temp.txt'))

// console.log( __dirname)

let test = { table: [] }
let obj1 = { status: '1', message: 'OK', resultInPool: [], currentPage: 2, totalNumber: 74 }
let obj2 = { status: '2', message: 'OK', resultInPool: [], currentPage: 2, totalNumber: 74 }
test.table.push(obj1)
test.table.push(obj2)

var content = JSON.stringify(test)
fs.appendFile(path.join(__dirname, '../temp.json'), content, 'utf-8', (err) => {
  if (err) {
    console.log(err)
  }
  console.log('Store key successed')
})

/*
fs.readFile('C:/Users/Xuan/Desktop/temp.json', 'utf-8', (err, data) => {
  if (err) {
    console.log(err)
  } else {
    let obj = JSON.parse(data)
    console.log(obj.table)
    for (var i = 0; i < obj.table.length; i++) {
      if (obj.table[i].status === '1') {
        console.log(obj.table[i].status)
      }
    }
  }
})
*/