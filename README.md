# RentSafe DApp – Blockchain Technology (CSE4444) Assignment 2

RentSafe is a decentralized escrow for rental security deposits. A tenant's deposit is locked in an Ethereum smart contract. At the end of the lease the landlord proposes the refund on-chain, the tenant accepts it or raises a dispute, and a neutral arbiter settles disputes.

This guide takes you from a fresh clone to a running DApp on a local Ganache blockchain. For the contract design, test cases, deployment evidence and screenshots, see the full project report in [`RentSafe-DApp/README.md`](RentSafe-DApp/README.md).

## Repository contents

| Path | What it is |
|---|---|
| [`RentSafe-DApp/`](RentSafe-DApp/) | The DApp: Solidity contract, HTML/CSS/JS frontend, automated tests |
| [`RentSafe-DApp/README.md`](RentSafe-DApp/README.md) | Full project report |

## Prerequisites

| Tool | Used for |
|---|---|
| [Git](https://git-scm.com/) | Cloning the repository |
| [Node.js](https://nodejs.org/) 18 or later (includes npm) | Running the tests and serving the frontend |
| [MetaMask](https://metamask.io/download/) browser extension (Chrome, Edge, Brave or Firefox) | Signing transactions |
| [Ganache](https://archive.trufflesuite.com/ganache/) desktop app, or the CLI through `npx ganache` | Local Ethereum blockchain |
| [Remix IDE](https://remix.ethereum.org) (runs in the browser, no install) | Compiling and deploying the contract |

## Setup

### 1. Clone and install dependencies

```bash
git clone https://github.com/DEREK266/BLOCKCHAIN.git
cd BLOCKCHAIN/RentSafe-DApp
npm install
```

All remaining commands are run from the `RentSafe-DApp` folder.

### 2. Run the automated tests (optional)

The tests run on Hardhat's built-in network, so Ganache and MetaMask are not needed for this step.

```bash
npm test
```

Expected result: `42 passing`.

### 3. Start Ganache

Use either option. Both run the chain at `http://127.0.0.1:7545` with chain ID `1337`.

- **Ganache desktop app:** open Ganache and click **Quickstart (Ethereum)**.
- **Ganache CLI:** run this in a separate terminal and leave it running:
  ```bash
  npx ganache --chain.chainId 1337 --server.port 7545
  ```

Ganache creates 10 accounts with 100 ETH each. The desktop app shows each account's private key behind the key icon. The CLI prints the private keys when it starts.

### 4. Set up MetaMask

1. Add the Ganache network: MetaMask → network selector → **Add a custom network**, then enter:

   | Field | Value |
   |---|---|
   | Network name | `Ganache Local` |
   | RPC URL | `http://127.0.0.1:7545` |
   | Chain ID | `1337` |
   | Currency symbol | `ETH` |

2. Import four Ganache accounts: MetaMask account menu → **Add account → Import account**, then paste a private key from Ganache. Rename them as follows:

   | Ganache account | MetaMask name |
   |---|---|
   | 0 | Arbiter |
   | 1 | Landlord |
   | 2 | Tenant |
   | 3 | Outsider |

> These are throw-away Ganache test keys. Never commit them to this repository, and never use a real wallet for testing.

### 5. Compile and deploy the contract in Remix

1. Open [Remix IDE](https://remix.ethereum.org). Create `contracts/RentSafe.sol` and paste in the contents of [`RentSafe-DApp/contracts/RentSafe.sol`](RentSafe-DApp/contracts/RentSafe.sol).
2. In the **Solidity Compiler** tab, select compiler **`0.8.19`** and click **Compile RentSafe.sol**.
   If you use a newer 0.8.x compiler, open *Advanced Configurations* and set **EVM version** to `paris`. Ganache cannot run the `PUSH0` opcode that newer EVM versions use.
3. In the **Deploy & Run Transactions** tab:
   - **Environment:** *Browser Extension → MetaMask* (called *Injected Provider - MetaMask* in older Remix versions). Approve the connection with the **Arbiter** account selected.
   - **Contract:** `RentSafe`
   - **Constructor arguments:** `_platformName` = `RentSafe Escrow`, `_minDeposit` = `10000000000000000` (0.01 ETH in wei)
4. Click **Deploy**, confirm in MetaMask, then copy the contract address from **Deployed Contracts**.

### 6. Point the frontend at your contract

Open [`RentSafe-DApp/frontend/config.js`](RentSafe-DApp/frontend/config.js) and replace `CONTRACT_ADDRESS` with the address you copied:

```js
CONTRACT_ADDRESS: "0x...your deployed address...",
CHAIN_ID: 1337,
```

The address already in the file only exists on the Ganache chain where the project was originally tested. Every new Ganache workspace needs a fresh deployment and an updated address.

### 7. Run the frontend

```bash
npm start
```

Open <http://localhost:8080> in the browser that has MetaMask. Switch MetaMask to **Ganache Local**, click **Connect MetaMask**, and select all four test accounts.

The frontend must be served over HTTP. MetaMask does not connect to pages opened directly from disk (`file://`), so double-clicking `index.html` will not work. If you prefer not to use npm, either of these also works:

```bash
npx http-server frontend -p 8080
python -m http.server 8080 --directory frontend
```

## Using the DApp

To act as a different person, switch accounts in MetaMask and the page updates automatically. A typical run:

1. **Landlord** creates an agreement for the Tenant's address (for example, a 1 ETH deposit with the lease ending in 2 minutes).
2. **Tenant** pays the deposit.
3. After the lease end, **Landlord** proposes a refund with a reason for any deduction.
4. **Tenant** accepts it, or raises a dispute that the **Arbiter** resolves.
5. Landlord and Tenant each click **Withdraw my ETH**.

The full walkthrough, including how to test failed and unauthorised transactions, is in [section 7 of the project report](RentSafe-DApp/README.md#7-connecting-metamask-and-interacting-with-the-contract).

## Troubleshooting

| Problem | Fix |
|---|---|
| *invalid opcode* when deploying | Compile with Solidity `0.8.19`, or set EVM version to `paris` in Remix |
| DApp says *No contract found at …* | `CONTRACT_ADDRESS` in `config.js` is wrong, MetaMask is on another network, or Ganache was restarted. Redeploy and update `config.js` |
| DApp says *MetaMask is on chain X* | Switch MetaMask to *Ganache Local* (chain ID 1337) |
| *Nonce too high*, or transactions stuck after restarting Ganache | MetaMask → *Settings → Advanced → Clear activity tab data* |
| MetaMask does not pop up | Open the DApp at `http://localhost:8080`, not as a file |
| *Lease has not ended yet* | Wait until the lease end time has passed, then try again |

More fixes are listed in [section 12 of the project report](RentSafe-DApp/README.md#12-troubleshooting).
