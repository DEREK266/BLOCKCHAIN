// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title  RentSafe - Rental Security Deposit Escrow
 * @notice Tenants often lose part or all of their security deposit because the
 *         landlord holds the money and decides alone how much to give back.
 *         RentSafe keeps the deposit in this contract instead of with the landlord:
 *
 *           1. The landlord creates an agreement (tenant, deposit, lease end, property).
 *           2. The tenant pays the exact deposit into escrow.
 *           3. After the lease ends, the landlord proposes a refund. Any deduction
 *              must come with a written reason.
 *           4. The tenant accepts the proposal, or either party raises a dispute.
 *           5. A neutral arbiter (the account that deployed the contract) settles
 *              disputes by deciding how much of the deposit the tenant gets back.
 *
 *         Settled amounts are credited to each party and claimed with withdraw()
 *         (pull-payment pattern), so a party that cannot receive ETH cannot block
 *         the other party's money.
 */
contract RentSafe {
    // ------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------

    enum Status {
        Created,        // 0 - created by the landlord, deposit not paid yet
        Funded,         // 1 - tenant's deposit is held in escrow
        RefundProposed, // 2 - landlord has proposed how much to return
        Disputed,       // 3 - escalated to the arbiter
        Settled,        // 4 - deposit split and credited to the parties
        Cancelled       // 5 - cancelled by the landlord before payment
    }

    struct Agreement {
        uint256 id;
        address landlord;
        address tenant;
        uint256 deposit;          // in wei
        uint256 leaseEnd;         // unix timestamp (seconds)
        uint256 createdAt;        // unix timestamp (seconds)
        string propertyDetails;
        uint256 deduction;        // amount (wei) the landlord proposed to keep
        string deductionReason;
        uint256 tenantRefund;     // amount (wei) returned to the tenant on settlement
        Status status;
    }

    // ------------------------------------------------------------------
    // State variables
    // ------------------------------------------------------------------

    uint256 public constant MAX_TEXT_LENGTH = 200;

    address public immutable arbiter;
    string public platformName;
    uint256 public minDeposit;
    uint256 public agreementCount;
    uint256 public totalInEscrow;

    mapping(uint256 => Agreement) private agreements;
    mapping(address => uint256[]) private agreementIdsOf;
    mapping(address => uint256) public pendingWithdrawals;

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    event AgreementCreated(
        uint256 indexed id,
        address indexed landlord,
        address indexed tenant,
        uint256 deposit,
        uint256 leaseEnd,
        string propertyDetails
    );
    event DepositPaid(uint256 indexed id, address indexed tenant, uint256 amount);
    event AgreementCancelled(uint256 indexed id, address indexed landlord);
    event RefundProposed(uint256 indexed id, uint256 deduction, string reason);
    event DisputeRaised(uint256 indexed id, address indexed raisedBy);
    event AgreementSettled(
        uint256 indexed id,
        uint256 tenantRefund,
        uint256 landlordShare,
        bool resolvedByArbiter
    );
    event Withdrawn(address indexed account, uint256 amount);
    event MinDepositUpdated(uint256 oldMinDeposit, uint256 newMinDeposit);

    // ------------------------------------------------------------------
    // Modifiers
    // ------------------------------------------------------------------

    modifier onlyArbiter() {
        require(msg.sender == arbiter, "Only the arbiter can perform this action");
        _;
    }

    modifier agreementExists(uint256 _id) {
        require(_id > 0 && _id <= agreementCount, "Agreement does not exist");
        _;
    }

    modifier onlyLandlord(uint256 _id) {
        require(msg.sender == agreements[_id].landlord, "Only the landlord can perform this action");
        _;
    }

    modifier onlyTenant(uint256 _id) {
        require(msg.sender == agreements[_id].tenant, "Only the tenant can perform this action");
        _;
    }

    // ------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------

    /**
     * @param _platformName Display name of this escrow service.
     * @param _minDeposit   Smallest deposit (in wei) an agreement may require.
     */
    constructor(string memory _platformName, uint256 _minDeposit) {
        require(bytes(_platformName).length > 0, "Platform name is required");
        require(_minDeposit > 0, "Minimum deposit must be greater than zero");

        arbiter = msg.sender;
        platformName = _platformName;
        minDeposit = _minDeposit;
    }

    // ------------------------------------------------------------------
    // Landlord / tenant actions
    // ------------------------------------------------------------------

    /// @notice Landlord creates a new rental agreement for a tenant.
    function createAgreement(
        address _tenant,
        uint256 _deposit,
        uint256 _leaseEnd,
        string calldata _propertyDetails
    ) external returns (uint256 id) {
        require(msg.sender != arbiter && _tenant != arbiter, "Arbiter cannot be a party to an agreement");
        require(_tenant != address(0), "Tenant address cannot be zero");
        require(_tenant != msg.sender, "Landlord and tenant must be different");
        require(_deposit >= minDeposit, "Deposit is below the minimum");
        require(_leaseEnd > block.timestamp, "Lease end must be in the future");
        require(
            bytes(_propertyDetails).length > 0 && bytes(_propertyDetails).length <= MAX_TEXT_LENGTH,
            "Property details must be 1-200 characters"
        );

        id = ++agreementCount;
        Agreement storage a = agreements[id];
        a.id = id;
        a.landlord = msg.sender;
        a.tenant = _tenant;
        a.deposit = _deposit;
        a.leaseEnd = _leaseEnd;
        a.createdAt = block.timestamp;
        a.propertyDetails = _propertyDetails;
        a.status = Status.Created;

        agreementIdsOf[msg.sender].push(id);
        agreementIdsOf[_tenant].push(id);

        emit AgreementCreated(id, msg.sender, _tenant, _deposit, _leaseEnd, _propertyDetails);
    }

    /// @notice Tenant pays the exact deposit into escrow.
    function payDeposit(uint256 _id) external payable agreementExists(_id) onlyTenant(_id) {
        Agreement storage a = agreements[_id];
        require(a.status == Status.Created, "Deposit already paid or agreement closed");
        require(msg.value == a.deposit, "Sent amount must equal the deposit");

        a.status = Status.Funded;
        totalInEscrow += msg.value;

        emit DepositPaid(_id, msg.sender, msg.value);
    }

    /// @notice Landlord cancels an agreement whose deposit has not been paid.
    function cancelAgreement(uint256 _id) external agreementExists(_id) onlyLandlord(_id) {
        Agreement storage a = agreements[_id];
        require(a.status == Status.Created, "Only unpaid agreements can be cancelled");

        a.status = Status.Cancelled;

        emit AgreementCancelled(_id, msg.sender);
    }

    /// @notice After the lease ends, the landlord proposes how much of the deposit to keep.
    function proposeRefund(uint256 _id, uint256 _deduction, string calldata _reason)
        external
        agreementExists(_id)
        onlyLandlord(_id)
    {
        Agreement storage a = agreements[_id];
        require(a.status == Status.Funded, "Deposit is not held for this agreement");
        require(block.timestamp >= a.leaseEnd, "Lease has not ended yet");
        require(_deduction <= a.deposit, "Deduction cannot exceed the deposit");
        require(bytes(_reason).length <= MAX_TEXT_LENGTH, "Reason must be at most 200 characters");
        if (_deduction > 0) {
            require(bytes(_reason).length > 0, "A reason is required for any deduction");
        }

        a.deduction = _deduction;
        a.deductionReason = _reason;
        a.status = Status.RefundProposed;

        emit RefundProposed(_id, _deduction, _reason);
    }

    /// @notice Tenant accepts the landlord's refund proposal.
    function acceptRefund(uint256 _id) external agreementExists(_id) onlyTenant(_id) {
        Agreement storage a = agreements[_id];
        require(a.status == Status.RefundProposed, "There is no refund proposal to accept");

        _settle(a, a.deposit - a.deduction, false);
    }

    /// @notice Landlord or tenant escalates to the arbiter after the lease has ended.
    function raiseDispute(uint256 _id) external agreementExists(_id) {
        Agreement storage a = agreements[_id];
        require(
            msg.sender == a.landlord || msg.sender == a.tenant,
            "Only the landlord or tenant can raise a dispute"
        );
        require(
            a.status == Status.Funded || a.status == Status.RefundProposed,
            "Agreement cannot be disputed in its current state"
        );
        require(block.timestamp >= a.leaseEnd, "Lease has not ended yet");

        a.status = Status.Disputed;

        emit DisputeRaised(_id, msg.sender);
    }

    /// @notice Claim ETH credited to the caller by settled agreements.
    function withdraw() external {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");

        pendingWithdrawals[msg.sender] = 0;
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "ETH transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Arbiter actions
    // ------------------------------------------------------------------

    /// @notice Arbiter decides how much of a disputed deposit goes back to the tenant.
    function resolveDispute(uint256 _id, uint256 _tenantRefund)
        external
        onlyArbiter
        agreementExists(_id)
    {
        Agreement storage a = agreements[_id];
        require(a.status == Status.Disputed, "Agreement is not under dispute");
        require(_tenantRefund <= a.deposit, "Refund cannot exceed the deposit");

        _settle(a, _tenantRefund, true);
    }

    /// @notice Arbiter changes the minimum deposit for new agreements.
    function setMinDeposit(uint256 _minDeposit) external onlyArbiter {
        require(_minDeposit > 0, "Minimum deposit must be greater than zero");

        emit MinDepositUpdated(minDeposit, _minDeposit);
        minDeposit = _minDeposit;
    }

    // ------------------------------------------------------------------
    // Read-only functions
    // ------------------------------------------------------------------

    function getAgreement(uint256 _id) external view agreementExists(_id) returns (Agreement memory) {
        return agreements[_id];
    }

    function getAgreementIdsOf(address _user) external view returns (uint256[] memory) {
        return agreementIdsOf[_user];
    }

    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    function _settle(Agreement storage a, uint256 _tenantRefund, bool _byArbiter) private {
        uint256 landlordShare = a.deposit - _tenantRefund;

        a.tenantRefund = _tenantRefund;
        a.status = Status.Settled;
        totalInEscrow -= a.deposit;
        pendingWithdrawals[a.tenant] += _tenantRefund;
        pendingWithdrawals[a.landlord] += landlordShare;

        emit AgreementSettled(a.id, _tenantRefund, landlordShare, _byArbiter);
    }
}
