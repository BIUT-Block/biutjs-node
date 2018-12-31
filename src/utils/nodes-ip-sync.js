class NodesIPSync {
  constructor () {
    this.NodesTable = []
  }

  updateNodesTable (nodes) {
    nodes.forEach(node => {
      if (this.NodesTable.map(_node => { return _node.id }).indexOf(node.id) < 0) {
        node.TimeStamp = new Date()
        this.NodesTable.push(node)
      } else {
        this.NodesTable.filter(__node => { return __node.id === node.id })[0].TimeStamp = new Date()
      }
    })
    this._removeUeslessNodes()
  }

  _removeUeslessNodes () {
    this.NodesTable.forEach((node, index) => {
      let age = (new Date().getTime() - node.TimeStamp) / 1000
      // remove the nodes, which 1 hours not response
      if (age > 3600) {
        this.NodesTable.splice(index, 1)
      }
    })
  }

  getNodesTable () {
    return this.NodesTable
  }
}

module.exports = NodesIPSync
