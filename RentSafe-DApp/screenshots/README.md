# Screenshots

Evidence captured while compiling, deploying and testing RentSafe with Remix IDE, MetaMask and Ganache (chain ID 1337). Section 10 of the main [README](../README.md) shows them with captions.

| File | Shows |
|---|---|
| `01-compilation.png` | Remix **Solidity Compiler**: compiler `0.8.19+commit.7dd6d404`, `RentSafe (RentSafe.sol)`, green tick |
| `02-deployment.png` | Remix terminal: deployment mined in block 1, contract address `0x5FbD…0aa3`, 3,319,349 gas, decoded constructor input |
| `02b-deployment-metamask-confirm.png` | MetaMask *Deploy a contract* confirmation on *Ganache Local*, requested by Remix |
| `03-metamask-connection.png` | The DApp connected through MetaMask (*Ganache · 1337*, Landlord account) |
| `03b-metamask-connect-request.png` | MetaMask connection request from `localhost` |
| `04-successful-transaction.png` | DApp transaction log: *Pay deposit (#1)* confirmed in block 4, with hash and gas |
| `04b-metamask-confirm-payment.png` | MetaMask confirmation of the 1 ETH deposit |
| `05-failed-transaction.png` | DApp transaction log: unauthorised and invalid attempts rejected by the contract, plus a forced send mined with status 0 |
| `05b-metamask-failed-transaction.png` | MetaMask activity for the Outsider: *Interaction failed* |
| `06-blockchain-data-ui.png` | Full DApp page: contract statistics, the settled agreement, the agreements table, the transaction log and the event history |
| `08-remix-failed-transaction.png` | Remix: `setMinDeposit(0)` from the Arbiter, *0 Transaction mined but execution failed* |

No private keys, seed phrases or passwords appear in any screenshot.
