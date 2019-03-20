const vm = require('vm')

class SECRunContract{

    constructor(SECTx, SECTokenBlockChain){
        this.SECTx = SECTx
        this.SECTokenBlockChain = SECTokenBlockChain
        this.response = {
            status: 0,
            message: '',
            transferResult: {},
            otherResults: {}
        }
        this._getCode()
    }

    _getCode(){
        this.SECTokenBlockChain.chainDB.findTxForUser(this.SECTx.TxTo, (err, txArray)=>{
            if (err) {
                this.response.status = 0
                this.response.message = 'Failed to Fetch Contract on Chain. Please Confirm.'
            } else {
                txArray = txArray.sort((a, b) => {
                    return b.TimeStamp - a.TimeStamp
                })
                let rawByteCode = txArray[0].inputData
                this.response.code = new Buffer(rawByteCode, 'base64').toString()
                this.response.callInfo = new Buffer(this.SECTx.inputData, 'base64').toString()
                this.response.status = 1
                this.response.message = 'Code Fetched'
            }
        })
    }

    run(){
        let regexPattern = /transfer\((\w+),\s*([0-9]+[.][0-9]*)\)/
        if(this.response.callInfo.match(regexPattern)){
            this.response.transferResult.txToAddr = RegExp.$1
            this.response.transferResult.TxAmount = RegExp.$2
        } else {
            const runScript = this.response.code + '/n otherResults = ' + this.response.callInfo
            const sandbox = {
                otherResults: ''
            }
            vm.createContext(sandbox)
            vm.runInContext(runScript, sandbox)
            this.response.otherResults = sandbox.otherResults
        }
        return this.response
    }
} 
