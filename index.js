'use strict'

const fs = require('fs').promises
const promisify = require('util').promisify

const CID = require('cids')
const ipldDagCbor = require('ipld-dag-cbor')
const neodoc = require('neodoc')

const utils = require('./utils.js')

// TODO vmx 2019-02-12: This shouldn't be a global variable
let blockService

const helpText = `
usage: ipld-selectors.js FILE

arguments:
    FILE  The file containing a selector (encoded as JSON)
`
//usage: ipld-selectors.js [--include-id] FILE
//options:
//    -i, --include-id  Add the id speficied in the DAG file to the node (if the node is JSON)

// General idea for implementing a new selector
// The `visit()` method might get any IPLD data type. This means that it could
// also be an array of nodes. The return value returns the node(s) that are
// the input for the next selector )`node`) and optionally nodes that will be
// traversed later (`later`) (that's the case e.g. for the `SelectArrayAll`
// and `SelectMapAll` selectors). Another field is `callAgain` which indicates
// on whether the selector should be called again on the next iteration. This
// is needed for recursive iterators.

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

//class SelectArray {
//  constructor (selector) {
//    this.position = null
//    this.slice = null
//    if ('position' in selector) {
//      this.position = selector.position
//    }
//    if ('slice' in selector) {
//      this.slice = {}
//      if ('start' in selector.slice) {
//        this.slice.start = selector.slice.start
//      } else {
//        this.slice.start = 0
//      }
//      if ('end' in selector.slice) {
//        this.slice.end = selector.slice.end
//      }
//    }
//  }
//
//  // `node` (`IPLDNode`, required): The IPLD Node the selector is matched on
//  // returns an object with these keys:
//  //  - `callAgain` (boolean): Is always `false`
//  //  - `node` (CID|Node|Array.<Node>): The node(s) to follow next
//  visit (node) {
//    if (Array.isArray(node)) {
//      let returnValue
//      if (this.position !== null) {
//        returnValue = node[this.position]
//      } else if (this.slice !== null) {
//        returnValue = node.slice(this.slice.start, this.slice.end)
//      } else {
//        returnValue = node
//      }
//      return {
//        node: returnValue,
//        callAgain: false
//      }
//    } else {
//      return null
//    }
//  }
//}

class SelectArrayAll {
  constructor (selector) {
    if (selector !== null) {
      throw new Error('Invalid selector: value must be `null`')
    }
  }

  // `nodes` (`IPLDNode`, required): The IPLD Node the selector is matched on
  // returns an object with these keys:
  //  - `callAgain` (boolean): Is always `false`
  //  - `node` (CID|Node): The nodes to follow next
  //  - `later` (Array.<CID>|Array.<Node>, optional): Additional nodes to
  //    follow next
  visit (nodes) {
    if (Array.isArray(nodes) && nodes.length > 0) {
      const result = {
        node: nodes.shift(),
        callAgain: false
      }
      if (nodes.length > 0) {
        result.later = nodes
      }
      return result
    } else {
      return null
    }
  }
}

class SelectRecursive {
  constructor (selector) {
    this.follow = selector.follow
    if ('depthLimit' in selector) {
      this.depthLimit = selector.depthLimit
    } else {
      this.depthLimit = null
    }
  }

  // `node` (`IPLDNode`, required): The IPLD Node the selector is matched on
  // returns an object with these keys:
  //  - `callAgain` (boolean): whether this selector should be called again
  //    if it matched
  //  - `node` (CID|Node|Array.<Node>): The node(s) to follow next
  async visit (node) {
    debugger
    // The stack of nodes that we still need to traverse. It's an array of
    // object with the following shape:
    //  - `selectors`: The selectors that should be applied to the nodes
    //  - `nodes`: The CIDs of the nodes that should be traversed
    //  - `depthLimit`: If the depthLimit reaches zero, we will stop traversing
    //    those nodes
    let stack = []

    // Create a copy of the depth limit
    let depthLimit = this.depthLimit

    // TODO vmx 2019-02-15: Is the copying of the selectors needed?
    let selectors = this.follow.slice()
    while (node && (depthLimit === null || depthLimit > 0)) {
      // One call to selectNonRecursive is a single recursion step
      const result = await nonRecursiveSelect(node, selectors)

      // Push the siblings on the stack of nodes that should get visited
      for (const item of result.stack) {
        // Add the current depth limit so that the recursion can be stopped
        // accordingly
        item.depthLimit = depthLimit
        stack.push(item)
      }

      // If a depth limit is given, count it down for every iteration
      if (depthLimit !== null) {
        depthLimit--
      }

      // There is a node that will be used for the next iteration. We also
      // haven't hit the recursion limit yet.
      if ('node' in result && (depthLimit === null || depthLimit > 0 )) {
        node = result.node
        // It's a new iteration, so we also need to reset the selctors
        selectors = this.follow.slice()
      } else {
      // No matching node found
        // There might be nodes that should get visited
        if (stack.length > 0) {
          // Prepare for the next iteration
          const siblings = stack.pop()
          node = siblings.nodes.shift()
          selectors = siblings.selectors
          depthLimit = siblings.depthLimit
          // There are still nodes left to traverse in the future, hence push
          // them back on the stack
          if (siblings.nodes.length > 0) {
            stack.push({
              nodes: siblings.nodes,
              selectors: siblings.selectors.slice(),
              depthLimit: siblings.depthLimit
            })
          }
          // Let's continue with the sibling
          continue
        } else { // Nothing else to do, we are finished with the traversal
          return
        }
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
    case 'selectArrayAll':
      return new SelectArrayAll(selector[keys[0]])
    case 'selectRecursive':
      return new SelectRecursive(selector[keys[0]])
    default:
      throw new Error(`Unknown selector: "${keys[0]}"`)
  }
}


const getBlock = async (cid) => {
  console.log(`loading block with cid: ${cid}`)
  return promisify(blockService.get.bind(blockService))(cid)
}

// TODO vmx 2019-02-12: Support more than just CBOR
const deserialize = async (block) => {
  return promisify(ipldDagCbor.util.deserialize)(block.data)
}

// Returns either if the selector was fully applied or if there's no matching
// node anymore
const nonRecursiveSelect = async (node, selectors) => {
  // The stack of nodes that we still need to traverse. It's an array of
  // object with the following shape:
  //  - `selectors`: The selectors that should be applied to the nodes
  //  - `nodes`: The CIDs of the nodes that should be traversed
  const stack = []
  do {
    const selector = buildSelector(selectors.shift())
    const result = selector.visit(node)

    // The selector didn't match the current node
    if (result === null) {
      // return the siblings that still need to get traversed
      return {
        stack
      }
    } else {
    // We have a match
      // There is sibling nodes to be traversed later
      if ('later' in result) {
       // Push the nodes on top of the stack for future traversal
       stack.push({
         nodes: result.later,
         selectors: selectors.slice()
       })
      }

      // The next node to traverse is a CID, so let's keep traversing deeper
      //if (CID.isCID(node) || CID.isCID(result.node)) {
      if (CID.isCID(result.node)) {
        // Get Node and save it as current node
        const block = await getBlock(result.node)
        // Error if you node is not locally available
        if (block === null) {
          throw new Error("Block doesn't exist")
        }
        node = await deserialize(block)
      } else {
      // It's just a path within the current node. It might be an array
      // of nodes.
        node = result.node
      }
    }
  } while (selectors.length > 0)

  // The selector fully matched, but we might be in the middle of a node that
  // we want to traverse in sub-sequent calls. Hence return the current node
  // fragment we are currently at
  return {
    node,
    stack
  }
}


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

const processSelector = async (selector) => {
  // Every selector has a single root field
  if (Object.keys(selector).length !== 1) {
    throw new Error(
      `The selector is invalid, it needs to have a single root field`
    )
  }

  const [selectorType] = Object.keys(selector)
  switch (selectorType) {
    case 'cidRootedSelector':
      const {root, selectors} = selector.cidRootedSelector
      const rootBlock = await getBlock(new CID(root))
      return select(rootBlock, selectors)
      break
    default:
      throw new Error(`Unknown selector type: "${selectorType}"`)
  }
}

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
  blockService = await utils.openBlockService(ipfsPath)

  const result = await processSelector(selector)

  let next
  for (next = await result.next(); !next.done; next = await result.next()) {
   const block = next.value
   console.log(block.cid.toBaseEncodedString())
  }
  if (next.value !== undefined) {
    console.log(`The selector wasn't fully resolved:`, next.value)
  }
}

if (require.main === module) {
  main(process.argv).catch((error) => {
    console.error(error)
  })
}

