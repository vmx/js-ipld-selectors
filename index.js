'use strict'

const promisify = require('util').promisify

const CID = require('cids')
const ipldDagCbor = require('ipld-dag-cbor')

const utils = require('./utils.js')

// TODO vmx 2019-02-12: This shouldn't be a global variable
let blockService

class SelectPath {
  constructor (selector) {
    this.path = selector
  }

  // `node` (`IPLDNode`, required): The IPLD Node the selector is matched on
  // returns an object with these keys:
  //  - `callAgain` (boolean): Is always `false`
  //  - `node` (CID|Node|Array.<Node>): The node(s) to follow next
  visit (node) {
    if (this.path in node) {
      return {
        node: node[this.path],
        callAgain: false
      }
    } else {
      return null
    }
  }
}

class SelectArray {
  constructor (selector) {
    this.position = null
    this.slice = null
    if ('position' in selector) {
      this.position = selector.position
    }
    if ('slice' in selector) {
      this.slice = {}
      if ('start' in selector.slice) {
        this.slice.start = selector.slice.start
      } else {
        this.slice.start = 0
      }
      if ('end' in selector.slice) {
        this.slice.end = selector.slice.end
      }
    }
  }

  // `node` (`IPLDNode`, required): The IPLD Node the selector is matched on
  // returns an object with these keys:
  //  - `callAgain` (boolean): Is always `false`
  //  - `node` (CID|Node|Array.<Node>): The node(s) to follow next
  visit (node) {
    if (Array.isArray(node)) {
      let returnValue
      if (this.position !== null) {
        returnValue = node[this.position]
      } else if (this.slice !== null) {
        returnValue = node.slice(this.slice.start, this.slice.end)
      } else {
        returnValue = node
      }
      return {
        node: returnValue,
        callAgain: false
      }
    } else {
      return null
    }
  }
}

class SelectRecursive {
  constructor (selector) {
    this.follow = selector.follow
    this.depthLimit = selector.depthLimit
  }

  // `node` (`IPLDNode`, required): The IPLD Node the selector is matched on
  // returns an object with these keys:
  //  - `callAgain` (boolean): whether this selector should be called again
  //    if it matched
  //  - `node` (CID|Node|Array.<Node>): The node(s) to follow next
  visit (node) {
    // If a depth limit is given, count it down for every iteration
    if (this.depthLimit !== null) {
      this.depthLimit--
    }
    const result = this.follow.visit(node)
    if (result === null) {
      return null
    } else {
      // The result can't contain a recursive call as we forbid that
      if (result.callAgain) {
        throw new Error(
          'recursive selectors inside a recursion are not allowed')
      }
      const callAgain = this.depthLimit !== null && this.depthLimit > 0
      return {
        node: result.node,
        callAgain
      }
    }
  }
}

const buildSelector = (selector) => {
  // This is here to make it easier for callers
  if (selector === undefined) {
    return null
  }

  // The root level field is the type of the selector
  const keys = Object.keys(selector)
  if (keys.length > 1) {
    throw new Error('Invalid selector: more than one field at the root')
  }

  switch (keys[0]) {
    case 'selectPath':
      return new SelectPath(selector[keys[0]])
    case 'selectArray':
      return new SelectArray(selector[keys[0]])
    case 'selectRecursive':
      return new SelectRecursive(selector[keys[0]])
    default:
      throw new Error(`Unknown selector: "${keys[0]}"`)
  }
}


const getBlock = async (cid) => {
  return promisify(blockService.get.bind(blockService))(cid)
}

// TODO vmx 2019-02-12: Support more than just CBOR
const deserialize = async (block) => {
  return promisify(ipldDagCbor.util.deserialize)(block.data)
}


// TODO vmx 2019-01-31: Error cases like having a node not locally available

const select = async function* (block, selectors) {
  // Always return the block where the traversal started
  yield block
  // The stack of nodes that we still need to traverse. It's an array of
  // object with the following shape:
  //  - `selectors`: The selectors that should be applied to the nodes
  //  - `nodes`: The CIDs of the nodes that should be traversed
  const stack = []
  // Create an actual object out of the binary representation of a selector
  let selector = buildSelector(selectors.shift())
  let node = await deserialize(block)
  while (selector !== null) {
    const result = selector.visit(node)

    // The selector didn't match the current node
    if (result === null) {
      // There might be further nodes we want to traverse
      if (stack.length > 0) {
        // Prepare for the next iteration
        const siblings = stack.pop()
        node = siblings.nodes.shift()
        selectors = siblings.selectors
        selector = buildSelector(selectors.shift())
        // There are still nodes left to traverse in the future, hence push
        // them back on the stack
        if (siblings.nodes.length > 0) {
          stack.push({
            nodes: siblings.nodes,
            selectors: siblings.selectors
          })
        }
        // Let's continue with the sibling
        continue
      } else { // Nothing else to do, we are finished with the traversal
        // Signal that the selector wasn't fully resolved
        if (selectors.length > 0) {
          return selectors
        } else {
          return
        }
      }
    } else { // We have a match

      // Move on to the next selector if it is not a recursive one or the
      // recursion has stopped
      if (!result.callAgain) {
        selector = buildSelector(selectors.shift())
      }

      if (CID.isCID(result.node)) {
        // Get Node and save it as current node
        block = await getBlock(result.node)
        // Error if you node is not locally available
        if (block === null) {
          throw new Error("Block doesn't exist")
        }
        // As soon as we got a new block we return it. Even if the contents
        // of this block doesn't match. The reason is that the verifier on
        // the receiving side also needs to get non-matching nodes in order
        // to verify that they don't match. It can't just trust the sender.
        yield block
        node = await deserialize(block)
      } else if (Array.isArray(result.node)) {
        // Get the first child for the next iteration (we are doing depth-first
        // traversal and push the rest on top of the stack for future traversal
        node = result.node.shift()
        stack.push({
          nodes: result.node,
          selectors: selectors.slice()
        })
      } else {
        node = result.node
      }
    }
  }
}


const main = async (argv) => {
  const ipfsPath = process.env.IPFS_PATH
  if (ipfsPath === undefined) {
    throw Error('`IPFS_PATH` needs to be defined')
  }
  //const rootCid = new CID(argv[2])
  blockService = await utils.openBlockService(ipfsPath)

  const rootCid = new CID('zdpuAtrJV5fFSj6tpFw4s8xokdvCGxd6c25SYgZbUhchBf51j')
  //const rootCid = new CID('zdpuB36ZuGVssQYZGusKbNhWh2EAt5XhEcf3Zy7dFme5WKynu')
  const selector = [
    {"selectPath": "child"},
    {"selectPath": "child"},
    {"selectPath": "child"},
    {"selectPath": "child"},
    {"selectPath": "child"},
    {"selectPath": "child"},
    {"selectPath": "child"}
  ]

  const rootBlock = await getBlock(rootCid)
  const result = select(rootBlock, selector)

  let next
  for (next = await result.next(); !next.done; next = await result.next()) {
   const block = next.value
   console.log('block:', block.cid.toBaseEncodedString())
  }
  if (next.value !== undefined) {
    console.log(`The selector wasn't fully resolved:`, next.value)
  } else {
    console.log(`done.`)
  }
}

if (require.main === module) {
  main(process.argv).catch((error) => {
    console.error(error)
  })
}

