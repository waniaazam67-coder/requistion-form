const STORAGE_KEY = "imsPortalStateV4";
let seedTxCounter = 0;

const seedState = {
  locations: [],
  items: [],
  vendors: [],
  requests: [],
  transportRequests: [],
  purchaseOrders: [],
  grns: [],
  transactions: [],
  auditLogs: []
};

let state = loadState();
let inventoryCategoryFilter = "All";
let inventoryPage = 1;
const INVENTORY_PAGE_SIZE = 15;

function tx(itemCode, location, type, quantity, sourceId, notes) {
  return {
    id: `TX-${String(++seedTxCounter).padStart(3, "0")}`,
    itemCode,
    location,
    type,
    quantity: Number(quantity),
    sourceId,
    notes,
    performedBy: "System",
    date: new Date().toISOString()
  };
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved && window.IMS_IMPORTED_INVENTORY) return structuredClone(window.IMS_IMPORTED_INVENTORY);
  if (!saved) return structuredClone(seedState);
  try {
    return JSON.parse(saved);
  } catch {
    return structuredClone(seedState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function nextId(prefix, rows) {
  const max = rows.reduce((highest, row) => {
    const id = row.id || row.requestId || row.poNumber || row.grnNumber || "";
    const value = Number(String(id).replace(/\D/g, ""));
    return Math.max(highest, value || 0);
  }, 0);
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

function audit(action, entityType, entityId, details) {
  state.auditLogs.unshift({
    id: nextId("AUD", state.auditLogs),
    date: new Date().toISOString(),
    action,
    entityType,
    entityId,
    details
  });
}

function findItem(code) {
  return state.items.find((item) => item.code === code);
}

function stockFor(itemCode, location) {
  return state.transactions
    .filter((entry) => entry.itemCode === itemCode && entry.location === location)
    .reduce((sum, entry) => {
      const isOut = ["STOCK_OUT", "ADJUSTMENT_OUT"].includes(entry.type);
      return sum + (isOut ? -entry.quantity : entry.quantity);
    }, 0);
}

function stockRows() {
  const pairs = new Map();
  state.items.forEach((item) => {
    state.locations.forEach((location) => pairs.set(`${item.code}|${location}`, { itemCode: item.code, location }));
  });
  state.transactions.forEach((entry) => pairs.set(`${entry.itemCode}|${entry.location}`, { itemCode: entry.itemCode, location: entry.location }));
  return [...pairs.values()].map((pair) => {
    const item = findItem(pair.itemCode) || {};
    const stock = stockFor(pair.itemCode, pair.location);
    const status = stock <= 0 ? "Out of stock" : stock <= (item.reorderLevel || 0) ? "Restock needed" : "OK";
    return { ...item, location: pair.location, stock, status };
  });
}

function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => toast.className = "toast", 2800);
}

function money(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function optionsHtml(values, getValue = (row) => row, getLabel = (row) => row) {
  return values.map((row) => `<option value="${getValue(row)}">${getLabel(row)}</option>`).join("");
}

function syncSelectOptions(scope = document) {
  scope.querySelectorAll("[data-locations]").forEach((select) => {
    const selected = select.value;
    select.innerHTML = `<option value="">Select location</option>${optionsHtml(state.locations)}`;
    if (selected) select.value = selected;
  });
  scope.querySelectorAll("[data-items]").forEach((select) => {
    const selected = select.value;
    select.innerHTML = `<option value="">Select item</option>${optionsHtml(state.items, (item) => item.code, (item) => `${item.code} - ${item.name}`)}`;
    if (selected) select.value = selected;
  });
  scope.querySelectorAll("[data-vendors]").forEach((select) => {
    const selected = select.value;
    select.innerHTML = `<option value="">Select vendor</option>${optionsHtml(state.vendors, (vendor) => vendor.id, (vendor) => vendor.name)}`;
    if (selected) select.value = selected;
  });
  const poSelect = document.getElementById("poSelect");
  poSelect.innerHTML = `<option value="">Manual receipt</option>${optionsHtml(state.purchaseOrders, (po) => po.poNumber, (po) => po.poNumber)}`;
}

function setView(view) {
  document.querySelectorAll(".view").forEach((panel) => panel.classList.remove("active"));
  document.getElementById(`${view}View`).classList.add("active");
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  const active = document.querySelector(`.nav-item[data-view="${view}"] span:last-child`);
  document.getElementById("pageTitle").textContent = active ? active.textContent : "Dashboard";
  render();
}

function addRequestLine() {
  const template = document.getElementById("requestItemTemplate");
  const row = template.content.firstElementChild.cloneNode(true);
  row.querySelector(".remove-line").addEventListener("click", () => row.remove());
  document.getElementById("requestItems").appendChild(row);
  syncSelectOptions(row);
  if (window.lucide) window.lucide.createIcons();
}

function statusBadge(status) {
  const key = String(status).toLowerCase().replace(/\s+/g, "-");
  return `<span class="badge ${key}">${status}</span>`;
}

function requestOverallStatus(request) {
  if (request.items.every((item) => item.approvalStatus === "Rejected")) return "Rejected";
  if (request.items.some((item) => item.approvalStatus === "Pending")) return "Pending";
  if (request.items.some((item) => item.issuanceStatus !== "Issued")) return "Approved";
  return "Issued";
}

function renderDashboard() {
  const allItems = state.requests.flatMap((request) => request.items.map((item) => ({ ...item, request })));
  document.getElementById("kpiRequests").textContent = state.requests.length;
  document.getElementById("kpiPendingApprovals").textContent = allItems.filter((item) => item.approvalStatus === "Pending").length;
  document.getElementById("kpiPendingIssue").textContent = allItems.filter((item) => item.approvalStatus === "Approved" && item.issuanceStatus !== "Issued").length;
  document.getElementById("kpiLowStock").textContent = stockRows().filter((row) => row.status !== "OK").length;
  document.getElementById("kpiPO").textContent = state.purchaseOrders.length;
  document.getElementById("kpiGRN").textContent = state.purchaseOrders.filter((po) => po.status !== "Closed").length;
  document.getElementById("kpiTransport").textContent = state.transportRequests.filter((row) => row.arrangementStatus === "Pending").length;
  document.getElementById("kpiAudit").textContent = state.auditLogs.length;
  drawChart();
}

function renderRequests() {
  document.getElementById("requestsTable").innerHTML = state.requests.map((request) => `
    <tr>
      <td>${request.requestId}</td><td>${request.requester}</td><td>${request.department}</td><td>${request.location}</td>
      <td>${request.items.length}</td><td>${statusBadge(requestOverallStatus(request))}</td><td>${new Date(request.date).toLocaleDateString()}</td>
      <td><button class="tiny" onclick="printRequest('${request.requestId}')">Print</button></td>
    </tr>`).join("") || emptyRow(8);
}

function renderApprovals() {
  document.getElementById("approvalsTable").innerHTML = state.requests.flatMap((request) => request.items.map((item) => `
    <tr>
      <td>${request.requestId}</td><td>${item.itemCode}</td><td>${item.itemName}</td><td>${item.quantity}</td><td>${statusBadge(item.approvalStatus)}</td>
      <td class="button-cell">
        <button class="tiny success" onclick="approveItem('${request.requestId}','${item.id}')">Approve</button>
        <button class="tiny danger" onclick="rejectItem('${request.requestId}','${item.id}')">Reject</button>
      </td>
    </tr>`)).join("") || emptyRow(6);
}

function renderInventory() {
  const rows = stockRows().filter((row) => inventoryCategoryFilter === "All" || row.category === inventoryCategoryFilter);
  const pageCount = Math.max(1, Math.ceil(rows.length / INVENTORY_PAGE_SIZE));
  inventoryPage = Math.min(Math.max(1, inventoryPage), pageCount);
  const start = (inventoryPage - 1) * INVENTORY_PAGE_SIZE;
  const pageRows = rows.slice(start, start + INVENTORY_PAGE_SIZE);
  document.getElementById("inventoryTable").innerHTML = pageRows.map((row) => `
    <tr><td>${row.code}</td><td>${row.name}</td><td>${row.type}</td><td>${row.category}</td><td>${row.location}</td><td>${row.stock}</td><td>${statusBadge(row.status)}</td></tr>
  `).join("") || emptyRow(7);
  document.getElementById("inventoryPageInfo").textContent = `Page ${inventoryPage} of ${pageCount}`;
  document.getElementById("inventoryPrev").disabled = inventoryPage === 1;
  document.getElementById("inventoryNext").disabled = inventoryPage === pageCount;
}

function renderIssue() {
  const rows = state.requests.flatMap((request) => request.items
    .filter((item) => item.approvalStatus === "Approved" && item.issuanceStatus !== "Issued")
    .map((item) => {
      const available = stockFor(item.itemCode, request.location);
      return `<tr>
        <td>${request.requestId}</td><td>${item.itemCode} - ${item.itemName}</td><td>${request.location}</td><td>${item.quantity}</td><td>${available}</td>
        <td><input class="table-input" type="number" min="1" max="${item.quantity}" value="${item.quantity}" id="qty-${item.id}"></td>
        <td><input class="table-input" placeholder="Issued by" id="by-${item.id}"></td>
        <td><button class="tiny success" onclick="issueItem('${request.requestId}','${item.id}')">Issue</button></td>
      </tr>`;
    }));
  document.getElementById("issueTable").innerHTML = rows.join("") || emptyRow(8);
}

function renderPO() {
  document.getElementById("poTable").innerHTML = state.purchaseOrders.map((po) => `
    <tr><td>${po.poNumber}</td><td>${po.vendorName}</td><td>${po.itemCode || po.description || "Specification only"}</td><td>${po.quantity}</td><td>${statusBadge(po.status)}</td><td>${money(po.total)}</td><td><button class="tiny" onclick="printPO('${po.poNumber}')">Print</button></td></tr>
  `).join("") || emptyRow(7);
}

function renderGRN() {
  document.getElementById("grnTable").innerHTML = state.grns.map((grn) => `
    <tr><td>${grn.grnNumber}</td><td>${grn.poNumber || "Manual"}</td><td>${grn.itemCode || grn.description || "Specification only"}</td><td>${grn.location}</td><td>${grn.qtyReceived}</td><td>${grn.qtyAccepted}</td><td>${grn.receivedBy}</td><td>${grn.date || ""}</td></tr>
  `).join("") || emptyRow(8);
}

function renderTransport() {
  document.getElementById("transportTable").innerHTML = state.transportRequests.map((row) => `
    <tr><td>${row.id}</td><td>${row.requester}</td><td>${row.transportType}</td><td>${row.travelDate}</td><td>${statusBadge(row.approvalStatus)}</td><td>${statusBadge(row.arrangementStatus)}</td>
    <td class="button-cell"><button class="tiny success" onclick="setTransport('${row.id}','Arranged')">Arrange</button><button class="tiny danger" onclick="setTransport('${row.id}','Rejected')">Reject</button></td></tr>
  `).join("") || emptyRow(7);
}

function renderVendors() {
  document.getElementById("vendorsTable").innerHTML = state.vendors.map((vendor) => `
    <tr><td>${vendor.name}</td><td>${vendor.phone || ""}</td><td>${vendor.contact || ""}</td><td>${vendor.address || ""}</td></tr>
  `).join("") || emptyRow(4);
}

function renderAudit() {
  document.getElementById("auditTable").innerHTML = state.auditLogs.map((log) => `
    <tr><td>${new Date(log.date).toLocaleString()}</td><td>${log.action}</td><td>${log.entityType} ${log.entityId}</td><td>${log.details}</td></tr>
  `).join("") || emptyRow(4);
}

function emptyRow(cols) {
  return `<tr><td colspan="${cols}" class="empty">No records yet</td></tr>`;
}

function render() {
  syncSelectOptions();
  renderDashboard();
  renderRequests();
  renderApprovals();
  renderInventory();
  renderIssue();
  renderPO();
  renderGRN();
  renderTransport();
  renderVendors();
  renderAudit();
  if (window.lucide) window.lucide.createIcons();
}

window.approveItem = function (requestId, itemId) {
  const request = state.requests.find((row) => row.requestId === requestId);
  const item = request.items.find((row) => row.id === itemId);
  if (item.approvalStatus !== "Pending") return showToast("This item has already been reviewed.", "error");
  item.approvalStatus = "Approved";
  audit("APPROVE_REQUEST_ITEM", "request_item", itemId, `${requestId} approved for ${item.itemCode}`);
  saveState();
  render();
};

window.rejectItem = function (requestId, itemId) {
  const request = state.requests.find((row) => row.requestId === requestId);
  const item = request.items.find((row) => row.id === itemId);
  if (item.issuanceStatus === "Issued") return showToast("Issued items cannot be rejected.", "error");
  item.approvalStatus = "Rejected";
  item.issuanceStatus = "Not Issued";
  audit("REJECT_REQUEST_ITEM", "request_item", itemId, `${requestId} rejected for ${item.itemCode}`);
  saveState();
  render();
};

window.issueItem = function (requestId, itemId) {
  const request = state.requests.find((row) => row.requestId === requestId);
  const item = request.items.find((row) => row.id === itemId);
  const qty = Number(document.getElementById(`qty-${item.id}`).value);
  const issuedBy = document.getElementById(`by-${item.id}`).value || "Inventory Manager";
  const available = stockFor(item.itemCode, request.location);
  if (item.approvalStatus !== "Approved") return showToast("Approval is required before issuance.", "error");
  if (!qty || qty < 1) return showToast("Issue quantity must be greater than zero.", "error");
  if (available < qty) return showToast("Stock unavailable. Mark this request for procurement.", "error");
  state.transactions.unshift({
    id: nextId("TX", state.transactions),
    itemCode: item.itemCode,
    location: request.location,
    type: "STOCK_OUT",
    quantity: qty,
    sourceId: requestId,
    notes: `Issued against ${requestId}`,
    performedBy: issuedBy,
    date: new Date().toISOString()
  });
  item.issuanceStatus = "Issued";
  item.quantityIssued = qty;
  item.issueDate = new Date().toISOString();
  item.issuedBy = issuedBy;
  audit("ISSUE_STOCK", "request_item", itemId, `${qty} ${item.itemCode} issued from ${request.location}`);
  saveState();
  render();
  showToast("Stock issued and ledger updated.");
};

window.setTransport = function (id, status) {
  const row = state.transportRequests.find((item) => item.id === id);
  row.arrangementStatus = status;
  audit("UPDATE_TRANSPORT", "transport_request", id, `Arrangement set to ${status}`);
  saveState();
  render();
};

window.printRequest = function (requestId) {
  const request = state.requests.find((row) => row.requestId === requestId);
  const html = `<h1>Requisition ${request.requestId}</h1><p>${request.requester} - ${request.department} - ${request.location}</p><table>${request.items.map((item) => `<tr><td>${item.itemCode}</td><td>${item.itemName}</td><td>${item.quantity}</td><td>${item.approvalStatus}</td><td>${item.issuanceStatus}</td></tr>`).join("")}</table>`;
  printHtml(html);
};

window.printPO = function (poNumber) {
  const po = state.purchaseOrders.find((row) => row.poNumber === poNumber);
  printHtml(`<h1>Purchase Order ${po.poNumber}</h1><p>Vendor: ${po.vendorName}</p><p>Item / Specification: ${po.itemCode || po.description || ""}</p><p>Qty: ${po.quantity}</p><p>Total: ${money(po.total)}</p>`);
};

function printHtml(html) {
  const printWindow = window.open("", "_blank", "width=800,height=700");
  printWindow.document.write(`<html><head><title>Print</title><style>body{font-family:Arial;padding:32px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px}</style></head><body>${html}</body></html>`);
  printWindow.document.close();
  printWindow.print();
}

function drawChart() {
  const canvas = document.getElementById("salesChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);
  const plot = { left: 36, right: 16, top: 18, bottom: 24 };
  plot.width = width - plot.left - plot.right;
  plot.height = height - plot.top - plot.bottom;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const incoming = [20, 35, 25, 42, 30, state.transactions.filter((t) => !["STOCK_OUT", "ADJUSTMENT_OUT"].includes(t.type)).reduce((a, t) => a + t.quantity, 0) / 10];
  const outgoing = [12, 15, 18, 11, 21, state.transactions.filter((t) => t.type === "STOCK_OUT").reduce((a, t) => a + t.quantity, 0) / 10];
  const max = Math.max(50, ...incoming, ...outgoing);
  ctx.font = "12px Inter, Arial";
  ctx.strokeStyle = "#edf1f4";
  ctx.fillStyle = "#8d98a1";
  [0, max / 2, max].forEach((tick) => {
    const y = plot.top + ((max - tick) / max) * plot.height;
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(width - plot.right, y);
    ctx.stroke();
    ctx.fillText(Math.round(tick), 4, y + 4);
  });
  function series(values, color) {
    ctx.beginPath();
    values.forEach((value, index) => {
      const x = plot.left + (index * plot.width) / (values.length - 1);
      const y = plot.top + ((max - value) / max) * plot.height;
      index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  series(incoming, "#17aeea");
  series(outgoing, "#ff9477");
  months.forEach((month, index) => {
    const x = plot.left + (index * plot.width) / (months.length - 1);
    ctx.fillText(month, x - 10, height - 5);
  });
}

document.getElementById("sideNav").addEventListener("click", (event) => {
  const item = event.target.closest("[data-view]");
  if (item) setView(item.dataset.view);
});

document.getElementById("categoryTabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  inventoryCategoryFilter = button.dataset.category;
  inventoryPage = 1;
  document.querySelectorAll(".category-tab").forEach((tab) => tab.classList.toggle("active", tab === button));
  renderInventory();
});

document.getElementById("inventoryPrev").addEventListener("click", () => {
  inventoryPage -= 1;
  renderInventory();
});

document.getElementById("inventoryNext").addEventListener("click", () => {
  inventoryPage += 1;
  renderInventory();
});

document.getElementById("addRequestItem").addEventListener("click", addRequestLine);

document.getElementById("requestForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const existingLineCount = state.requests.flatMap((request) => request.items).length;
  const rows = [...document.querySelectorAll("#requestItems .line-row")].map((row, index) => {
    const itemCode = row.querySelector("[name='itemCode']").value;
    const item = findItem(itemCode);
    return {
      id: `RI-${String(existingLineCount + index + 1).padStart(3, "0")}`,
      itemCode,
      itemName: item.name,
      type: item.type,
      quantity: Number(row.querySelector("[name='quantity']").value),
      approvalStatus: "Pending",
      issuanceStatus: "Pending"
    };
  });
  if (!rows.length) return showToast("Add at least one item.", "error");
  const requestId = nextId("REQ", state.requests.map((request) => ({ requestId: request.requestId })));
  state.requests.unshift({
    requestId,
    date: new Date().toISOString(),
    requester: form.get("requester"),
    department: form.get("department"),
    location: form.get("location"),
    managerEmail: form.get("managerEmail"),
    requesterEmail: form.get("requesterEmail"),
    items: rows
  });
  audit("CREATE_REQUEST", "request", requestId, `${rows.length} item line(s) submitted`);
  event.currentTarget.reset();
  document.getElementById("requestItems").innerHTML = "";
  addRequestLine();
  saveState();
  render();
  showToast(`${requestId} created.`);
});

document.getElementById("stockInForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const entry = {
    id: nextId("TX", state.transactions),
    itemCode: form.get("itemCode"),
    location: form.get("location"),
    type: form.get("transactionType"),
    quantity: Number(form.get("quantity")),
    sourceId: "manual",
    notes: form.get("notes"),
    performedBy: "Inventory Manager",
    date: new Date().toISOString()
  };
  state.transactions.unshift(entry);
  audit("MANUAL_STOCK_IN", "stock_transaction", entry.id, `${entry.quantity} ${entry.itemCode} to ${entry.location}`);
  event.currentTarget.reset();
  saveState();
  render();
  showToast("Manual stock-in saved.");
});

document.getElementById("itemForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const code = String(form.get("code")).trim();
  if (state.items.some((item) => item.code.toLowerCase() === code.toLowerCase())) {
    return showToast("Item ID already exists.", "error");
  }
  state.items.push({
    code,
    name: String(form.get("name")).trim(),
    type: String(form.get("type")).trim(),
    category: form.get("category"),
    reorderLevel: Number(form.get("reorderLevel")) || 0,
    unit: String(form.get("unit")).trim(),
    active: true
  });
  audit("CREATE_ITEM", "item", code, "Inventory item created");
  event.currentTarget.reset();
  saveState();
  render();
  showToast("Inventory item added.");
});

document.getElementById("locationForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const location = String(form.get("location")).trim();
  if (state.locations.some((item) => item.toLowerCase() === location.toLowerCase())) {
    return showToast("Location already exists.", "error");
  }
  state.locations.push(location);
  audit("CREATE_LOCATION", "location", location, "Inventory location created");
  event.currentTarget.reset();
  saveState();
  render();
  showToast("Location added.");
});

document.getElementById("poForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const vendor = state.vendors.find((row) => row.id === form.get("vendorId"));
  const quantity = Number(form.get("quantity"));
  const unitPrice = Number(form.get("unitPrice"));
  const poNumber = nextId("PO", state.purchaseOrders.map((po) => ({ poNumber: po.poNumber })));
  state.purchaseOrders.unshift({
    poNumber,
    vendorId: vendor.id,
    vendorName: vendor.name,
    itemCode: form.get("itemCode"),
    location: form.get("location"),
    quantity,
    unitPrice,
    total: quantity * unitPrice,
    status: form.get("status"),
    date: new Date().toISOString()
  });
  audit("CREATE_PO", "purchase_order", poNumber, "PO created; no stock movement posted");
  event.currentTarget.reset();
  saveState();
  render();
  showToast(`${poNumber} created without changing stock.`);
});

document.getElementById("grnForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const accepted = Number(form.get("qtyAccepted"));
  const received = Number(form.get("qtyReceived"));
  if (accepted > received) return showToast("Accepted quantity cannot exceed received quantity.", "error");
  const grnNumber = nextId("GRN", state.grns.map((grn) => ({ grnNumber: grn.grnNumber })));
  const grn = {
    grnNumber,
    poNumber: form.get("poNumber"),
    itemCode: form.get("itemCode"),
    location: form.get("location"),
    qtyReceived: received,
    qtyAccepted: accepted,
    receivedBy: form.get("receivedBy"),
    notes: form.get("notes"),
    date: new Date().toISOString()
  };
  state.grns.unshift(grn);
  if (accepted > 0) {
    state.transactions.unshift({
      id: nextId("TX", state.transactions),
      itemCode: grn.itemCode,
      location: grn.location,
      type: "GRN_STOCK_IN",
      quantity: accepted,
      sourceId: grnNumber,
      notes: `GRN receipt ${grnNumber}`,
      performedBy: grn.receivedBy,
      date: new Date().toISOString()
    });
  }
  audit("CREATE_GRN", "grn", grnNumber, `${accepted} accepted for ${grn.itemCode}`);
  event.currentTarget.reset();
  saveState();
  render();
  showToast(`${grnNumber} saved and stock ledger updated.`);
});

document.getElementById("vendorForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const id = nextId("VEN", state.vendors);
  state.vendors.push({ id, name: form.get("name"), phone: form.get("phone"), contact: form.get("contact"), address: form.get("address") });
  audit("CREATE_VENDOR", "vendor", id, form.get("name"));
  event.currentTarget.reset();
  saveState();
  render();
  showToast("Vendor added.");
});

document.getElementById("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ims-export.json";
  link.click();
  URL.revokeObjectURL(url);
});

document.getElementById("globalSearch").addEventListener("input", (event) => {
  const term = event.target.value.toLowerCase();
  document.querySelectorAll("tbody tr").forEach((row) => {
    row.style.display = row.textContent.toLowerCase().includes(term) ? "" : "none";
  });
});

window.addEventListener("resize", drawChart);
addRequestLine();
render();
