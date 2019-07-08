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
        this.SENTokenBlockChain.getSourceCode(this.SECTx.TxTo, (err, sourceCode)=>{
            if (err) {
                this.response.status = 0
                this.response.message = 'Failed to Fetch Contract on Chain. Please Confirm.'
            } else {
                if (sourceCode){
                    //txArray = txArray.sort((a, b) => {
                    //    return a.TimeStamp - b.TimeStamp
                    //})
                    //let rawByteCode = txArray[0].InputData
                    this.response.code = new Buffer(sourceCode, 'base64').toString()
                    this.response.callInfo = new Buffer(this.SECTx.InputData, 'base64').toString()
                    this.response.status = 1
                    this.response.message = 'Call Smart Contract Success'
                
                    const runScript = this.response.code + '; Result = ' + this.response.callInfo
                    const sandbox = {
                        Result: {}
                    }
                    vm.createContext(sandbox)
                    vm.runInContext(runScript, sandbox)
                    if(sandbox.Results.transferFlag){
                        this.response.functionType = 'transfer'
                    }else if(sandbox.Results.depositFlag){
                        this.response.functionType = 'deposit'
                    }else if(sandbox.Results.withdrawFlag){
                        this.response.functionType = 'withdraw'
                    }else {
                        this.response.functionType = 'others'
                    }
                    this.response.result = sandbox.Result
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