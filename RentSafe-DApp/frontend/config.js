// ---------------------------------------------------------------------------
// RentSafe frontend configuration
// Update these values after deploying contracts/RentSafe.sol from Remix.
// ---------------------------------------------------------------------------
const CONFIG = {
  // Address shown under "Deployed Contracts" in Remix after deployment.
  CONTRACT_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3",

  // Chain ID of the network the contract is deployed on:
  //   1337     = Ganache (GUI on port 7545, or ganache CLI on port 8545)
  //   11155111 = Sepolia test network
  CHAIN_ID: 1337,

  // Block number that contains the deployment transaction.
  // Event history is read from this block onwards (keep 0 for Ganache).
  DEPLOYMENT_BLOCK: 0,

  // Block explorer used for transaction links. Leave empty for Ganache;
  // use "https://sepolia.etherscan.io" for Sepolia.
  EXPLORER_URL: "",
};

// ABI of RentSafe.sol in ethers.js human-readable form.
const RENTSAFE_ABI = [
  "constructor(string _platformName, uint256 _minDeposit)",

  // Read-only
  "function MAX_TEXT_LENGTH() view returns (uint256)",
  "function arbiter() view returns (address)",
  "function platformName() view returns (string)",
  "function minDeposit() view returns (uint256)",
  "function agreementCount() view returns (uint256)",
  "function totalInEscrow() view returns (uint256)",
  "function pendingWithdrawals(address) view returns (uint256)",
  "function getAgreement(uint256 _id) view returns (tuple(uint256 id, address landlord, address tenant, uint256 deposit, uint256 leaseEnd, uint256 createdAt, string propertyDetails, uint256 deduction, string deductionReason, uint256 tenantRefund, uint8 status))",
  "function getAgreementIdsOf(address _user) view returns (uint256[])",
  "function getContractBalance() view returns (uint256)",

  // Transactions
  "function createAgreement(address _tenant, uint256 _deposit, uint256 _leaseEnd, string _propertyDetails) returns (uint256 id)",
  "function payDeposit(uint256 _id) payable",
  "function cancelAgreement(uint256 _id)",
  "function proposeRefund(uint256 _id, uint256 _deduction, string _reason)",
  "function acceptRefund(uint256 _id)",
  "function raiseDispute(uint256 _id)",
  "function withdraw()",
  "function resolveDispute(uint256 _id, uint256 _tenantRefund)",
  "function setMinDeposit(uint256 _minDeposit)",

  // Events
  "event AgreementCreated(uint256 indexed id, address indexed landlord, address indexed tenant, uint256 deposit, uint256 leaseEnd, string propertyDetails)",
  "event DepositPaid(uint256 indexed id, address indexed tenant, uint256 amount)",
  "event AgreementCancelled(uint256 indexed id, address indexed landlord)",
  "event RefundProposed(uint256 indexed id, uint256 deduction, string reason)",
  "event DisputeRaised(uint256 indexed id, address indexed raisedBy)",
  "event AgreementSettled(uint256 indexed id, uint256 tenantRefund, uint256 landlordShare, bool resolvedByArbiter)",
  "event Withdrawn(address indexed account, uint256 amount)",
  "event MinDepositUpdated(uint256 oldMinDeposit, uint256 newMinDeposit)",
];
