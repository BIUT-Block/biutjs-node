const jayson = require('jayson')
const ip = require('ip')
const SECUtils = require('@sec-block/secjs-util')

let myIp = ip.address()

let client1 = jayson.client.http({
  host: myIp,
  port: 3002
})

function sendTx1 () {
  const userInfo = {
    privKey: 'e976359381e71614f783edd3f4d9046639c022edce478101c8a5e3332cdefd43',
    publicKey: '09a9b34222358e38b37fd1cded2e4b2618057be3f29d2b2a4897318a808a77554facb0f3e0609328aa0fd396c58879c52db7f2f192824f841bbb9f5cdd64fa8d',
    secAddress: 'fa9461cc20fbb1b0937aa07ec6afc5e660fe2afd'
  }
  const request = [{
    timestamp: new Date().getTime(), // number
    from: 'fa9461cc20fbb1b0937aa07ec6afc5e660fe2afd', // 40 bytes address
    to: '8df9628de741b3d42c6f4a29ed4572b0f05fe8b4', // 40 bytes address
    value: '0.01', // string
    contractAddress: '', // string, null
    gasLimit: '0', // string, temporarily set to 0
    gas: '0', // string, temporarily set to 0
    gasPrice: '0', // string, temporarily set to 0
    inputData: 'Sec test transaction', // string, user defined extra messages
    data: ''
  }]
  const tokenTxBuffer = [
    SECUtils.bufferToInt(request[0].timestamp),
    Buffer.from(request[0].from, 'hex'),
    Buffer.from(request[0].to, 'hex'),
    Buffer.from(request[0].value),
    Buffer.from(request[0].contractAddress),
    Buffer.from(request[0].gasLimit),
    Buffer.from(request[0].gas),
    Buffer.from(request[0].gasPrice),
    Buffer.from(request[0].inputData)
  ]
  let txSigHash = Buffer.from(SECUtils.rlphash(tokenTxBuffer).toString('hex'), 'hex')
  let signature = SECUtils.ecsign(txSigHash, Buffer.from(userInfo.privKey, 'hex'))
  request[0].data = {
    v: signature.v,
    r: signature.r.toString('hex'),
    s: signature.s.toString('hex')
  }
  client1.request('sec_sendRawTransaction', request, (err, response) => {
    if (err) console.log(err)
    console.log(response)
  })
}

const interval = 63
const duration = 3 * 60 * 1000 // ms
// 8tps, 3*180*8 = 4320

let stop = setInterval(sendTx1, interval)

setTimeout(() => { clearInterval(stop) }, duration)
