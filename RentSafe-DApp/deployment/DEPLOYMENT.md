# Deployment details

RentSafe was compiled and deployed with **Remix IDE** to a local **Ganache** blockchain, using **MetaMask** as the deploying wallet. All values below were read from the Remix terminal and from the Ganache node after the run on 16 October 2026.

## Network

| Item | Value |
|---|---|
| Network | Ganache (local Ethereum blockchain), MetaMask network name *Ganache Local* |
| RPC URL | `http://127.0.0.1:7545` |
| Chain ID | `1337` |
| Ganache version | Ganache CLI v7.9.2 (`npx ganache --chain.chainId 1337 --server.port 7545`) |
| Wallet | MetaMask 13.50.0 |
| IDE | Remix IDE 2.6.7 (remix.ethereum.org now redirects to app.remix.live) |

## Compilation

| Item | Value |
|---|---|
| Source file | [`contracts/RentSafe.sol`](../contracts/RentSafe.sol) |
| Compiler | `0.8.19+commit.7dd6d404` |
| EVM version | `paris` (the default for 0.8.19; Ganache does not support the `PUSH0` opcode used by later EVM versions) |
| Optimization | Disabled |
| ABI | [`RentSafe.abi.json`](RentSafe.abi.json) |

## Deployment transaction

| Item | Value |
|---|---|
| Remix environment | *Browser Extension → MetaMask* (shown as *Injected Provider - MetaMask* in older Remix versions) |
| Constructor arguments | `_platformName = "RentSafe Escrow"`, `_minDeposit = 10000000000000000` (0.01 ETH) |
| Deployer (becomes the arbiter) | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| **Contract address** | **`0x5FbDB2315678afecb367f032d93F642f64180aa3`** |
| Transaction hash | `0xf5270195fd0c9ac09631228523b0536b1618b9b7dae2977f5efca0ccbd1f0d37` |
| Block number | `1` |
| Block hash | `0x2716c956d7c60e156ce69502208535de1ef8a5b29870962cd9215fb4c4e994f1` |
| Gas used | `3,319,349` |
| Status | Success (`1 Transaction mined and execution completed`) |

## Accounts used for testing

Only public addresses are listed. No private keys or seed phrases are stored in this repository.

| Role | MetaMask account name | Address |
|---|---|---|
| Arbiter (deployer) | Arbiter | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| Landlord | Landlord | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| Tenant | Tenant | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` |
| Outsider (no role) | Outsider | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` |

## Transaction evidence

### Transactions mined on the chain

Every transaction on the chain, read back from Ganache and decoded with the contract ABI:

| Block | Sent from | Call | Value | Result | Gas used | Transaction hash |
|---|---|---|---|---|---|---|
| 1 | Arbiter | deploy `RentSafe("RentSafe Escrow", 0.01 ETH)` (Remix) | 0 | ✅ Success | 3,319,349 | `0xf5270195fd0c9ac09631228523b0536b1618b9b7dae2977f5efca0ccbd1f0d37` |
| 2 | Arbiter | `setMinDeposit(0)` (Remix, forced send) | 0 | ❌ Failed (status 0): invalid input | 21,983 | `0xee98ed4ee94783d3d3eacddf316c061d7e36d31581a83280a688d9d980948293` |
| 3 | Landlord | `createAgreement(Tenant, 1 ETH, lease end, "Flat 203, Green Residency, Manipal")` | 0 | ✅ Success | 343,867 | `0xf5f48a8fb5f95cf3df67cce15bbabc35454607da4eed7a5ed0e26d0343387a5e` |
| 4 | Tenant | `payDeposit(1)` | 1 ETH | ✅ Success | 74,947 | `0xcfccbe7a4865739422bd55791149c2b82a13278104ae2641ce578b4fc511fa3d` |
| 5 | Outsider | `payDeposit(1)` (DApp, forced send) | 1 ETH | ❌ Failed (status 0): *Only the tenant can perform this action* | 26,354 | `0x85ca170ce25b8220c6d33e0dae93405bbc3a67e4212309475d8aab3fb1ccc4d4` |
| 6 | Landlord | `proposeRefund(1, 0.2 ETH, "Broken window")` | 0 | ✅ Success | 84,552 | `0x4fbf91f22d097c33827d9d76fdaf3da84c88d667b84d0865a5ab2183a0c73bd7` |
| 7 | Tenant | `raiseDispute(1)` | 0 | ✅ Success | 37,488 | `0xf863ea3f07ce6b231900f8a50a6c9f220ba8a641f1ad2dcd73609884ab5e06cc` |
| 8 | Arbiter | `resolveDispute(1, 0.9 ETH)` | 0 | ✅ Success | 108,303 | `0x11c866550557d12fdbd8d9a63c5c38c47dc1c2bbe1eca2e467497cebf5221362` |
| 9 | Tenant | `withdraw()`: received 0.9 ETH | 0 | ✅ Success | 30,389 | `0xee474ef9baebff8f8ba4021c970fef82538f99ef72de7650c2815414a6b96878` |
| 10 | Landlord | `withdraw()`: received 0.1 ETH | 0 | ✅ Success | 30,389 | `0x3d0cfe5d87ba7c9af7415ccdf057f6569e14fad45fb5b9d62dd418e162e76349` |

Final state: agreement #1 is **Settled** (tenant 0.9 ETH, landlord 0.1 ETH), both parties have withdrawn, and the contract balance is 0 ETH.

### Rejected before mining

These transactions were stopped by the pre-flight check, because the contract reverted during simulation. They never reached the chain, so they have no transaction hash. The DApp's transaction log showed the following:

| Sent from | Action in the DApp | Revert reason shown |
|---|---|---|
| Landlord | Create agreement with deposit 0.001 ETH | `Deposit is below the minimum` |
| Landlord | Propose refund before the deposit was paid | `Deposit is not held for this agreement` |
| Tenant | Pay deposit with 0.5 ETH | `Sent amount must equal the deposit` |
| Landlord | Propose refund before the lease ended | `Lease has not ended yet` |
| Outsider | Pay deposit | `Only the tenant can perform this action` |
| Outsider | Raise dispute | `Only the landlord or tenant can raise a dispute` |
| Landlord | Resolve dispute | `Only the arbiter can perform this action` |
| Arbiter | Resolve dispute with 1.5 ETH refund | `Refund cannot exceed the deposit` |
| Tenant | Withdraw a second time | `Nothing to withdraw` |
