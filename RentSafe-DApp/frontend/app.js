/* global ethers, CONFIG, RENTSAFE_ABI */
"use strict";

// Mirrors the Status enum in contracts/RentSafe.sol
const STATUS = { Created: 0, Funded: 1, RefundProposed: 2, Disputed: 3, Settled: 4, Cancelled: 5 };
const STATUS_LABEL = ["Created", "Funded", "Refund proposed", "Disputed", "Settled", "Cancelled"];
const MAX_TEXT_LENGTH = 200;
// Gas limit used when "send even if expected to fail" is ticked, so that
// gas estimation (which would stop a reverting transaction) is skipped.
const FORCE_GAS_LIMIT = 500000n;

const state = {
  injected: null,     // window.ethereum (MetaMask)
  provider: null,     // ethers.BrowserProvider
  signer: null,
  account: null,
  contract: null,     // read-only contract (provider)
  writer: null,       // contract connected to the MetaMask signer
  arbiter: null,
  agreementCount: 0,
  agreements: [],
  current: null,      // agreement shown in "Manage an agreement"
  latestBlockTime: 0,
  log: [],
  logSeq: 0,
};

const $ = (id) => document.getElementById(id);

window.addEventListener("DOMContentLoaded", init);

// ===========================================================================
// Start-up and wallet connection
// ===========================================================================

function init() {
  bindUi();
  setConnectedUi(false);

  state.injected = getInjectedProvider();
  if (!state.injected) {
    showNotice("MetaMask was not detected. Install the MetaMask browser extension, then reload this page.");
    $("connectBtn").disabled = true;
    return;
  }
  if (!isConfiguredAddress()) {
    showNotice("Set CONTRACT_ADDRESS in frontend/config.js to the address of your deployed RentSafe contract.");
  }

  state.injected.on("accountsChanged", onAccountsChanged);
  state.injected.on("chainChanged", () => window.location.reload());

  // Reconnect silently if this site was already authorised in MetaMask.
  state.injected.request({ method: "eth_accounts" }).then((accounts) => {
    if (accounts.length) connectWallet(false);
  });

  // Keep "lease ends in…" and action hints current.
  setInterval(() => { if (state.current) renderAgreement(false); }, 10000);
}

function getInjectedProvider() {
  const eth = window.ethereum;
  if (!eth) return null;
  if (Array.isArray(eth.providers)) return eth.providers.find((p) => p.isMetaMask) || eth.providers[0];
  return eth;
}

function isConfiguredAddress() {
  return ethers.isAddress(CONFIG.CONTRACT_ADDRESS) && CONFIG.CONTRACT_ADDRESS !== ethers.ZeroAddress;
}

async function connectWallet(prompt = true) {
  const btn = $("connectBtn");
  setBusy(btn, true);
  try {
    state.provider = new ethers.BrowserProvider(state.injected);
    const accounts = await state.provider.send(prompt ? "eth_requestAccounts" : "eth_accounts", []);
    if (!accounts.length) return;

    state.signer = await state.provider.getSigner();
    state.account = await state.signer.getAddress();
    const network = await state.provider.getNetwork();
    const chainOk = renderNetwork(network.chainId);
    setConnectedUi(true);
    await refreshAccount();

    if (!chainOk) {
      showNotice(
        `MetaMask is on chain ${network.chainId}, but RentSafe is configured for chain ${CONFIG.CHAIN_ID}.`,
        "error",
        { label: "Switch network", onClick: switchNetwork }
      );
      return;
    }
    if (!isConfiguredAddress()) {
      showNotice("Wallet connected. Now set CONTRACT_ADDRESS in frontend/config.js and reload the page.");
      return;
    }
    const code = await state.provider.getCode(CONFIG.CONTRACT_ADDRESS);
    if (code === "0x") {
      showNotice(`No contract found at ${CONFIG.CONTRACT_ADDRESS} on this network. Check CONTRACT_ADDRESS in config.js.`);
      return;
    }

    state.contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, RENTSAFE_ABI, state.provider);
    state.writer = state.contract.connect(state.signer);
    hideNotice();
    await refreshAll();
    toast(`Connected ${shortAddr(state.account)}`, "success");
  } catch (err) {
    console.error(err);
    showNotice(`Could not connect to MetaMask: ${parseError(err)}`);
  } finally {
    setBusy(btn, false);
    setConnectedUi(!!state.account);
  }
}

async function onAccountsChanged(accounts) {
  if (!accounts.length) {
    Object.assign(state, { signer: null, account: null, contract: null, writer: null, current: null });
    setConnectedUi(false);
    renderAgreement(false);
    showNotice("MetaMask is disconnected. Click Connect MetaMask to continue.", "info");
    return;
  }
  await connectWallet(false);
}

async function switchNetwork() {
  const chainId = "0x" + Number(CONFIG.CHAIN_ID).toString(16);
  try {
    await state.injected.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (err) {
    if (err.code === 4902) {
      showNotice(`Chain ${CONFIG.CHAIN_ID} is not added to MetaMask yet. Add it first (see README, "Connect MetaMask").`);
    } else {
      toast(parseError(err), "error");
    }
  }
}

function renderNetwork(chainId) {
  const id = Number(chainId);
  const names = { 1337: "Ganache", 5777: "Ganache", 31337: "Hardhat", 11155111: "Sepolia", 17000: "Holesky", 1: "Ethereum Mainnet" };
  const ok = !CONFIG.CHAIN_ID || id === Number(CONFIG.CHAIN_ID);
  const badge = $("networkBadge");
  badge.textContent = `${names[id] || "Chain"} · ${id}`;
  badge.className = `badge ${ok ? "ok" : "bad"}`;
  return ok;
}

function setConnectedUi(connected) {
  document.querySelectorAll("[data-needs-wallet]").forEach((el) => { el.disabled = !connected; });
  $("connectBtn").textContent = connected && state.account ? shortAddr(state.account) : "Connect MetaMask";
  if (!connected) {
    $("networkBadge").textContent = "Not connected";
    $("networkBadge").className = "badge";
    ["accAddress", "accBalance", "accRole", "accPending"].forEach((id) => { $(id).textContent = "—"; });
  }
}

// ===========================================================================
// Reading blockchain data
// ===========================================================================

async function refreshAll() {
  if (!state.contract) return;
  await refreshStats();
  await Promise.all([refreshAccount(), refreshAgreements(), refreshEvents()]);
  if (state.current) await loadAgreement(state.current.id, { quiet: true });
}

async function refreshStats() {
  const c = state.contract;
  const [name, arbiter, count, escrow, minDeposit, balance, block] = await Promise.all([
    c.platformName(),
    c.arbiter(),
    c.agreementCount(),
    c.totalInEscrow(),
    c.minDeposit(),
    c.getContractBalance(),
    state.provider.getBlock("latest"),
  ]);
  state.arbiter = arbiter;
  state.agreementCount = Number(count);
  state.latestBlockTime = Number(block.timestamp);

  $("statPlatform").textContent = name;
  $("statAddress").textContent = CONFIG.CONTRACT_ADDRESS;
  $("statArbiter").innerHTML = addrHtml(arbiter, true);
  $("statCount").textContent = state.agreementCount;
  $("statEscrow").textContent = fmtEth(escrow);
  $("statBalance").textContent = fmtEth(balance);
  $("statMin").textContent = fmtEth(minDeposit);
  $("statBlock").textContent = `#${block.number} · ${fmtTime(block.timestamp)}`;
}

async function refreshAccount() {
  if (!state.account) return;
  $("accAddress").textContent = state.account;
  $("accBalance").textContent = fmtEth(await state.provider.getBalance(state.account));
  if (!state.contract) return;
  $("accPending").textContent = fmtEth(await state.contract.pendingWithdrawals(state.account));
  renderRole();
}

function renderRole() {
  if (same(state.account, state.arbiter)) {
    $("accRole").textContent = "Arbiter (deployed the contract)";
    return;
  }
  const asLandlord = state.agreements.filter((a) => same(a.landlord, state.account)).map((a) => `#${a.id}`);
  const asTenant = state.agreements.filter((a) => same(a.tenant, state.account)).map((a) => `#${a.id}`);
  const parts = [];
  if (asLandlord.length) parts.push(`Landlord of ${asLandlord.join(", ")}`);
  if (asTenant.length) parts.push(`Tenant of ${asTenant.join(", ")}`);
  $("accRole").textContent = parts.length ? parts.join(" · ") : "No agreements yet";
}

async function refreshAgreements() {
  const ids = Array.from({ length: state.agreementCount }, (_, i) => i + 1);
  const list = await Promise.all(ids.map((id) => state.contract.getAgreement(id)));
  state.agreements = list.map(normalizeAgreement);
  renderAgreementsTable();
  renderRole();
}

function normalizeAgreement(a) {
  return {
    id: Number(a.id),
    landlord: a.landlord,
    tenant: a.tenant,
    deposit: a.deposit,
    leaseEnd: Number(a.leaseEnd),
    createdAt: Number(a.createdAt),
    propertyDetails: a.propertyDetails,
    deduction: a.deduction,
    deductionReason: a.deductionReason,
    tenantRefund: a.tenantRefund,
    status: Number(a.status),
  };
}

function renderAgreementsTable() {
  const body = $("agreementsBody");
  const onlyMine = $("onlyMine").checked;
  const rows = state.agreements
    .filter((a) => !onlyMine || same(a.landlord, state.account) || same(a.tenant, state.account))
    .sort((x, y) => y.id - x.id);

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" class="empty">${onlyMine ? "You have no agreements yet." : "No agreements have been created yet."}</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((a) => `
    <tr class="clickable${state.current && state.current.id === a.id ? " selected" : ""}" data-id="${a.id}">
      <td><strong>#${a.id}</strong></td>
      <td>${escapeHtml(a.propertyDetails)}</td>
      <td>${addrHtml(a.landlord)}</td>
      <td>${addrHtml(a.tenant)}</td>
      <td>${fmtEth(a.deposit)}</td>
      <td>${fmtTime(a.leaseEnd)}</td>
      <td><span class="status s${a.status}">${STATUS_LABEL[a.status]}</span></td>
    </tr>`).join("");
}

async function refreshEvents() {
  const body = $("eventsBody");
  try {
    const events = await state.contract.queryFilter("*", CONFIG.DEPLOYMENT_BLOCK || 0, "latest");
    const rows = events.filter((e) => e.fragment).slice(-40).reverse();
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="4" class="empty">No events yet.</td></tr>';
      return;
    }
    body.innerHTML = rows.map((e) => `
      <tr>
        <td>${e.blockNumber}</td>
        <td><strong>${e.fragment.name}</strong></td>
        <td>${describeEvent(e.fragment.name, e.args)}</td>
        <td>${txLink(e.transactionHash, false)}</td>
      </tr>`).join("");
  } catch (err) {
    console.error(err);
    body.innerHTML = `<tr><td colspan="4" class="empty">Could not read events: ${escapeHtml(parseError(err))}</td></tr>`;
  }
}

function describeEvent(name, a) {
  switch (name) {
    case "AgreementCreated":
      return `#${a.id} · landlord ${addrHtml(a.landlord)} · tenant ${addrHtml(a.tenant)} · deposit ${fmtEth(a.deposit)}`;
    case "DepositPaid":
      return `#${a.id} · ${addrHtml(a.tenant)} paid ${fmtEth(a.amount)}`;
    case "AgreementCancelled":
      return `#${a.id} · cancelled by ${addrHtml(a.landlord)}`;
    case "RefundProposed":
      return `#${a.id} · deduction ${fmtEth(a.deduction)}${a.reason ? ` · “${escapeHtml(a.reason)}”` : ""}`;
    case "DisputeRaised":
      return `#${a.id} · raised by ${addrHtml(a.raisedBy)}`;
    case "AgreementSettled":
      return `#${a.id} · tenant ${fmtEth(a.tenantRefund)} · landlord ${fmtEth(a.landlordShare)} · ${a.resolvedByArbiter ? "decided by arbiter" : "accepted by tenant"}`;
    case "Withdrawn":
      return `${addrHtml(a.account)} withdrew ${fmtEth(a.amount)}`;
    case "MinDepositUpdated":
      return `${fmtEth(a.oldMinDeposit)} → ${fmtEth(a.newMinDeposit)}`;
    default:
      return "";
  }
}

async function loadAgreement(id, { quiet = false } = {}) {
  if (!state.contract) return;
  const isNew = !state.current || state.current.id !== Number(id);
  try {
    state.current = normalizeAgreement(await state.contract.getAgreement(id));
    renderAgreement(isNew);
  } catch (err) {
    state.current = null;
    renderAgreement(false);
    if (!quiet) toast(`Could not load agreement ${id}: ${parseError(err)}`, "error");
  }
  renderAgreementsTable();
}

function renderAgreement(prefill) {
  const a = state.current;
  $("agreementView").classList.toggle("hidden", !a);
  $("agreementEmpty").classList.toggle("hidden", !!a);
  if (!a) return;

  const isLandlord = same(a.landlord, state.account);
  const isTenant = same(a.tenant, state.account);
  const ended = nowSeconds() >= a.leaseEnd;

  $("agTitle").textContent = `Agreement #${a.id}`;
  $("agStatus").textContent = STATUS_LABEL[a.status];
  $("agStatus").className = `status s${a.status}`;
  $("agYourRole").textContent = isLandlord ? "You are the landlord"
    : isTenant ? "You are the tenant"
    : same(state.account, state.arbiter) ? "You are the arbiter"
    : "You are not a party";

  const steps = a.status === STATUS.Cancelled
    ? [STATUS.Created, STATUS.Cancelled]
    : [STATUS.Created, STATUS.Funded, STATUS.RefundProposed, STATUS.Disputed, STATUS.Settled];
  $("agTimeline").innerHTML = steps.map((s) => {
    const cls = s === a.status ? "current"
      : (s === STATUS.Created || (s === STATUS.Funded && a.status !== STATUS.Created)) ? "done" : "";
    return `<li class="${cls}">${STATUS_LABEL[s]}</li>`;
  }).join("");

  $("agProperty").textContent = a.propertyDetails;
  $("agLandlord").innerHTML = addrHtml(a.landlord, true);
  $("agTenant").innerHTML = addrHtml(a.tenant, true);
  $("agDeposit").textContent = fmtEth(a.deposit);
  $("agLeaseEnd").textContent = `${fmtTime(a.leaseEnd)} (${ended ? "ended" : "ends"} ${relTime(a.leaseEnd)})`;
  $("agCreated").textContent = fmtTime(a.createdAt);

  const proposalMade = [STATUS.RefundProposed, STATUS.Disputed, STATUS.Settled].includes(a.status)
    && (a.deduction > 0n || a.deductionReason !== "" || a.status === STATUS.RefundProposed);
  $("agDeduction").textContent = proposalMade
    ? `${fmtEth(a.deduction)}${a.deductionReason ? ` — “${a.deductionReason}”` : ""}`
    : "—";
  $("agSettlement").textContent = a.status === STATUS.Settled
    ? `Tenant ${fmtEth(a.tenantRefund)} · Landlord ${fmtEth(a.deposit - a.tenantRefund)}`
    : "—";

  if (prefill) {
    $("payAmountInput").value = ethers.formatEther(a.deposit);
    $("deductionInput").value = "";
    $("reasonInput").value = "";
    $("resolveInput").value = "";
    $("agreementIdInput").value = a.id;
  }
  renderHints(a);
}

// Client-side preview of the contract's rules. The contract is still the
// source of truth: every action can be sent so its validation can be tested.
function checkAction(action, a) {
  const isLandlord = same(a.landlord, state.account);
  const isTenant = same(a.tenant, state.account);
  const isArbiter = same(state.arbiter, state.account);
  const ended = nowSeconds() >= a.leaseEnd;
  const rules = {
    pay: [[isTenant, "only the tenant can pay"], [a.status === STATUS.Created, "deposit already paid or agreement closed"]],
    cancel: [[isLandlord, "only the landlord can cancel"], [a.status === STATUS.Created, "only unpaid agreements can be cancelled"]],
    propose: [[isLandlord, "only the landlord can propose a refund"], [a.status === STATUS.Funded, "deposit is not held for this agreement"], [ended, "lease has not ended yet"]],
    accept: [[isTenant, "only the tenant can accept"], [a.status === STATUS.RefundProposed, "there is no refund proposal to accept"]],
    dispute: [[isLandlord || isTenant, "only the landlord or tenant can raise a dispute"], [a.status === STATUS.Funded || a.status === STATUS.RefundProposed, "cannot be disputed in its current state"], [ended, "lease has not ended yet"]],
    resolve: [[isArbiter, "only the arbiter can resolve disputes"], [a.status === STATUS.Disputed, "agreement is not under dispute"]],
  };
  const failed = rules[action].find(([ok]) => !ok);
  return failed ? { ok: false, reason: failed[1] } : { ok: true };
}

function renderHints(a) {
  document.querySelectorAll(".action").forEach((el) => {
    const hint = el.querySelector(".hint");
    const result = checkAction(el.dataset.action, a);
    hint.className = `hint ${result.ok ? "ok" : "no"}`;
    hint.textContent = result.ok ? "✓ You can do this now" : `✗ Expected to be rejected: ${result.reason}`;
  });
}

// ===========================================================================
// Sending transactions
// ===========================================================================

async function sendTx(label, method, args, overrides = {}, button = null) {
  if (!requireContract()) return null;
  const entry = addLog(label);
  const opts = { ...overrides };
  if ($("forceSend").checked) opts.gasLimit = FORCE_GAS_LIMIT;
  setBusy(button, true);
  try {
    const fn = state.writer.getFunction(method);
    let tx;
    try {
      tx = await fn(...args, opts);
    } catch (err) {
      if (opts.gasLimit || !(await chainClockBehindLease(err))) throw err;
      updateLog(entry, { message: "The chain has not mined a block since the lease ended, so its clock is behind. Sending without the pre-flight check…" });
      tx = await fn(...args, { ...opts, gasLimit: FORCE_GAS_LIMIT });
    }
    updateLog(entry, { status: "pending", hash: tx.hash, message: "Submitted, waiting to be mined…" });
    const receipt = await tx.wait();
    updateLog(entry, {
      status: "success",
      hash: receipt.hash,
      block: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      message: "Confirmed on the blockchain",
    });
    toast(`${label}: confirmed in block ${receipt.blockNumber}`, "success");
    return receipt;
  } catch (err) {
    console.error(err);
    if (err.receipt) {
      // Mined but reverted (only possible when gas estimation was skipped).
      const reason = await simulateRevertReason(method, args, overrides);
      updateLog(entry, {
        status: "failed",
        hash: err.receipt.hash,
        block: err.receipt.blockNumber,
        gasUsed: err.receipt.gasUsed,
        message: `Transaction mined but reverted (status 0)${reason ? `: ${reason}` : ""}`,
      });
      toast(`${label} failed: ${reason || "reverted"}`, "error");
    } else if (isUserRejection(err)) {
      updateLog(entry, { status: "rejected", message: "Rejected by the user in MetaMask" });
      toast(`${label}: rejected in MetaMask`, "error");
    } else {
      const reason = parseError(err);
      const prefix = err.code === "CALL_EXCEPTION" ? "Reverted by the smart contract" : "Failed";
      updateLog(entry, { status: "failed", hash: err.receipt?.hash, message: `${prefix}: ${reason}` });
      toast(`${label} failed: ${reason}`, "error");
    }
    return null;
  } finally {
    setBusy(button, false);
    refreshAll().catch(console.error);
  }
}

// Ganache only mines a block when it receives a transaction, and it simulates calls
// against the latest block's timestamp. After a lease ends on a quiet local chain, the
// pre-flight check can therefore still report "Lease has not ended yet". When that is
// the only obstacle, the transaction is sent anyway: it is mined in a new block that
// carries the current time.
async function chainClockBehindLease(err) {
  const a = state.current;
  if (!a || parseError(err) !== "Lease has not ended yet") return false;
  const latest = await state.provider.getBlock("latest");
  return Math.floor(Date.now() / 1000) >= a.leaseEnd && Number(latest.timestamp) < a.leaseEnd;
}

async function simulateRevertReason(method, args, overrides) {
  try {
    await state.writer.getFunction(method).staticCall(...args, overrides);
    return "";
  } catch (err) {
    return parseError(err);
  }
}

function isUserRejection(err) {
  return err?.code === "ACTION_REJECTED" || err?.code === 4001
    || err?.info?.error?.code === 4001 || err?.error?.code === 4001;
}

// Pulls the human-readable revert reason out of the different error shapes
// produced by ethers.js, MetaMask, Ganache and Hardhat.
function parseError(err) {
  if (!err) return "Unknown error";
  if (isUserRejection(err)) return "Rejected in MetaMask";
  if (err.reason) return err.reason;
  if (err.revert?.args?.length) return String(err.revert.args[0]);

  const direct = err.info?.error?.data?.reason || err.error?.data?.reason || err.data?.reason;
  if (direct) return direct;

  const messages = [
    err.info?.error?.data?.message,
    err.info?.error?.message,
    err.error?.data?.message,
    err.error?.message,
    err.data?.message,
    err.shortMessage,
    err.message,
  ].filter((m) => typeof m === "string" && m);

  for (const m of messages) {
    const match = m.match(/reverted with reason string '([^']*)'/) || m.match(/revert(?:ed)?:?\s+(.+)$/i);
    if (match) return match[1].replace(/^"|"$/g, "");
  }
  return messages[0] || String(err);
}

// ===========================================================================
// UI event handlers
// ===========================================================================

function bindUi() {
  $("connectBtn").addEventListener("click", () => connectWallet(true));
  $("refreshBtn").addEventListener("click", () => refreshAll().catch((e) => toast(parseError(e), "error")));
  $("clearLogBtn").addEventListener("click", () => { state.log = []; renderLog(); });
  $("onlyMine").addEventListener("change", renderAgreementsTable);

  $("createForm").addEventListener("submit", onCreateAgreement);
  $("minDepositForm").addEventListener("submit", onSetMinDeposit);
  $("loadForm").addEventListener("submit", onLoadAgreement);

  $("payBtn").addEventListener("click", onPayDeposit);
  $("cancelBtn").addEventListener("click", () => agreementTx("Cancel agreement", "cancelAgreement", [], {}, $("cancelBtn")));
  $("proposeBtn").addEventListener("click", onProposeRefund);
  $("acceptBtn").addEventListener("click", () => agreementTx("Accept refund", "acceptRefund", [], {}, $("acceptBtn")));
  $("disputeBtn").addEventListener("click", () => agreementTx("Raise dispute", "raiseDispute", [], {}, $("disputeBtn")));
  $("resolveBtn").addEventListener("click", onResolveDispute);
  $("withdrawBtn").addEventListener("click", () => sendTx("Withdraw ETH", "withdraw", [], {}, $("withdrawBtn")));

  document.querySelectorAll("[data-add-minutes]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const minutes = Number(chip.dataset.addMinutes);
      $("leaseEndInput").value = toLocalInputValue(new Date(Date.now() + minutes * 60000));
    });
  });

  $("propertyInput").addEventListener("input", () => {
    const len = new TextEncoder().encode($("propertyInput").value.trim()).length;
    $("propertyCount").textContent = `${len}/${MAX_TEXT_LENGTH}`;
    $("propertyCount").classList.toggle("over", len > MAX_TEXT_LENGTH);
  });

  $("agreementsBody").addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-id]");
    if (!row) return;
    loadAgreement(Number(row.dataset.id));
    $("agreementView").closest(".card").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

async function onCreateAgreement(e) {
  e.preventDefault();
  hideFormError("createError");
  const tenant = $("tenantInput").value.trim();
  const leaseValue = $("leaseEndInput").value;
  const property = $("propertyInput").value.trim();

  // Format checks only. Business rules (minimum deposit, future date, text
  // length, roles) are deliberately left to the smart contract.
  if (!ethers.isAddress(tenant)) {
    return showFormError("createError", "Tenant address must be a valid Ethereum address (0x followed by 40 hex characters).");
  }
  let deposit;
  try {
    deposit = parseEthInput($("depositInput").value, "Security deposit");
  } catch (err) {
    return showFormError("createError", err.message);
  }
  if (!leaseValue) return showFormError("createError", "Choose the lease end date and time.");
  const leaseEnd = Math.floor(new Date(leaseValue).getTime() / 1000);

  const receipt = await sendTx("Create agreement", "createAgreement", [tenant, deposit, leaseEnd, property], {}, e.submitter);
  if (!receipt) return;

  const created = receipt.logs
    .map((log) => { try { return state.contract.interface.parseLog(log); } catch { return null; } })
    .find((parsed) => parsed && parsed.name === "AgreementCreated");
  $("createForm").reset();
  $("propertyCount").textContent = `0/${MAX_TEXT_LENGTH}`;
  if (created) {
    toast(`Agreement #${created.args.id} created`, "success");
    await loadAgreement(Number(created.args.id));
  }
}

async function onSetMinDeposit(e) {
  e.preventDefault();
  hideFormError("minDepositError");
  let value;
  try {
    value = parseEthInput($("minDepositInput").value, "Minimum deposit");
  } catch (err) {
    return showFormError("minDepositError", err.message);
  }
  const receipt = await sendTx("Update minimum deposit", "setMinDeposit", [value], {}, e.submitter);
  if (receipt) $("minDepositForm").reset();
}

async function onLoadAgreement(e) {
  e.preventDefault();
  const raw = $("agreementIdInput").value.trim();
  if (!/^\d+$/.test(raw)) return toast("Agreement ID must be a whole number, e.g. 1", "error");
  await loadAgreement(Number(raw));
}

async function onPayDeposit() {
  let value;
  try {
    value = parseEthInput($("payAmountInput").value, "Amount to send");
  } catch (err) {
    return toast(err.message, "error");
  }
  await agreementTx("Pay deposit", "payDeposit", [], { value }, $("payBtn"));
}

async function onProposeRefund() {
  let deduction;
  try {
    deduction = parseEthInput($("deductionInput").value.trim() || "0", "Deduction");
  } catch (err) {
    return toast(err.message, "error");
  }
  await agreementTx("Propose refund", "proposeRefund", [deduction, $("reasonInput").value.trim()], {}, $("proposeBtn"));
}

async function onResolveDispute() {
  let refund;
  try {
    refund = parseEthInput($("resolveInput").value, "Refund to tenant");
  } catch (err) {
    return toast(err.message, "error");
  }
  await agreementTx("Resolve dispute", "resolveDispute", [refund], {}, $("resolveBtn"));
}

// Sends a transaction for the agreement currently shown (its ID is the first argument).
async function agreementTx(label, method, extraArgs, overrides, button) {
  if (!state.current) return toast("Load an agreement first", "error");
  const id = state.current.id;
  await sendTx(`${label} (#${id})`, method, [id, ...extraArgs], overrides, button);
}

// ===========================================================================
// Transaction log
// ===========================================================================

function addLog(label) {
  const entry = { id: ++state.logSeq, label, status: "pending", message: "Waiting for confirmation in MetaMask…", time: new Date() };
  state.log.unshift(entry);
  renderLog();
  return entry;
}

function updateLog(entry, patch) {
  Object.assign(entry, patch);
  renderLog();
}

function renderLog() {
  const list = $("txLog");
  if (!state.log.length) {
    list.innerHTML = '<li class="empty">Transactions you send from this page will appear here.</li>';
    return;
  }
  list.innerHTML = state.log.map((e) => `
    <li class="${e.status}">
      <div class="tx-top">
        <span class="tx-label">${escapeHtml(e.label)}</span>
        <span class="tx-status">${e.status}</span>
      </div>
      <div class="tx-msg">${escapeHtml(e.message)}</div>
      <div class="tx-meta">
        <span>${e.time.toLocaleTimeString()}</span>
        ${e.hash ? `<span>Tx hash: ${txLink(e.hash, true)}</span>` : ""}
        ${e.block != null ? `<span>Block: ${e.block}</span>` : ""}
        ${e.gasUsed != null ? `<span>Gas used: ${e.gasUsed.toString()}</span>` : ""}
      </div>
    </li>`).join("");
}

// ===========================================================================
// Small helpers
// ===========================================================================

function requireContract() {
  if (state.writer) return true;
  toast(state.account ? "The RentSafe contract is not available. Check config.js and the network." : "Connect MetaMask first", "error");
  return false;
}

function parseEthInput(value, field) {
  const v = String(value).trim();
  if (!/^(\d+\.?\d*|\.\d+)$/.test(v)) throw new Error(`${field} must be a positive number of ETH, e.g. 0.5`);
  try {
    return ethers.parseEther(v);
  } catch {
    throw new Error(`${field} has too many decimal places (maximum 18).`);
  }
}

function fmtEth(wei) {
  const value = BigInt(wei);
  if (value > 0n && value < 10n ** 12n) return "< 0.000001 ETH";
  const [whole, frac = ""] = ethers.formatEther(value).split(".");
  const trimmed = frac.slice(0, 6).replace(/0+$/, "");
  return `${whole}${trimmed ? "." + trimmed : ""} ETH`;
}

function fmtTime(ts) {
  return ts ? new Date(Number(ts) * 1000).toLocaleString() : "—";
}

function nowSeconds() {
  return Math.max(state.latestBlockTime, Math.floor(Date.now() / 1000));
}

function relTime(ts) {
  const diff = ts - nowSeconds();
  const abs = Math.abs(diff);
  const units = [["day", 86400], ["hour", 3600], ["minute", 60], ["second", 1]];
  const [name, size] = units.find(([, s]) => abs >= s) || units[3];
  const n = Math.floor(abs / size);
  const text = `${n} ${name}${n === 1 ? "" : "s"}`;
  return diff > 0 ? `in ${text}` : `${text} ago`;
}

function toLocalInputValue(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function shortAddr(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—";
}

function same(a, b) {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

function addrHtml(addr, full = false) {
  const text = full ? addr : shortAddr(addr);
  return `<span class="mono" title="${escapeHtml(addr)}">${escapeHtml(text)}</span>${same(addr, state.account) ? '<span class="you">YOU</span>' : ""}`;
}

function txLink(hash, full) {
  const text = full ? hash : `${hash.slice(0, 10)}…${hash.slice(-6)}`;
  return CONFIG.EXPLORER_URL
    ? `<a class="mono" href="${CONFIG.EXPLORER_URL}/tx/${hash}" target="_blank" rel="noopener" title="${hash}">${text}</a>`
    : `<span class="mono" title="${hash}">${text}</span>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle("busy", busy);
}

function showFormError(id, message) {
  $(id).textContent = message;
  $(id).classList.remove("hidden");
}

function hideFormError(id) {
  $(id).classList.add("hidden");
}

function showNotice(text, kind = "error", action = null) {
  $("notice").className = `notice ${kind === "info" ? "info" : ""}`;
  $("noticeText").textContent = text;
  const btn = $("noticeAction");
  btn.classList.toggle("hidden", !action);
  if (action) {
    btn.textContent = action.label;
    btn.onclick = action.onClick;
  }
}

function hideNotice() {
  $("notice").classList.add("hidden");
}

function toast(message, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), 5000);
}
