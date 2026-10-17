const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const ETH = (v) => ethers.parseEther(v);
const MIN_DEPOSIT = ETH("0.01");
const DEPOSIT = ETH("1");
const PROPERTY = "Flat 203, Green Residency, Manipal";

const Status = { Created: 0, Funded: 1, RefundProposed: 2, Disputed: 3, Settled: 4, Cancelled: 5 };

describe("RentSafe", function () {
  // arbiter deploys the contract; landlord and tenant are separate accounts; outsider has no role
  async function deployFixture() {
    const [arbiter, landlord, tenant, outsider] = await ethers.getSigners();
    const RentSafe = await ethers.getContractFactory("RentSafe");
    const rentSafe = await RentSafe.deploy("RentSafe Escrow", MIN_DEPOSIT);
    const leaseEnd = (await time.latest()) + 30 * 24 * 60 * 60; // 30 days from now
    return { rentSafe, arbiter, landlord, tenant, outsider, leaseEnd };
  }

  async function createdFixture() {
    const f = await deployFixture();
    await f.rentSafe.connect(f.landlord).createAgreement(f.tenant.address, DEPOSIT, f.leaseEnd, PROPERTY);
    return f;
  }

  async function fundedFixture() {
    const f = await createdFixture();
    await f.rentSafe.connect(f.tenant).payDeposit(1, { value: DEPOSIT });
    return f;
  }

  async function leaseEndedFixture() {
    const f = await fundedFixture();
    await time.increaseTo(f.leaseEnd);
    return f;
  }

  async function proposedFixture() {
    const f = await leaseEndedFixture();
    await f.rentSafe.connect(f.landlord).proposeRefund(1, ETH("0.2"), "Broken window");
    return f;
  }

  async function disputedFixture() {
    const f = await proposedFixture();
    await f.rentSafe.connect(f.tenant).raiseDispute(1);
    return f;
  }

  // ------------------------------------------------------------------
  describe("Deployment (constructor)", function () {
    it("D-01 sets the arbiter, platform name and minimum deposit", async function () {
      const { rentSafe, arbiter } = await loadFixture(deployFixture);
      expect(await rentSafe.arbiter()).to.equal(arbiter.address);
      expect(await rentSafe.platformName()).to.equal("RentSafe Escrow");
      expect(await rentSafe.minDeposit()).to.equal(MIN_DEPOSIT);
      expect(await rentSafe.agreementCount()).to.equal(0);
    });

    it("D-02 rejects an empty platform name", async function () {
      const RentSafe = await ethers.getContractFactory("RentSafe");
      await expect(RentSafe.deploy("", MIN_DEPOSIT)).to.be.revertedWith("Platform name is required");
    });

    it("D-03 rejects a zero minimum deposit", async function () {
      const RentSafe = await ethers.getContractFactory("RentSafe");
      await expect(RentSafe.deploy("RentSafe Escrow", 0)).to.be.revertedWith(
        "Minimum deposit must be greater than zero"
      );
    });
  });

  // ------------------------------------------------------------------
  describe("Valid inputs", function () {
    it("V-01 landlord creates an agreement", async function () {
      const { rentSafe, landlord, tenant, leaseEnd } = await loadFixture(deployFixture);
      await expect(rentSafe.connect(landlord).createAgreement(tenant.address, DEPOSIT, leaseEnd, PROPERTY))
        .to.emit(rentSafe, "AgreementCreated")
        .withArgs(1, landlord.address, tenant.address, DEPOSIT, leaseEnd, PROPERTY);

      const a = await rentSafe.getAgreement(1);
      expect(a.landlord).to.equal(landlord.address);
      expect(a.tenant).to.equal(tenant.address);
      expect(a.deposit).to.equal(DEPOSIT);
      expect(a.propertyDetails).to.equal(PROPERTY);
      expect(a.status).to.equal(Status.Created);
      expect(await rentSafe.agreementCount()).to.equal(1);
    });

    it("V-02 tenant pays the exact deposit into escrow", async function () {
      const { rentSafe, tenant } = await loadFixture(createdFixture);
      const tx = rentSafe.connect(tenant).payDeposit(1, { value: DEPOSIT });
      await expect(tx).to.emit(rentSafe, "DepositPaid").withArgs(1, tenant.address, DEPOSIT);
      await expect(tx).to.changeEtherBalances([tenant, rentSafe], [-DEPOSIT, DEPOSIT]);

      expect((await rentSafe.getAgreement(1)).status).to.equal(Status.Funded);
      expect(await rentSafe.totalInEscrow()).to.equal(DEPOSIT);
      expect(await rentSafe.getContractBalance()).to.equal(DEPOSIT);
    });

    it("V-03 landlord cancels an unpaid agreement", async function () {
      const { rentSafe, landlord } = await loadFixture(createdFixture);
      await expect(rentSafe.connect(landlord).cancelAgreement(1))
        .to.emit(rentSafe, "AgreementCancelled")
        .withArgs(1, landlord.address);
      expect((await rentSafe.getAgreement(1)).status).to.equal(Status.Cancelled);
    });

    it("V-04 landlord proposes a refund with a deduction after the lease ends", async function () {
      const { rentSafe, landlord } = await loadFixture(leaseEndedFixture);
      await expect(rentSafe.connect(landlord).proposeRefund(1, ETH("0.2"), "Broken window"))
        .to.emit(rentSafe, "RefundProposed")
        .withArgs(1, ETH("0.2"), "Broken window");

      const a = await rentSafe.getAgreement(1);
      expect(a.status).to.equal(Status.RefundProposed);
      expect(a.deduction).to.equal(ETH("0.2"));
      expect(a.deductionReason).to.equal("Broken window");
    });

    it("V-05 landlord proposes a full refund (zero deduction needs no reason)", async function () {
      const { rentSafe, landlord } = await loadFixture(leaseEndedFixture);
      await expect(rentSafe.connect(landlord).proposeRefund(1, 0, "")).to.emit(rentSafe, "RefundProposed");
    });

    it("V-06 tenant accepts the refund and the split is credited to both parties", async function () {
      const { rentSafe, landlord, tenant } = await loadFixture(proposedFixture);
      await expect(rentSafe.connect(tenant).acceptRefund(1))
        .to.emit(rentSafe, "AgreementSettled")
        .withArgs(1, ETH("0.8"), ETH("0.2"), false);

      const a = await rentSafe.getAgreement(1);
      expect(a.status).to.equal(Status.Settled);
      expect(a.tenantRefund).to.equal(ETH("0.8"));
      expect(await rentSafe.pendingWithdrawals(tenant.address)).to.equal(ETH("0.8"));
      expect(await rentSafe.pendingWithdrawals(landlord.address)).to.equal(ETH("0.2"));
      expect(await rentSafe.totalInEscrow()).to.equal(0);
    });

    it("V-07 tenant and landlord withdraw their credited ETH", async function () {
      const { rentSafe, landlord, tenant } = await loadFixture(proposedFixture);
      await rentSafe.connect(tenant).acceptRefund(1);

      const tx = rentSafe.connect(tenant).withdraw();
      await expect(tx).to.emit(rentSafe, "Withdrawn").withArgs(tenant.address, ETH("0.8"));
      await expect(tx).to.changeEtherBalances([tenant, rentSafe], [ETH("0.8"), -ETH("0.8")]);
      await expect(rentSafe.connect(landlord).withdraw()).to.changeEtherBalances(
        [landlord, rentSafe],
        [ETH("0.2"), -ETH("0.2")]
      );
      expect(await rentSafe.pendingWithdrawals(tenant.address)).to.equal(0);
      expect(await rentSafe.getContractBalance()).to.equal(0);
    });

    it("V-08 tenant raises a dispute against the landlord's proposal", async function () {
      const { rentSafe, tenant } = await loadFixture(proposedFixture);
      await expect(rentSafe.connect(tenant).raiseDispute(1))
        .to.emit(rentSafe, "DisputeRaised")
        .withArgs(1, tenant.address);
      expect((await rentSafe.getAgreement(1)).status).to.equal(Status.Disputed);
    });

    it("V-09 landlord raises a dispute after the lease ends (no proposal yet)", async function () {
      const { rentSafe, landlord } = await loadFixture(leaseEndedFixture);
      await expect(rentSafe.connect(landlord).raiseDispute(1))
        .to.emit(rentSafe, "DisputeRaised")
        .withArgs(1, landlord.address);
    });

    it("V-10 arbiter resolves a dispute and credits the decided split", async function () {
      const { rentSafe, arbiter, landlord, tenant } = await loadFixture(disputedFixture);
      await expect(rentSafe.connect(arbiter).resolveDispute(1, ETH("0.9")))
        .to.emit(rentSafe, "AgreementSettled")
        .withArgs(1, ETH("0.9"), ETH("0.1"), true);
      expect(await rentSafe.pendingWithdrawals(tenant.address)).to.equal(ETH("0.9"));
      expect(await rentSafe.pendingWithdrawals(landlord.address)).to.equal(ETH("0.1"));
      expect((await rentSafe.getAgreement(1)).status).to.equal(Status.Settled);
    });

    it("V-11 arbiter updates the minimum deposit", async function () {
      const { rentSafe, arbiter } = await loadFixture(deployFixture);
      await expect(rentSafe.connect(arbiter).setMinDeposit(ETH("0.05")))
        .to.emit(rentSafe, "MinDepositUpdated")
        .withArgs(MIN_DEPOSIT, ETH("0.05"));
      expect(await rentSafe.minDeposit()).to.equal(ETH("0.05"));
    });

    it("V-12 agreement IDs are listed for both landlord and tenant", async function () {
      const { rentSafe, landlord, tenant, outsider, leaseEnd } = await loadFixture(createdFixture);
      await rentSafe.connect(landlord).createAgreement(outsider.address, DEPOSIT, leaseEnd, "Shop 4, Main Road");
      expect(await rentSafe.getAgreementIdsOf(landlord.address)).to.deep.equal([1n, 2n]);
      expect(await rentSafe.getAgreementIdsOf(tenant.address)).to.deep.equal([1n]);
      expect(await rentSafe.getAgreementIdsOf(outsider.address)).to.deep.equal([2n]);
    });
  });

  // ------------------------------------------------------------------
  describe("Invalid inputs", function () {
    it("I-01 rejects the zero address as tenant", async function () {
      const { rentSafe, landlord, leaseEnd } = await loadFixture(deployFixture);
      await expect(
        rentSafe.connect(landlord).createAgreement(ethers.ZeroAddress, DEPOSIT, leaseEnd, PROPERTY)
      ).to.be.revertedWith("Tenant address cannot be zero");
    });

    it("I-02 rejects the landlord as their own tenant", async function () {
      const { rentSafe, landlord, leaseEnd } = await loadFixture(deployFixture);
      await expect(
        rentSafe.connect(landlord).createAgreement(landlord.address, DEPOSIT, leaseEnd, PROPERTY)
      ).to.be.revertedWith("Landlord and tenant must be different");
    });

    it("I-03 rejects a deposit below the minimum", async function () {
      const { rentSafe, landlord, tenant, leaseEnd } = await loadFixture(deployFixture);
      await expect(
        rentSafe.connect(landlord).createAgreement(tenant.address, ETH("0.001"), leaseEnd, PROPERTY)
      ).to.be.revertedWith("Deposit is below the minimum");
    });

    it("I-04 rejects a lease end date in the past", async function () {
      const { rentSafe, landlord, tenant } = await loadFixture(deployFixture);
      const past = (await time.latest()) - 60;
      await expect(
        rentSafe.connect(landlord).createAgreement(tenant.address, DEPOSIT, past, PROPERTY)
      ).to.be.revertedWith("Lease end must be in the future");
    });

    it("I-05 rejects empty or over-long property details", async function () {
      const { rentSafe, landlord, tenant, leaseEnd } = await loadFixture(deployFixture);
      await expect(
        rentSafe.connect(landlord).createAgreement(tenant.address, DEPOSIT, leaseEnd, "")
      ).to.be.revertedWith("Property details must be 1-200 characters");
      await expect(
        rentSafe.connect(landlord).createAgreement(tenant.address, DEPOSIT, leaseEnd, "x".repeat(201))
      ).to.be.revertedWith("Property details must be 1-200 characters");
    });

    it("I-06 rejects a deposit payment of the wrong amount", async function () {
      const { rentSafe, tenant } = await loadFixture(createdFixture);
      await expect(rentSafe.connect(tenant).payDeposit(1, { value: ETH("0.5") })).to.be.revertedWith(
        "Sent amount must equal the deposit"
      );
    });

    it("I-07 rejects paying the deposit twice", async function () {
      const { rentSafe, tenant } = await loadFixture(fundedFixture);
      await expect(rentSafe.connect(tenant).payDeposit(1, { value: DEPOSIT })).to.be.revertedWith(
        "Deposit already paid or agreement closed"
      );
    });

    it("I-08 rejects agreement IDs that do not exist", async function () {
      const { rentSafe, tenant } = await loadFixture(createdFixture);
      await expect(rentSafe.getAgreement(0)).to.be.revertedWith("Agreement does not exist");
      await expect(rentSafe.getAgreement(99)).to.be.revertedWith("Agreement does not exist");
      await expect(rentSafe.connect(tenant).payDeposit(99, { value: DEPOSIT })).to.be.revertedWith(
        "Agreement does not exist"
      );
    });

    it("I-09 rejects cancelling an agreement that is already funded", async function () {
      const { rentSafe, landlord } = await loadFixture(fundedFixture);
      await expect(rentSafe.connect(landlord).cancelAgreement(1)).to.be.revertedWith(
        "Only unpaid agreements can be cancelled"
      );
    });

    it("I-10 rejects a refund proposal before the lease ends", async function () {
      const { rentSafe, landlord } = await loadFixture(fundedFixture);
      await expect(rentSafe.connect(landlord).proposeRefund(1, 0, "")).to.be.revertedWith(
        "Lease has not ended yet"
      );
    });

    it("I-11 rejects a deduction larger than the deposit", async function () {
      const { rentSafe, landlord } = await loadFixture(leaseEndedFixture);
      await expect(rentSafe.connect(landlord).proposeRefund(1, ETH("2"), "Repainting")).to.be.revertedWith(
        "Deduction cannot exceed the deposit"
      );
    });

    it("I-12 rejects a deduction without a reason", async function () {
      const { rentSafe, landlord } = await loadFixture(leaseEndedFixture);
      await expect(rentSafe.connect(landlord).proposeRefund(1, ETH("0.1"), "")).to.be.revertedWith(
        "A reason is required for any deduction"
      );
    });

    it("I-13 rejects accepting a refund when none was proposed", async function () {
      const { rentSafe, tenant } = await loadFixture(leaseEndedFixture);
      await expect(rentSafe.connect(tenant).acceptRefund(1)).to.be.revertedWith(
        "There is no refund proposal to accept"
      );
    });

    it("I-14 rejects a dispute before the lease ends", async function () {
      const { rentSafe, tenant } = await loadFixture(fundedFixture);
      await expect(rentSafe.connect(tenant).raiseDispute(1)).to.be.revertedWith("Lease has not ended yet");
    });

    it("I-15 rejects resolving with a refund larger than the deposit", async function () {
      const { rentSafe, arbiter } = await loadFixture(disputedFixture);
      await expect(rentSafe.connect(arbiter).resolveDispute(1, ETH("1.5"))).to.be.revertedWith(
        "Refund cannot exceed the deposit"
      );
    });

    it("I-16 rejects resolving an agreement that is not disputed", async function () {
      const { rentSafe, arbiter } = await loadFixture(proposedFixture);
      await expect(rentSafe.connect(arbiter).resolveDispute(1, DEPOSIT)).to.be.revertedWith(
        "Agreement is not under dispute"
      );
    });

    it("I-17 rejects a withdrawal when nothing is owed", async function () {
      const { rentSafe, tenant } = await loadFixture(fundedFixture);
      await expect(rentSafe.connect(tenant).withdraw()).to.be.revertedWith("Nothing to withdraw");
    });

    it("I-18 rejects setting the minimum deposit to zero", async function () {
      const { rentSafe, arbiter } = await loadFixture(deployFixture);
      await expect(rentSafe.connect(arbiter).setMinDeposit(0)).to.be.revertedWith(
        "Minimum deposit must be greater than zero"
      );
    });

    it("I-19 rejects plain ETH transfers sent directly to the contract", async function () {
      const { rentSafe, outsider } = await loadFixture(deployFixture);
      await expect(outsider.sendTransaction({ to: await rentSafe.getAddress(), value: DEPOSIT })).to.be.reverted;
    });
  });

  // ------------------------------------------------------------------
  describe("Unauthorised inputs", function () {
    it("U-01 an outsider cannot pay someone else's deposit", async function () {
      const { rentSafe, outsider } = await loadFixture(createdFixture);
      await expect(rentSafe.connect(outsider).payDeposit(1, { value: DEPOSIT })).to.be.revertedWith(
        "Only the tenant can perform this action"
      );
    });

    it("U-02 the tenant cannot cancel the agreement", async function () {
      const { rentSafe, tenant } = await loadFixture(createdFixture);
      await expect(rentSafe.connect(tenant).cancelAgreement(1)).to.be.revertedWith(
        "Only the landlord can perform this action"
      );
    });

    it("U-03 the tenant cannot propose the refund", async function () {
      const { rentSafe, tenant } = await loadFixture(leaseEndedFixture);
      await expect(rentSafe.connect(tenant).proposeRefund(1, 0, "")).to.be.revertedWith(
        "Only the landlord can perform this action"
      );
    });

    it("U-04 the landlord cannot accept the refund on the tenant's behalf", async function () {
      const { rentSafe, landlord } = await loadFixture(proposedFixture);
      await expect(rentSafe.connect(landlord).acceptRefund(1)).to.be.revertedWith(
        "Only the tenant can perform this action"
      );
    });

    it("U-05 an outsider cannot raise a dispute", async function () {
      const { rentSafe, outsider } = await loadFixture(proposedFixture);
      await expect(rentSafe.connect(outsider).raiseDispute(1)).to.be.revertedWith(
        "Only the landlord or tenant can raise a dispute"
      );
    });

    it("U-06 the landlord cannot resolve a dispute (arbiter only)", async function () {
      const { rentSafe, landlord } = await loadFixture(disputedFixture);
      await expect(rentSafe.connect(landlord).resolveDispute(1, 0)).to.be.revertedWith(
        "Only the arbiter can perform this action"
      );
    });

    it("U-07 a non-arbiter cannot change the minimum deposit", async function () {
      const { rentSafe, outsider } = await loadFixture(deployFixture);
      await expect(rentSafe.connect(outsider).setMinDeposit(1)).to.be.revertedWith(
        "Only the arbiter can perform this action"
      );
    });

    it("U-08 the arbiter cannot be a party to an agreement", async function () {
      const { rentSafe, arbiter, landlord, tenant, leaseEnd } = await loadFixture(deployFixture);
      await expect(
        rentSafe.connect(arbiter).createAgreement(tenant.address, DEPOSIT, leaseEnd, PROPERTY)
      ).to.be.revertedWith("Arbiter cannot be a party to an agreement");
      await expect(
        rentSafe.connect(landlord).createAgreement(arbiter.address, DEPOSIT, leaseEnd, PROPERTY)
      ).to.be.revertedWith("Arbiter cannot be a party to an agreement");
    });
  });
});
