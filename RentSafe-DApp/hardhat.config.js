require("@nomicfoundation/hardhat-toolbox");

/**
 * Hardhat is used only to run the automated test suite (npm test).
 * Compilation and deployment for the assignment are done in Remix IDE with Ganache.
 * Solidity 0.8.19 is used because it does not emit the PUSH0 opcode, which
 * Ganache does not support.
 */
module.exports = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: { enabled: false, runs: 200 },
    },
  },
};
