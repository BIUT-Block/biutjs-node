const vm = require('vm')

class SECRunContract{

    constructor(SECTx, SENTokenBlockChain){
        this.SECTx = SECTx
        this.SENTokenBlockChain = SENTokenBlockChain
        this.response = {
            status: 0,
            message: ''
        }
    }

    run(callback){
        this.SENTokenBlockChain.chainDB.findTxForUser(this.SECTx.TxTo, (err, txArray)=>{
            if (err) {
                this.response.status = 0
                this.response.message = 'Failed to Fetch Contract on Chain. Please Confirm.'
            } else {
                if (txArray.length>0){
                    txArray = txArray.sort((a, b) => {
                        return a.TimeStamp - b.TimeStamp
                    })
                    let rawByteCode = txArray[0].InputData
                    this.response.code = new Buffer(rawByteCode, 'base64').toString()
                    this.response.callInfo = new Buffer(this.SECTx.InputData, 'base64').toString()
                    this.response.status = 1
                    this.response.message = 'Call Smart Contract Success'
                
                    const runScript = this.response.code + '; Results = ' + this.response.callInfo
                    const sandbox = {
                        transferFlag: false,
                        Results: ''
                    }
                    vm.createContext(sandbox)
                    vm.runInContext(runScript, sandbox)
                    if(sandbox.transferFlag){
                        this.response.transferResult = sandbox.Results
                    }else{
                        this.response.otherResult = sandbox.Results
                    }
                } else {
                    this.response.status = 1
                    this.response.message = 'Create Smart Contract Success'
                }
            }
            callback(null, this.response)
        })
    }
} 

module.exports = SECRunContract