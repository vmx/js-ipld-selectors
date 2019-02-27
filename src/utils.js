'use strict'

const promisify = require('util').promisify

const IpfsBlockService = require('ipfs-block-service')
const IpfsRepo = require('ipfs-repo')

const openBlockService = promisify((ipfsRepoPath, callback) => {
  const repo = new IpfsRepo(ipfsRepoPath)
  repo.open((err) => {
    if (err) {
      callback(err)
    }
    const blockService = new IpfsBlockService(repo)
    callback(null, blockService)
  })
})

module.exports = {
  openBlockService
}
