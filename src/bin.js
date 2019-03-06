'use strict'

const fs = require('fs').promises
const promisify = require('util').promisify

const neodoc = require('neodoc')

const { SelectorEngine } = require('./index')
const utils = require('./utils.js')

const helpText = `
usage: ipld-selectors.js FILE

arguments:
    FILE  The file containing a selector (encoded as JSON)
`

// Applies a function to every value (similar to `forEach()`) and returns
// the return value of the iterator once it's finished
const asyncIteratorHelper = async (iter, step) => {
  let next
  for (next = await iter.next(); !next.done; next = await iter.next()) {
    step(next.value)
  }
  return next.value
}

const main = async (argv) => {
  const ipfsPath = process.env.IPFS_PATH
  if (ipfsPath === undefined) {
    throw Error('`IPFS_PATH` needs to be defined')
  }

  const args = neodoc.run(helpText)
  const selector = JSON.parse(await fs.readFile(args.FILE))
  const blockService = await utils.openBlockService(ipfsPath)
  const getBlockFun = promisify(blockService.get.bind(blockService))
  const engine = new SelectorEngine(getBlockFun)
  const result = await engine.select(selector)

  const finalValue = await asyncIteratorHelper(result, (item) => {
    console.log(item.cid.toBaseEncodedString())
  })
  if (finalValue !== undefined) {
   console.log(`The selector wasn't fully resolved:`, finalValue)
  }
  await utils.closeBlockService(blockService)
}

main(process.argv).catch((error) => {
  console.error(error)
})
