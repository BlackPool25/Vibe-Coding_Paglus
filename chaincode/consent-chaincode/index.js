'use strict';

/**
 * Chaincode Entry Point
 * 
 * Reference: https://hyperledger-fabric.readthedocs.io/en/latest/chaincode4ade.html
 * Reference: https://github.com/hyperledger/fabric-samples/blob/main/asset-transfer-basic/chaincode-javascript/index.js
 */

const ConsentContract = require('./lib/contract');

module.exports.ConsentContract = ConsentContract;
module.exports.contracts = [ConsentContract];
